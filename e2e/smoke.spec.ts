import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __sim: { rocks: unknown[]; earth: { queue: unknown[] }; agent: { framesTaken: number; habitability: { detections: number } } };
  }
}

test('simulation boots, the rover sees and reports', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GL Driver|GPU stall/.test(m.text())) errors.push(m.text());
  });

  await page.goto('/');

  // 1. The world loads: real terrain, rocks and the rover HUD come alive.
  await expect(page.locator('#view canvas').first()).toBeVisible();
  await expect(page.locator('#battPct')).not.toHaveText('—');
  await expect(page.locator('#solChip')).toHaveText(/Sol 1/);
  expect(await page.evaluate(() => window.__sim.rocks.length)).toBeGreaterThan(1000);

  // 2. Ask the rover for an image: the detector runs on it and the eye panel reports detections.
  await page.click('#snapBtn');
  await expect(page.locator('#eyeInfo')).toContainText(/detections/);
  expect(await page.evaluate(() => window.__sim.agent.framesTaken)).toBeGreaterThan(0);

  // 3. Perception statistics are scored against the hidden ground truth.
  await page.click('#percBtn');
  await expect(page.locator('#percRows .pr').first()).toBeVisible();

  // 4. The habitability card shows a careful verdict, never a claim of life.
  await page.click('#habBtn');
  await expect(page.locator('#habHead')).not.toBeEmpty();
  const text = (await page.locator('#habCard').innerText()).toLowerCase();
  expect(text).not.toMatch(/life found|found life|evidence of life/);

  // 5. The Earth link has queued the image for downlink.
  await expect.poll(() => page.evaluate(() => window.__sim.earth.queue.length)).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
