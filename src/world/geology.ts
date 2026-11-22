import { MinHeap } from '../nav/astar';
import type { Heightmap } from '../terrain/heightmap';
import { BEDROCK_CLASS, C, SURFACE_CLASS } from './classes';

export interface UnitsLegend {
  source: string;
  doi: string;
  bedrock: string[];
  surface: string[];
}

export interface Geology {
  size: number;
  /** Ground-truth class per heightmap cell (terrain only; rocks are separate objects). */
  classMap: Uint8Array;
  /** Connected same-class regions, id 1..patchCount (0 = none). */
  patchId: Uint32Array;
  patchClass: Uint8Array;
  patchCount: number;
  bedrock: Uint8Array;
  surface: Uint8Array;
  legend: UnitsLegend;
  sizeMetres: number;
  classAt(x: number, z: number): number;
  surfaceNameAt(x: number, z: number): string;
  /** Class of the bedrock unit under (x, z), ignoring surface cover. Used to colour rocks. */
  bedrockClassAt(x: number, z: number): number;
}

export const STEEP_HAZARD_DEG = 25;
const D8: [number, number][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/** Priority-flood depression filling (Barnes et al. 2014 style) + D8 flow accumulation on an N x N grid. */
export function drainage(C0: Float32Array, N: number): { depth: Float32Array; acc: Float32Array } {
  const filled = new Float32Array(N * N).fill(Infinity);
  const done = new Uint8Array(N * N);
  const heap = new MinHeap();
  const order: number[] = [];
  const seed = (i: number) => {
    if (done[i]) return;
    done[i] = 1;
    filled[i] = C0[i]!;
    heap.push(C0[i]!, i);
  };
  for (let k = 0; k < N; k++) {
    seed(k);
    seed((N - 1) * N + k);
    seed(k * N);
    seed(k * N + N - 1);
  }
  while (heap.size > 0) {
    const i = heap.pop();
    order.push(i);
    const a = (i / N) | 0;
    const b = i % N;
    for (const [da, db] of D8) {
      const na = a + da;
      const nb = b + db;
      if (na < 0 || nb < 0 || na >= N || nb >= N) continue;
      const j = na * N + nb;
      if (done[j]) continue;
      done[j] = 1;
      filled[j] = Math.max(C0[j]!, filled[i]! + 1e-3);
      heap.push(filled[j]!, j);
    }
  }
  const depth = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) depth[i] = filled[i]! - C0[i]!;
  const acc = new Float32Array(N * N).fill(1);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    const a = (i / N) | 0;
    const b = i % N;
    let best = -1;
    let bd = 0;
    for (const [da, db] of D8) {
      const na = a + da;
      const nb = b + db;
      if (na < 0 || nb < 0 || na >= N || nb >= N) continue;
      const d = (filled[i]! - filled[na * N + nb]!) / Math.hypot(da, db);
      if (d > bd) {
        bd = d;
        best = na * N + nb;
      }
    }
    if (best >= 0) acc[best] = acc[best]! + acc[i]!;
  }
  return { depth, acc };
}

/** Bilinear sample of a coarse 0/1 mask at fractional cell coords, used to round off blocky coarse-grid edges. */
function bilinear(m: Uint8Array, N: number, x: number, y: number): number {
  const x0 = Math.min(N - 2, Math.max(0, Math.floor(x)));
  const y0 = Math.min(N - 2, Math.max(0, Math.floor(y)));
  const tx = Math.min(1, Math.max(0, x - x0));
  const ty = Math.min(1, Math.max(0, y - y0));
  const i = y0 * N + x0;
  return m[i]! * (1 - tx) * (1 - ty) + m[i + 1]! * tx * (1 - ty) + m[i + N]! * (1 - tx) * ty + m[i + N + 1]! * tx * ty;
}

/** Label 4-connected components of `mask` (1 = in), returning label per cell and sizes. */
function components(mask: Uint8Array, N: number): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(N * N);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let s = 0; s < N * N; s++) {
    if (!mask[s] || label[s]) continue;
    const id = sizes.length;
    let n = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      const a = (i / N) | 0;
      const b = i % N;
      if (a > 0 && mask[i - N] && !label[i - N]) { label[i - N] = id; stack.push(i - N); }
      if (a < N - 1 && mask[i + N] && !label[i + N]) { label[i + N] = id; stack.push(i + N); }
      if (b > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
      if (b < N - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
    }
    sizes.push(n);
  }
  return { label, sizes };
}

/**
 * Build the ground-truth class map.
 * Priority: steep slope (DEM) > crater (DEM closed depression) > channel (DEM drainage, speculative)
 * > surface unit (Stack et al. 2020) > bedrock unit (Stack et al. 2020, mineral association assumed).
 * `units` is the rasterised map: R = bedrock id, G = surface id (1-based into the legend lists, 0 = none).
 */
export function buildGeology(hm: Heightmap, slope: Float32Array, units: Uint8ClampedArray | Uint8Array, legend: UnitsLegend): Geology {
  const size = hm.size;
  const N = 256;
  const f = size / N;
  const coarse = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let s = 0;
    for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) s += hm.data[(j * f + b) * size + i * f + a]!;
    coarse[j * N + i] = s / (f * f);
  }
  const { depth, acc } = drainage(coarse, N);

  // Craters: closed depressions at least 5 m deep and 10 coarse cells (~3.8 ha) in area.
  const dep = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) dep[i] = depth[i]! > 5 ? 1 : 0;
  const cc = components(dep, N);
  const craterC = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) if (cc.label[i] && cc.sizes[cc.label[i]!]! >= 10) craterC[i] = 1;
  // Channels: strong drainage lines on gentle ground (possible, not mapped palaeochannels).
  const chanC = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) if (acc[i]! >= 350 && !craterC[i]) chanC[i] = 1;

  const classMap = new Uint8Array(size * size);
  const bedrock = new Uint8Array(size * size);
  const surface = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const bi = units[k * 4]!;
      const si = units[k * 4 + 1]!;
      bedrock[k] = bi;
      surface[k] = si;
      let cls: number = C.Regolith;
      if (slope[k]! > STEEP_HAZARD_DEG) cls = C.HazardSteep;
      else if (bilinear(craterC, N, (i + 0.5) / f - 0.5, (j + 0.5) / f - 0.5) > 0.5) cls = C.Crater;
      else if (bilinear(chanC, N, (i + 0.5) / f - 0.5, (j + 0.5) / f - 0.5) > 0.4 && slope[k]! < 12) cls = C.Channel;
      else {
        const sName = si ? (legend.surface[si - 1] ?? 'None') : 'None';
        const sCls = SURFACE_CLASS[sName] ?? 'bedrock';
        if (sCls !== 'bedrock') cls = sCls;
        else {
          const bName = bi ? legend.bedrock[bi - 1] : undefined;
          cls = (bName && BEDROCK_CLASS[bName]?.cls) || C.Regolith;
        }
      }
      classMap[k] = cls;
    }
  }

  const patches = patchesBySameClass(classMap, size);
  const half = hm.sizeMetres / 2;
  const idx = (x: number, z: number) => {
    const i = Math.min(size - 1, Math.max(0, Math.round(((x + half) / hm.sizeMetres) * (size - 1))));
    const j = Math.min(size - 1, Math.max(0, Math.round(((z + half) / hm.sizeMetres) * (size - 1))));
    return j * size + i;
  };
  return {
    size, classMap, patchId: patches.id, patchClass: patches.cls, patchCount: patches.count, bedrock, surface, legend, sizeMetres: hm.sizeMetres,
    classAt: (x, z) => classMap[idx(x, z)]!,
    bedrockClassAt: (x, z) => {
      const b = bedrock[idx(x, z)]!;
      const name = b ? legend.bedrock[b - 1] : undefined;
      return (name && BEDROCK_CLASS[name]?.cls) || C.Basalt;
    },
    surfaceNameAt: (x, z) => {
      const s = surface[idx(x, z)]!;
      return s ? (legend.surface[s - 1] ?? 'None') : 'None';
    },
  };
}

/** Connected regions of equal class (4-connectivity). Returns patch id per cell and class per patch. */
function patchesBySameClass(classMap: Uint8Array, N: number): { id: Uint32Array; cls: Uint8Array; count: number } {
  const id = new Uint32Array(N * N);
  const cls: number[] = [0];
  const stack: number[] = [];
  for (let s = 0; s < N * N; s++) {
    if (id[s]) continue;
    const c = classMap[s]!;
    const pid = cls.length;
    cls.push(c);
    id[s] = pid;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const a = (i / N) | 0;
      const b = i % N;
      if (a > 0 && !id[i - N] && classMap[i - N] === c) { id[i - N] = pid; stack.push(i - N); }
      if (a < N - 1 && !id[i + N] && classMap[i + N] === c) { id[i + N] = pid; stack.push(i + N); }
      if (b > 0 && !id[i - 1] && classMap[i - 1] === c) { id[i - 1] = pid; stack.push(i - 1); }
      if (b < N - 1 && !id[i + 1] && classMap[i + 1] === c) { id[i + 1] = pid; stack.push(i + 1); }
    }
  }
  return { id, cls: Uint8Array.from(cls), count: cls.length - 1 };
}
