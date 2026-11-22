import { describe, expect, it } from 'vitest';
import { buildGeology, drainage, STEEP_HAZARD_DEG } from '../src/world/geology';
import { C } from '../src/world/classes';
import { IdSpace, idToRgb } from '../src/perception/idPass';
import { gridFor, syntheticHeightmap } from './helpers';
import type { Rock } from '../src/world/rocks';

describe('drainage (priority flood + D8 accumulation)', () => {
  it('finds no depressions on a planar ramp and accumulates flow downhill', () => {
    const N = 32;
    const c = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) c[j * N + i] = i * 1.0;
    const { depth, acc } = drainage(c, N);
    expect(Math.max(...depth)).toBeLessThan(0.1);
    expect(acc[10 * N]).toBe(N); // every cell in row 10 drains to its low-x edge
  });

  it('measures the depth of a closed bowl', () => {
    const N = 32;
    const c = new Float32Array(N * N).fill(10);
    for (let j = 12; j < 20; j++) for (let i = 12; i < 20; i++) c[j * N + i] = 4;
    expect(drainage(c, N).depth[16 * N + 16]).toBeCloseTo(6, 1);
  });
});

describe('buildGeology', () => {
  const size = 256;
  const hm = syntheticHeightmap(size, 1280, (x) => 0.05 * x + 40 * Math.min(1, Math.max(0, (x - 400) / 20)));
  const grid = gridFor(hm);
  const units = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const k = (j * size + i) * 4;
    units[k] = i < 128 ? 1 : 2; // bedrock: delta thinly layered | crater floor fractured 2
    units[k + 1] = i >= 150 && i < 170 ? 1 : 0; // surface: a band of large aeolian bedforms
  }
  const legend = { source: 't', doi: '', bedrock: ['Delta thinly layered', 'Crater floor fractured 2'], surface: ['Aeolian bedforms, large'] };
  const geo = buildGeology(hm, grid.slope, units, legend);

  it('maps bedrock units to classes', () => {
    expect(geo.classAt(-500, 0)).toBe(C.LayeredDelta);
    expect(geo.classAt(100, 0)).toBe(C.Basalt);
  });
  it('lets surface units override bedrock', () => expect(geo.classAt(-640 + 160 * (1280 / 255), 0)).toBe(C.HazardSand));
  it('marks slopes over the hazard threshold as steep', () => {
    const steepX = 400 + 10; // middle of the ramp
    expect(hm.slopeAt(steepX, 0)).toBeGreaterThan(STEEP_HAZARD_DEG);
    expect(geo.classAt(steepX, 0)).toBe(C.HazardSteep);
  });
  it('labels connected same-class patches consistently', () => {
    expect(geo.patchCount).toBeGreaterThanOrEqual(3);
    for (let k = 0; k < size * size; k += 97) expect(geo.patchClass[geo.patchId[k]!]).toBe(geo.classMap[k]);
  });
});

describe('ground-truth ids', () => {
  it('round-trips 24-bit ids through RGB bytes', () => {
    for (const id of [1, 255, 256, 65535, 65536, 1234567, 16777215]) {
      const [r, g, b] = idToRgb(id);
      expect((r << 16) | (g << 8) | b).toBe(id);
    }
  });
  it('looks up terrain patches and rocks without colliding', () => {
    const geo = { patchCount: 3, patchClass: Uint8Array.from([0, C.Regolith, C.Basalt, C.ClayRich]) } as never;
    const rocks: Rock[] = [
      { id: 0, x: 0, z: 0, radius: 0.6, kind: 'boulder', lithology: C.Basalt },
      { id: 1, x: 1, z: 1, radius: 0.1, kind: 'cobble', lithology: C.Basalt },
    ];
    const ids = new IdSpace(geo, rocks);
    expect(ids.lookup(0)).toBeUndefined();
    expect(ids.lookup(2)).toEqual({ kind: 'terrain', cls: C.Basalt });
    expect(ids.rockId(rocks[0]!)).toBe(4);
    expect(ids.lookup(4)).toEqual({ kind: 'rock', cls: C.Boulder, rockId: 0 });
    expect(ids.lookup(5)?.cls).toBe(C.Cobble);
    expect(ids.lookup(99)).toBeUndefined();
  });
});
