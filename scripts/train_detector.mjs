#!/usr/bin/env node
/**
 * Train the terrain classifier and evaluate the whole detector on held-out frames.
 *
 *   npm run dev            # in another terminal (serves the app on :5173)
 *   node scripts/train_detector.mjs [--train 150] [--val 40] [--eval 60] [--url http://localhost:5173]
 *
 * The 2 km patch is split into a checkerboard of 400 m blocks. Training frames are captured from even blocks;
 * calibration (temperature) uses odd-block frames; the final evaluation uses different odd-block frames, so the
 * reported numbers are on places the classifier was not trained on. Frames are rendered in a headless browser at
 * random positions, headings, times of day (sun above ~10 deg) and dust levels (tau 0.3-2.5).
 * Output: public/data/detector_model.json and a results JSON next to it (docs/perception_eval.json).
 */
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const NTRAIN = +arg('train', 150), NVAL = +arg('val', 40), NEVAL = +arg('eval', 60), URL = arg('url', 'http://localhost:5173');
const CHUNK = 8;
const NAMES = { 1: 'regolith', 2: 'basalt', 3: 'olivine-rich rock', 4: 'carbonate-bearing rock', 5: 'layered delta sediment', 6: 'clay-rich outcrop', 7: 'sand ripples/dunes', 10: 'possible dried channel', 11: 'crater', 12: 'hazard: steep slope', 13: 'hazard: loose sand' };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(URL);
await page.waitForFunction(() => window.__lab, null, { timeout: 180000 });
await page.evaluate(() => { window.__sim.paused = true; });
const FEATURES = await page.evaluate(() => window.__lab.features);
const NF = FEATURES.length;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function collect(n, seed0, parity) {
  const X = [], Y = [];
  for (let done = 0; done < n; done += CHUNK) {
    const r = await page.evaluate(([k, s, p]) => window.__lab.collect(k, s, p), [Math.min(CHUNK, n - done), seed0 + done, parity]);
    for (let i = 0; i < r.X.length; i += NF) X.push(r.X.slice(i, i + NF));
    Y.push(...r.Y);
    log(`collected ${Math.min(done + CHUNK, n)}/${n} frames (parity ${parity}), ${Y.length} tiles`);
  }
  return { X, Y };
}

log('collecting training tiles');
const tr = await collect(NTRAIN, 100, 0);
log('collecting validation tiles');
const va = await collect(NVAL, 900, 1);

// --- fit Gaussian naive Bayes ---
const byClass = new Map();
tr.Y.forEach((c, i) => { (byClass.get(c) ?? byClass.set(c, []).get(c)).push(tr.X[i]); });
const classes = [...byClass.entries()].filter(([, v]) => v.length >= 300).sort((a, b) => a[0] - b[0]);
const total = classes.reduce((s, [, v]) => s + Math.sqrt(v.length), 0);
const pooled = new Array(NF).fill(0); let pn = 0;
const stats = classes.map(([id, rows]) => {
  const mean = new Array(NF).fill(0), varr = new Array(NF).fill(0);
  for (const r of rows) r.forEach((x, k) => (mean[k] += x / rows.length));
  for (const r of rows) r.forEach((x, k) => (varr[k] += (x - mean[k]) ** 2 / rows.length));
  varr.forEach((v, k) => (pooled[k] += v * rows.length)); pn += rows.length;
  return { id, name: NAMES[id], prior: Math.sqrt(rows.length) / total, mean, variance: varr, n: rows.length };
});
pooled.forEach((_, k) => (pooled[k] /= pn));
stats.forEach((c) => (c.variance = c.variance.map((v, k) => Math.max(0.8 * v + 0.2 * pooled[k], 1e-6))));

// With temperature applied to the whole log posterior (prior + likelihood): replicate src/perception/detector.ts classifyTile.
function post2(model, x) {
  const lp = model.classes.map((c) => (Math.log(c.prior) + x.reduce((s, xi, k) => s - 0.5 * (Math.log(2 * Math.PI * Math.max(c.variance[k], 1e-6)) + (xi - c.mean[k]) ** 2 / Math.max(c.variance[k], 1e-6)), 0)) / model.temperature);
  const m = Math.max(...lp); const e = lp.map((v) => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((v) => v / s);
}
const model = { version: 1, features: FEATURES, temperature: 1, classes: stats, info: {} };
const idx = new Map(stats.map((c, i) => [c.id, i]));
const vsel = va.Y.map((c, i) => [c, i]).filter(([c]) => idx.has(c));
let bestT = 1, bestNll = Infinity;
for (let T = 1; T <= 60; T *= 1.12) {
  model.temperature = T;
  let nll = 0;
  for (const [c, i] of vsel) nll -= Math.log(Math.max(1e-9, post2(model, va.X[i])[idx.get(c)]));
  nll /= vsel.length;
  if (nll < bestNll) { bestNll = nll; bestT = T; }
}
model.temperature = +bestT.toFixed(3);
// held-out tile accuracy and confusion
let correct = 0; const conf = {}; const perAcc = {};
for (const [c, i] of vsel) {
  const p = post2(model, va.X[i]); const best = p.indexOf(Math.max(...p)); const pc = stats[best].id;
  if (pc === c) correct++;
  (perAcc[c] ??= { n: 0, ok: 0 }); perAcc[c].n++; if (pc === c) perAcc[c].ok++;
  (conf[c] ??= {}); conf[c][pc] = (conf[c][pc] ?? 0) + 1;
}
model.info = {
  trainedOn: { frames: NTRAIN, tiles: tr.Y.length, blocks: 'even 400 m checkerboard blocks' },
  calibratedOn: { frames: NVAL, tiles: vsel.length, blocks: 'odd 400 m blocks' },
  heldOutTileAccuracy: +(correct / vsel.length).toFixed(4),
  heldOutPerClassTileAccuracy: Object.fromEntries(Object.entries(perAcc).map(([c, v]) => [NAMES[c], +(v.ok / v.n).toFixed(3)])),
  note: 'Gaussian naive Bayes on 12 haze-corrected, lighting-robust tile features (incl. 3x3 context); synthetic labels from the simulator ground-truth pass.',
};
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/detector_model.json', JSON.stringify(model));
log(`model written: T=${model.temperature}, held-out tile accuracy ${(correct / vsel.length * 100).toFixed(1)}% over ${vsel.length} tiles`);
console.log('per-class held-out tile accuracy', JSON.stringify(model.info.heldOutPerClassTileAccuracy));

// --- full-detector evaluation on separate held-out frames ---
log('evaluating the full detector on held-out frames');
const agg = { frames: 0, detections: 0, msTotal: 0, perClass: {}, bins: Array.from({ length: 10 }, () => ({ n: 0, tp: 0, sumConf: 0 })) };
for (let done = 0; done < NEVAL; done += CHUNK) {
  const k = Math.min(CHUNK, NEVAL - done);
  const r = await page.evaluate(([m, n, s]) => window.__lab.evaluate(m, n, s, 1), [model, k, 1700 + done]);
  agg.frames += r.frames; agg.detections += r.detections; agg.msTotal += r.meanMs * r.frames;
  for (const [cls, t] of r.perClass) { const a = (agg.perClass[cls] ??= { tp: 0, fp: 0, total: 0, hit: 0 }); a.tp += t.tp; a.fp += t.fp; a.total += t.total; a.hit += t.hit; }
  r.bins.forEach((b, i) => { agg.bins[i].n += b.n; agg.bins[i].tp += b.tp; agg.bins[i].sumConf += b.sumConf; });
  log(`evaluated ${Math.min(done + CHUNK, NEVAL)}/${NEVAL} frames`);
}
const rows = Object.entries(agg.perClass).map(([c, t]) => ({ cls: +c, name: NAMES[c] ?? (c == 8 ? 'boulder' : c == 9 ? 'cobbles' : c), precision: t.tp + t.fp ? t.tp / (t.tp + t.fp) : null, recall: t.total ? t.hit / t.total : null, ...t })).sort((a, b) => a.cls - b.cls);
console.log('\nclass'.padEnd(26), 'precision', 'recall', ' tp  fp  hit/total');
for (const r of rows) console.log(r.name.padEnd(25), (r.precision === null ? '  —' : (r.precision * 100).toFixed(0) + '%').padStart(8), (r.recall === null ? '  —' : (r.recall * 100).toFixed(0) + '%').padStart(7), String(r.tp).padStart(4), String(r.fp).padStart(4), ` ${r.hit}/${r.total}`);
console.log('\nreliability (confidence bin: accuracy, n)');
agg.bins.forEach((b, i) => console.log(`${i * 10}-${i * 10 + 10}%`.padEnd(8), b.n ? `${(b.tp / b.n * 100).toFixed(0)}% correct, mean conf ${(b.sumConf / b.n * 100).toFixed(0)}%, n=${b.n}` : '—'));
console.log(`\nmean detector time ${(agg.msTotal / agg.frames).toFixed(1)} ms/frame over ${agg.frames} frames, ${agg.detections} detections`);
mkdirSync('docs', { recursive: true });
const evalJson = JSON.stringify({ when: new Date().toISOString(), frames: agg.frames, detections: agg.detections, meanDetectorMs: agg.msTotal / agg.frames, classes: rows, reliability: agg.bins, model: { temperature: model.temperature, ...model.info } }, null, 2);
writeFileSync('docs/perception_eval.json', evalJson);
writeFileSync('public/data/perception_eval.json', evalJson);
await browser.close();
