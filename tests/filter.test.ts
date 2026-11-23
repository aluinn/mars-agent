import { describe, expect, it } from 'vitest';
import { Detector } from '../src/perception/detector';

// Reach the private helper through a thin cast: it is the core of the rock detector and deserves a direct test.
const d = new Detector(null) as unknown as { tophat(y: Float32Array, depth: Float32Array, W: number, H: number, R: number): Float32Array };

describe('top-hat (rock bump) filter', () => {
  const W = 40, H = 30;
  const depth = new Float32Array(W * H).fill(10);

  it('keeps a narrow bump and removes a wide ramp', () => {
    const y = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) y[j * W + i] = 0.02 * i; // gentle ramp
    for (let j = 12; j < 16; j++) for (let i = 18; i < 22; i++) y[j * W + i]! += 0.5; // 4 x 4 px bump, 0.5 m high
    const t = d.tophat(y, depth, W, H, 6);
    expect(t[14 * W + 20]).toBeGreaterThan(0.4);
    expect(Math.abs(t[5 * W + 5]!)).toBeLessThan(0.05);
    expect(Math.abs(t[20 * W + 30]!)).toBeLessThan(0.05);
  });

  it('ignores invalid (no-depth) pixels', () => {
    const y = new Float32Array(W * H);
    const dep = new Float32Array(W * H).fill(10);
    for (let i = 0; i < 10; i++) for (let j = 0; j < H; j++) dep[j * W + i] = 0; // left part invalid
    const t = d.tophat(y, dep, W, H, 5);
    expect(t[10 * W + 3]).toBe(0);
    expect(Math.abs(t[10 * W + 25]!)).toBeLessThan(1e-6);
  });
});
