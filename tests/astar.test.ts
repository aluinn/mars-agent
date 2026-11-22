import { describe, expect, it } from 'vitest';
import { findPath, MAX_SLOPE_DEG, profilePath } from '../src/nav/astar';
import { markDisc } from '../src/nav/navgrid';
import { gridFor, syntheticHeightmap } from './helpers';

const flat = () => gridFor(syntheticHeightmap(129, 640, () => 0));

describe('slope computation', () => {
  it('measures a 30 degree ramp as ~30 degrees', () => {
    const hm = syntheticHeightmap(129, 640, (x) => x * Math.tan((30 * Math.PI) / 180));
    expect(hm.slopeAt(0, 0)).toBeCloseTo(30, 0);
  });
});

describe('findPath', () => {
  it('goes nearly straight on flat ground', () => {
    const r = findPath(flat(), null, -200, -200, 200, -200);
    expect(r.found).toBe(true);
    expect(r.lengthM).toBeGreaterThan(399);
    expect(r.lengthM).toBeLessThan(410);
  });

  it('refuses slopes steeper than the limit and routes through the gap', () => {
    // A 40 m high ridge along z with ~53 degree flanks, interrupted by a flat gap at z in [200, 260].
    const hm = syntheticHeightmap(129, 640, (x, z) => (z > 200 && z < 260 ? 0 : 40 * Math.min(1, Math.max(0, (60 - Math.abs(x)) / 30))));
    const g = gridFor(hm);
    const r = findPath(g, null, -150, -100, 150, -100);
    expect(r.found).toBe(true);
    expect(r.points.some((p) => p.z > 190)).toBe(true);
    const prof = profilePath(g, r.points);
    expect(prof.maxSlopeDeg).toBeLessThanOrEqual(MAX_SLOPE_DEG);
  });

  it('returns not found when a steep wall fully separates start and goal', () => {
    const hm = syntheticHeightmap(129, 640, (x) => (x > -20 && x < 20 ? 80 : 0));
    const r = findPath(gridFor(hm), null, -150, 0, 150, 0);
    expect(r.found).toBe(false);
  });

  it('refuses a goal on a steep slope', () => {
    const hm = syntheticHeightmap(129, 640, (x) => x * Math.tan((30 * Math.PI) / 180));
    expect(findPath(gridFor(hm), null, -200, 0, 100, 0).found).toBe(false);
  });

  it('avoids blocked (rock) cells and the path never enters them', () => {
    const g = flat();
    const blocked = new Uint8Array(g.n * g.n);
    markDisc(g, blocked, 0, 0, 40);
    const r = findPath(g, blocked, -200, 0, 200, 0);
    expect(r.found).toBe(true);
    for (const p of r.points) expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(38);
    expect(r.lengthM).toBeGreaterThan(400);
  });
});
