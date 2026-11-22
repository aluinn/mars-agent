import { type NavGrid, cellX, cellZ, toCell } from './navgrid';

export interface PathPoint {
  x: number;
  z: number;
}

export interface PathOptions {
  /** Cells steeper than this are never entered. Default 20 degrees. */
  maxSlopeDeg?: number;
  /** Extra cost multiplier at the slope limit: cost = dist * (1 + w * (slope/max)^2). */
  slopeWeight?: number;
}

export interface PathResult {
  found: boolean;
  points: PathPoint[];
  lengthM: number;
  expanded: number;
}

export const MAX_SLOPE_DEG = 20;

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

/** Binary min-heap over (priority, node) with lazy deletion. */
class MinHeap {
  private pri: number[] = [];
  private val: number[] = [];
  get size(): number {
    return this.val.length;
  }
  push(p: number, v: number): void {
    let i = this.val.length;
    this.pri.push(p);
    this.val.push(v);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.pri[par]! <= p) break;
      this.pri[i] = this.pri[par]!;
      this.val[i] = this.val[par]!;
      i = par;
    }
    this.pri[i] = p;
    this.val[i] = v;
  }
  pop(): number {
    const top = this.val[0]!;
    const p = this.pri.pop()!;
    const v = this.val.pop()!;
    const n = this.val.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.pri[c + 1]! < this.pri[c]!) c++;
        if (this.pri[c]! >= p) break;
        this.pri[i] = this.pri[c]!;
        this.val[i] = this.val[c]!;
        i = c;
      }
      this.pri[i] = p;
      this.val[i] = v;
    }
    return top;
  }
}

export function isPassable(g: NavGrid, blocked: Uint8Array | null, idx: number, maxSlope: number): boolean {
  return g.slope[idx]! <= maxSlope && !(blocked && blocked[idx]);
}

/** True when the straight segment crosses only passable cells (sampled at half-cell spacing). */
export function lineClear(
  g: NavGrid,
  blocked: Uint8Array | null,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  maxSlope = MAX_SLOPE_DEG,
): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(d / (g.cell * 0.5)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (!isPassable(g, blocked, toCell(g, ax + (bx - ax) * t, az + (bz - az) * t), maxSlope)) return false;
  }
  return true;
}

/**
 * 8-connected A* over the nav grid. Refuses cells steeper than `maxSlopeDeg` and any cell in `blocked`.
 * Cost rises quadratically with slope so the planner prefers gentle ground. The result is shortened by
 * line-of-sight string pulling, which only joins points whose straight segment is itself passable.
 */
export function findPath(
  g: NavGrid,
  blocked: Uint8Array | null,
  sx: number,
  sz: number,
  gx: number,
  gz: number,
  opts: PathOptions = {},
): PathResult {
  const maxSlope = opts.maxSlopeDeg ?? MAX_SLOPE_DEG;
  const w = opts.slopeWeight ?? 3;
  const n = g.n;
  const start = toCell(g, sx, sz);
  const goal = toCell(g, gx, gz);
  const fail: PathResult = { found: false, points: [], lengthM: 0, expanded: 0 };
  if (!isPassable(g, blocked, goal, maxSlope)) return fail;

  const gScore = new Float32Array(n * n).fill(Infinity);
  const parent = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heap = new MinHeap();
  const goalI = goal % n;
  const goalJ = (goal / n) | 0;
  const h = (idx: number): number => {
    const dx = Math.abs((idx % n) - goalI);
    const dz = Math.abs(((idx / n) | 0) - goalJ);
    return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * g.cell;
  };
  gScore[start] = 0;
  heap.push(h(start), start);
  let expanded = 0;
  let reached = false;

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === goal) {
      reached = true;
      break;
    }
    const ci = cur % n;
    const cj = (cur / n) | 0;
    const cs = g.slope[cur]!;
    for (let k = 0; k < 8; k++) {
      const ni = ci + DX[k]!;
      const nj = cj + DZ[k]!;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const nb = nj * n + ni;
      if (closed[nb] || !isPassable(g, blocked, nb, maxSlope)) continue;
      const diag = k >= 4;
      if (diag && (!isPassable(g, blocked, cj * n + ni, maxSlope) || !isPassable(g, blocked, nj * n + ci, maxSlope))) continue; // no corner cutting
      const avg = (cs + g.slope[nb]!) / 2 / maxSlope;
      const ng = gScore[cur]! + (diag ? SQRT2 : 1) * g.cell * (1 + w * avg * avg);
      if (ng < gScore[nb]!) {
        gScore[nb] = ng;
        parent[nb] = cur;
        heap.push(ng + h(nb), nb);
      }
    }
  }
  if (!reached) return { ...fail, expanded };

  const cells: PathPoint[] = [];
  for (let c = goal; c !== -1; c = parent[c]!) cells.push({ x: cellX(g, c), z: cellZ(g, c) });
  cells.reverse();
  cells[0] = { x: sx, z: sz };
  cells[cells.length - 1] = { x: gx, z: gz };

  const pts: PathPoint[] = [cells[0]!];
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let far = anchor + 1;
    for (let k = cells.length - 1; k > anchor + 1; k--) {
      if (lineClear(g, blocked, cells[anchor]!.x, cells[anchor]!.z, cells[k]!.x, cells[k]!.z, maxSlope)) {
        far = k;
        break;
      }
    }
    pts.push(cells[far]!);
    anchor = far;
  }
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
  return { found: true, points: pts, lengthM: len, expanded };
}

/** Horizontal length, total climb and steepest sampled slope along a path. */
export function profilePath(g: NavGrid, pts: PathPoint[]): { lengthM: number; climbM: number; maxSlopeDeg: number } {
  let lengthM = 0;
  let climbM = 0;
  let maxSlopeDeg = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / 5));
    let prev = g.hm.heightAt(a.x, a.z);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const h = g.hm.heightAt(x, z);
      if (h > prev) climbM += h - prev;
      prev = h;
      maxSlopeDeg = Math.max(maxSlopeDeg, g.slope[toCell(g, x, z)]!);
    }
    lengthM += d;
  }
  return { lengthM, climbM, maxSlopeDeg };
}
