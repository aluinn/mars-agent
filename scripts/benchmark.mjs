#!/usr/bin/env node
/**
 * Measure frame time, camera capture time, detector time and path-finding time in a real browser.
 *
 *   npm run build && npx vite preview --port 4173      # in one terminal
 *   node scripts/benchmark.mjs [--gpu metal|swiftshader] [--url http://localhost:4173] [--frames 600] [--out docs/performance_results.json]
 *
 * --gpu metal uses the machine's real GPU through ANGLE/Metal (macOS); swiftshader is a software renderer and is
 * only useful as a worst case or on machines without a GPU. The renderer string is recorded with the results.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const GPU = arg('gpu', 'metal'), URL = arg('url', 'http://localhost:4173'), FRAMES = +arg('frames', 600), OUT = arg('out', 'docs/performance_results.json');
const args = GPU === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [`--use-angle=${GPU}`, '--ignore-gpu-blocklist', '--enable-gpu'];

const log = (m) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${m}`);
const T0 = Date.now();
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, mean: a.reduce((x, y) => x + y, 0) / a.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] }; };

const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const t0 = Date.now();
await page.goto(URL);
await page.waitForFunction(() => window.__sim && window.__lab, null, { timeout: 300000 });
const loadMs = Date.now() - t0;
const env = await page.evaluate(() => {
  const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown', userAgent: navigator.userAgent };
});

// 1. Frame time with the simulation running at 600x (main view + chase cam + HUD), after a warm-up.
//    Measured twice: normally (the agent takes images, so the detector runs on the main thread) and with image
//    requests suppressed, which isolates how much of the worst-case frame time the capture + detector cause.
const measureFrames = (n) => page.evaluate((count) => new Promise((resolve) => {
  const dts = []; let last = performance.now();
  const tick = (now) => { dts.push(now - last); last = now; if (dts.length < count) requestAnimationFrame(tick); else resolve(dts.slice(30)); };
  requestAnimationFrame(tick);
}), n);
await page.evaluate(() => { const s = window.__sim; s.paused = false; s.speed = 600; });
await page.waitForTimeout(3000);
log('measuring frame time (normal)');
const frame = await measureFrames(FRAMES);
const capturesDuring = await page.evaluate(() => window.__sim.agent.framesTaken);
await page.evaluate(() => { const a = window.__sim.agent; a.__origRequest = a.requestCapture; a.requestCapture = () => {}; a.captureQueue.length = 0; });
await page.waitForTimeout(1500);
log('measuring frame time (captures suppressed)');
const frameNoCapture = await measureFrames(FRAMES);
await page.evaluate(() => { window.__sim.paused = true; });

// 2. Camera capture (colour + depth + ground-truth id passes + readback) and detector, on random poses.
log('timing camera capture and detector');
const model = await page.evaluate(() => fetch('/data/detector_model.json').then((r) => r.json()));
const cap = await page.evaluate(() => { const ms = []; for (let i = 0; i < 20; i++) { const t = performance.now(); window.__lab.capture(-300 + i * 30, -140 + i * 25, i * 0.7, 10.5, 0.6); ms.push(performance.now() - t); } return ms.slice(2); });
const det = await page.evaluate((m) => window.__lab.evaluate(m, 24, 4242, 1), model);

// 3. Path finding on the 1024 x 1024 grid.
log('timing path finding');
const pathEmpty = await page.evaluate(() => window.__lab.benchPath(60, 9, false));
const pathRocks = await page.evaluate(() => window.__lab.benchPath(60, 9, true));
await browser.close();

const result = {
  when: new Date().toISOString(),
  machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}`, node: process.version },
  browser: { gpuMode: GPU, renderer: env.renderer, userAgent: env.userAgent, viewport: '1600x900', devicePixelRatio: 1 },
  loadMs,
  frameMs: stats(frame),
  frameMsNoCaptures: stats(frameNoCapture),
  imagesTakenDuringFrameRun: capturesDuring,
  captureMs: stats(cap),
  detectorMsPerFrame: det.meanMs,
  detectorFrames: det.frames,
  pathMs: { noKnownRocks: { ...stats(pathEmpty.ms), found: pathEmpty.found, meanExpanded: pathEmpty.expanded.reduce((a, b) => a + b, 0) / Math.max(1, pathEmpty.expanded.length) }, allBouldersKnown: { ...stats(pathRocks.ms), found: pathRocks.found, meanExpanded: pathRocks.expanded.reduce((a, b) => a + b, 0) / Math.max(1, pathRocks.expanded.length) } },
};
writeFileSync(OUT, JSON.stringify(result, null, 2));
const f = (v) => v.toFixed(2);
console.log(`\n${result.machine.cpu}, ${result.machine.memoryGB} GB, ${result.machine.os}`);
console.log(`WebGL renderer: ${env.renderer}`);
console.log(`page ready after ${loadMs} ms`);
console.log(`frame time   mean ${f(result.frameMs.mean)} ms (${(1000 / result.frameMs.mean).toFixed(0)} fps)  p50 ${f(result.frameMs.p50)}  p95 ${f(result.frameMs.p95)}  p99 ${f(result.frameMs.p99)}  over ${result.frameMs.n} frames`);
console.log(`  without image captures: mean ${f(result.frameMsNoCaptures.mean)} ms  p95 ${f(result.frameMsNoCaptures.p95)}  p99 ${f(result.frameMsNoCaptures.p99)}  (${result.imagesTakenDuringFrameRun} images were taken during the normal run)`);
console.log(`camera capture mean ${f(result.captureMs.mean)} ms  p95 ${f(result.captureMs.p95)}`);
console.log(`detector      mean ${f(result.detectorMsPerFrame)} ms/frame over ${result.detectorFrames} frames`);
for (const [k, v] of Object.entries(result.pathMs)) console.log(`A* ${k.padEnd(18)} mean ${f(v.mean)} ms  p95 ${f(v.p95)}  max ${f(v.max)}  (${v.found}/${v.n} found, ~${v.meanExpanded.toFixed(0)} nodes expanded)`);
console.log(`\nwritten ${OUT}`);
