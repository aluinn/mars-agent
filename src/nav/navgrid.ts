import type { Heightmap } from '../terrain/heightmap';

/** Regular navigation grid over the heightmap. Node (i, j) sits at x = i*cell - half, z = j*cell - half. */
export interface NavGrid {
  hm: Heightmap;
  n: number;
  cell: number;
  half: number;
  /** Slope in degrees per node. */
  slope: Float32Array;
}

export function buildNavGrid(hm: Heightmap, step = 1): NavGrid {
  const n = Math.floor((hm.size - 1) / step) + 1;
  const cell = (step * hm.sizeMetres) / (hm.size - 1);
  const half = hm.sizeMetres / 2;
  const slope = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) slope[j * n + i] = hm.slopeAt(i * cell - half, j * cell - half);
  }
  return { hm, n, cell, half, slope };
}

export function toCell(g: NavGrid, x: number, z: number): number {
  const i = Math.min(g.n - 1, Math.max(0, Math.round((x + g.half) / g.cell)));
  const j = Math.min(g.n - 1, Math.max(0, Math.round((z + g.half) / g.cell)));
  return j * g.n + i;
}

export function cellX(g: NavGrid, idx: number): number {
  return (idx % g.n) * g.cell - g.half;
}
export function cellZ(g: NavGrid, idx: number): number {
  return Math.floor(idx / g.n) * g.cell - g.half;
}

/** Mark all cells whose centre lies within `radius` of (x, z). */
export function markDisc(g: NavGrid, mask: Uint8Array, x: number, z: number, radius: number): void {
  const i0 = Math.max(0, Math.floor((x - radius + g.half) / g.cell));
  const i1 = Math.min(g.n - 1, Math.ceil((x + radius + g.half) / g.cell));
  const j0 = Math.max(0, Math.floor((z - radius + g.half) / g.cell));
  const j1 = Math.min(g.n - 1, Math.ceil((z + radius + g.half) / g.cell));
  const r2 = radius * radius;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = i * g.cell - g.half - x;
      const dz = j * g.cell - g.half - z;
      if (dx * dx + dz * dz <= r2) mask[j * g.n + i] = 1;
    }
  }
}
