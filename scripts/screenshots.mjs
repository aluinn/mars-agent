#!/usr/bin/env node
/**
 * Capture the README screenshots from the real app in a headless browser on the machine's GPU.
 *
 *   npm run build && npx vite preview --port 4173      # in one terminal
 *   node scripts/screenshots.mjs [--url http://localhost:4173] [--gpu metal|swiftshader] [--out docs/assets]
 *
 * The scenario is scripted so every state is on screen quickly: it moves the rover between a few varied spots to
 * take images (through the same agent camera path the app uses), then runs the clock through a relay pass so images
 * reach Earth. It uses the dev hooks `window.__sim` and `window.__view`. It never touches existing files with other
 * names: it only writes the fixed filenames below.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('url', 'http://localhost:4173'), GPU = arg('gpu', 'metal'), OUT = arg('out', 'docs/assets');
mkdirSync(OUT, { recursive: true });
const args = GPU === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [`--use-angle=${GPU}`, '--ignore-gpu-blocklist', '--enable-gpu'];
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}`, type: 'jpeg', quality: 90, ...opts });

const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(URL);
await page.waitForFunction(() => window.__sim && window.__view, null, { timeout: 300000 });
await page.addStyleTag({ content: '#hints{display:none!important}' });
const sim = (fn, arg) => page.evaluate(fn, arg);

// ---- 1. gather images from varied spots (paused, mid-morning) ----
await sim(() => { const s = window.__sim; s.paused = true; s.clock.setLocalHours(10.5); });
const spots = [[-296, -140], [-500, -620], [200, 300], [-700, -300], [420, -380], [-120, 520]];
for (const [x, z] of spots) {
  await sim(([x, z]) => { const s = window.__sim; s.rover.x = x; s.rover.z = z; s.rover.heading = 0.6; }, [x, z]);
  for (const pan of [0, 60, -60, 120, -120, 180]) {
    await sim((p) => window.__sim.agent.requestCapture({ panDeg: p, tiltDeg: -4, reason: 'survey' }), pan);
    await page.waitForTimeout(500);
  }
}
await page.waitForTimeout(2500);

// ---- 2. run through a relay pass so images reach Earth ----
await sim(() => { const el = document.getElementById('ltSlider'); el.value = '1.7'; el.dispatchEvent(new Event('input')); });
await sim(() => { const s = window.__sim; s.clock.setLocalHours(15.95); s.speed = 600; s.paused = false; });
await page.waitForFunction(() => window.__sim.earth.received.length >= 6, null, { timeout: 300000 });
await sim(() => { window.__sim.paused = true; });

// ---- 3. perception + habitability + Earth screens ----
await page.click('#percBtn');
await page.waitForTimeout(1500);
await shot(page, 'jezero-perception-1600x900.jpg');
await page.click('#percBtn');
await (await page.$('#eyeCard')).screenshot({ path: `${OUT}/jezero-eye-detections.png` });
await page.click('#togCmp');
await (await page.$('#eyeCard')).screenshot({ path: `${OUT}/jezero-eye-compare.png` });
await page.click('#togCmp'); // back to plain detections
await page.click('#habBtn');
await page.waitForTimeout(1500);
await shot(page, 'jezero-habitability-1600x900.jpg');
await page.click('#habBtn');
await page.click('#earthBtn');
await page.waitForFunction(() => document.querySelectorAll('#earthFeed canvas').length > 0, null, { timeout: 60000 });
await page.click('#earthFeed canvas');
await page.waitForTimeout(1500);
await shot(page, 'jezero-earth-1600x900.jpg');
await page.click('#earthBtn');

// ---- 4. the rover driving: close orbit view, and the follow camera ----
await sim(() => { const s = window.__sim; s.paused = false; s.speed = 60; s.clock.setLocalHours(10.2); s.rover.x = -120; s.rover.z = 360; s.rover.stop(); });
await page.waitForFunction(() => window.__sim.rover.driving, null, { timeout: 120000 });
await sim(() => {
  const s = window.__sim, v = window.__view, r = s.rover;
  v.controls.target.set(r.x, r.y + 1.5, r.z);
  v.camera.position.set(r.x - 22, r.y + 14, r.z + 30);
  v.controls.update();
});
await page.waitForTimeout(2500);
await shot(page, 'jezero-rover-driving-1600x900.jpg');
await page.click('#camSeg button[data-cam=follow]');
await page.waitForTimeout(3500);
await shot(page, 'jezero-follow-1600x900.jpg');
await browser.close();

// ---- 5. phone ----
const b2 = await chromium.launch({ args });
const p2 = await b2.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p2.goto(URL);
await p2.waitForFunction(() => window.__sim, null, { timeout: 300000 });
await p2.addStyleTag({ content: '#hints{display:none!important}' });
await p2.evaluate(() => { window.__sim.clock.setLocalHours(10.5); window.__sim.speed = 600; });
await p2.waitForTimeout(8000);
await p2.screenshot({ path: `${OUT}/jezero-phone-390x844.jpg`, type: 'jpeg', quality: 90 });
await b2.close();
console.log('screenshots written to', OUT);
