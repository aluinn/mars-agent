import { C, className } from '../world/classes';
import { type Basis, basisOf, metresPerPixel, pointAt } from './geometry';
import { NF, TILE, type TileGrid, extractTiles } from './features';
import type { AgentFrame } from './types';

/** Gaussian naive-Bayes model over the tile features, trained by scripts/train_detector.mjs on labelled simulator frames. */
export interface DetectorModel {
  version: 1;
  features: string[];
  /** Posterior temperature fitted on held-out tiles so probabilities are not overconfident. */
  temperature: number;
  classes: { id: number; name: string; prior: number; mean: number[]; variance: number[]; n: number }[];
  info: Record<string, unknown>;
}

export interface Detection {
  id: number;
  cls: number;
  name: string;
  kind: 'terrain' | 'object';
  /** Final confidence in (0, 0.97]: calibrated probability x visibility factors. Never 1. */
  confidence: number;
  /** Probability before the visibility factors (classifier posterior, or the object score). */
  rawProb: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  rangeM: number;
  areaPx: number;
  /** Physical size estimates for objects (metres). */
  sizeM?: number;
  heightM?: number;
  /** Approximate world position (x east, z south) from range and bearing. */
  world: { x: number; z: number };
  factors: Visibility;
  /** Terrain regions: tile indices (tw-wide grid). */
  tiles?: number[];
  /** Terrain regions: a sample of ground points (x east, z south) the region covers, within trustworthy range. */
  footprint?: { x: number; z: number }[];
}

export interface DetectionResult {
  detections: Detection[];
  /** Final class per tile for kept terrain regions, -1 elsewhere. */
  tileClass: Int8Array;
  tw: number;
  th: number;
  ms: number;
}

export interface Visibility {
  range: number;
  sun: number;
  haze: number;
  occlusion: number;
}

export const MAX_CONFIDENCE = 0.97;

/**
 * How well-conditioned the observation is. Each factor is in (0, 1]:
 *  range     resolution falls with distance (about half at 350 m)
 *  sun       low sun means low light and long shadows (about 0.45 at 5 degrees, full above ~35)
 *  haze      dust opacity tau scatters light along the path: exp(-0.0006 * tau * range)
 *  occlusion region cut by the frame edge / depth discontinuities (up to a 50% penalty)
 */
export function visibility(rangeM: number, sunElevationDeg: number, tau: number, occlusionFrac: number): Visibility {
  const sunRad = (Math.max(sunElevationDeg, 0) * Math.PI) / 180;
  return {
    range: 1 / (1 + (rangeM / 350) ** 2),
    sun: Math.min(1, Math.max(0.3, 0.35 + (0.65 * Math.sin(sunRad)) / Math.sin((35 * Math.PI) / 180))),
    haze: Math.exp(-0.0006 * tau * rangeM),
    occlusion: 1 - 0.5 * Math.min(1, Math.max(0, occlusionFrac)),
  };
}

export const combine = (rawProb: number, v: Visibility): number =>
  Math.min(MAX_CONFIDENCE, Math.max(0.01, rawProb * v.range * v.sun * v.haze * v.occlusion));

/** Posterior over model classes for one tile (softmax of log-likelihood / temperature). */
export function classifyTile(model: DetectorModel, feat: Float32Array, offset: number, out: Float32Array): void {
  let max = -Infinity;
  const K = model.classes.length;
  for (let k = 0; k < K; k++) {
    const c = model.classes[k]!;
    let lp = Math.log(c.prior);
    for (let i = 0; i < NF; i++) {
      const v = Math.max(c.variance[i]!, 1e-6);
      const d = feat[offset + i]! - c.mean[i]!;
      lp += -0.5 * (Math.log(2 * Math.PI * v) + (d * d) / v);
    }
    out[k] = lp / model.temperature;
    if (out[k]! > max) max = out[k]!;
  }
  let s = 0;
  for (let k = 0; k < K; k++) {
    out[k] = Math.exp(out[k]! - max);
    s += out[k]!;
  }
  for (let k = 0; k < K; k++) out[k] = out[k]! / s;
}

const OBJECT = { minHeightM: 0.07, maxHeightM: 1.6, minWidthM: 0.1, maxWidthM: 3.2, minAreaHalfPx: 5, boulderWidthM: 0.8, windowHalfM: 2.0 };

export class Detector {
  /** Counts of why rock candidates were kept or rejected on the last frame (diagnostics). */
  debug: Record<string, number> = {};
  constructor(private model: DetectorModel | null) {}

  detect(frame: AgentFrame): DetectionResult {
    const t0 = performance.now();
    const b = basisOf(frame.meta);
    const grid = extractTiles(frame);
    const tileClass = new Int8Array(grid.tw * grid.th).fill(-1);
    const detections: Detection[] = [];
    if (this.model) this.terrain(frame, b, grid, tileClass, detections);
    this.objects(frame, b, detections);
    detections.forEach((d, i) => (d.id = i + 1));
    return { detections, tileClass, tw: grid.tw, th: grid.th, ms: performance.now() - t0 };
  }

  // ---- terrain regions -------------------------------------------------------------------
  private terrain(frame: AgentFrame, b: Basis, grid: TileGrid, tileClass: Int8Array, out: Detection[]): void {
    const model = this.model!;
    const { tw, th } = grid;
    const K = model.classes.length;
    const n = tw * th;
    const post = new Float32Array(n * K);
    const label = new Int16Array(n).fill(-1);
    const tmp = new Float32Array(K);
    for (let t = 0; t < n; t++) {
      if (!grid.valid[t]) continue;
      classifyTile(model, grid.feat, t * NF, tmp);
      let best = 0;
      for (let k = 0; k < K; k++) {
        post[t * K + k] = tmp[k]!;
        if (tmp[k]! > tmp[best]!) best = k;
      }
      label[t] = best;
    }
    // 3x3 modal filter removes speckle
    const sm = new Int16Array(n).fill(-1);
    const votes = new Float32Array(K);
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const t = ty * tw + tx;
        if (label[t]! < 0) continue;
        votes.fill(0);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = tx + dx, y = ty + dy;
          if (x < 0 || y < 0 || x >= tw || y >= th) continue;
          const l = label[y * tw + x]!;
          if (l >= 0) votes[l] = votes[l]! + 1;
        }
        let best = label[t]!;
        for (let k = 0; k < K; k++) if (votes[k]! > votes[best]!) best = k;
        sm[t] = best;
      }
    }
    // connected regions of equal smoothed class
    const seen = new Uint8Array(n);
    const stack: number[] = [];
    const sunEl = frame.meta.sunElevationDeg;
    const tau = frame.meta.tau;
    const P: [number, number, number] = [0, 0, 0];
    for (let s = 0; s < n; s++) {
      if (seen[s] || sm[s]! < 0) continue;
      const k = sm[s]!;
      const tiles: number[] = [];
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        const t = stack.pop()!;
        tiles.push(t);
        const x = t % tw, y = (t / tw) | 0;
        const nb = [x > 0 ? t - 1 : -1, x < tw - 1 ? t + 1 : -1, y > 0 ? t - tw : -1, y < th - 1 ? t + tw : -1];
        for (const q of nb) if (q >= 0 && !seen[q] && sm[q] === k) { seen[q] = 1; stack.push(q); }
      }
      if (tiles.length < 6) continue;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, rs = 0, ps = 0, edge = 0;
      const ranges: number[] = [];
      for (const t of tiles) {
        const x = t % tw, y = (t / tw) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        ranges.push(grid.range[t]!);
        ps += post[t * K + k]!;
        edge += grid.edge[t]!;
        rs += 1;
      }
      ranges.sort((a, c) => a - c);
      const range = ranges[ranges.length >> 1]!;
      const raw = ps / rs;
      const vis = visibility(range, sunEl, tau, edge / tiles.length);
      const cx = (x0 + x1 + 1) * 0.5 * TILE, cy = (y0 + y1 + 1) * 0.5 * TILE;
      pointAt(b, cx, cy, range, P);
      const cwx = P[0], cwz = P[2];
      const cls = model.classes[k]!.id;
      for (const t of tiles) tileClass[t] = cls;
      // ground footprint: up to 24 evenly spaced tiles within 450 m, each located with its own range
      const near = tiles.filter((t) => grid.range[t]! <= 450);
      const step = Math.max(1, Math.floor(near.length / 24));
      const footprint: { x: number; z: number }[] = [];
      for (let q = 0; q < near.length; q += step) {
        const t = near[q]!;
        pointAt(b, ((t % tw) + 0.5) * TILE, (((t / tw) | 0) + 0.5) * TILE, grid.range[t]!, P);
        footprint.push({ x: P[0], z: P[2] });
      }
      out.push({
        id: 0, cls, name: className(cls), kind: 'terrain', confidence: combine(raw, vis), rawProb: raw,
        bbox: { x0: x0 * TILE, y0: y0 * TILE, x1: (x1 + 1) * TILE, y1: (y1 + 1) * TILE },
        rangeM: range, areaPx: tiles.length * TILE * TILE, world: { x: cwx, z: cwz }, factors: vis, tiles, footprint,
      });
    }
  }

  // ---- rocks: compact bumps above the local ground (morphological top-hat), sized physically --------------
  private objects(frame: AgentFrame, b: Basis, out: Detection[]): void {
    const { width: w, height: h } = frame.meta;
    const W = w >> 1, H = h >> 1;
    const y = new Float32Array(W * H);
    const depth = new Float32Array(W * H);
    const luma = new Float32Array(W * H);
    const P: [number, number, number] = [0, 0, 0];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const p = j * 2 * w + i * 2;
        const k = j * W + i;
        luma[k] = 0.299 * frame.rgba[p * 4]! + 0.587 * frame.rgba[p * 4 + 1]! + 0.114 * frame.rgba[p * 4 + 2]!;
        const d = frame.depthM[p]!;
        if (Number.isFinite(d)) {
          depth[k] = d;
          pointAt(b, i * 2, j * 2, d, P);
          y[k] = P[1];
        } else depth[k] = 0;
      }
    }
    // Top-hat = height - opening(height). The structuring element is about 3 m wide, so it removes terrain
    // wider than a boulder and keeps compact bumps. One scale per depth band because pixel size grows with range.
    const bands = [0, 10, 30, 80, Infinity];
    const tops = bands.slice(0, -1).map((lo, bi) => {
      const mid = Math.min(bands[bi + 1]!, lo * 2 + 8) * 0.7 + 3;
      const R = Math.min(100, Math.max(4, Math.round(OBJECT.windowHalfM / (metresPerPixel(mid) * 2))));
      return this.tophat(y, depth, W, H, R);
    });
    const dbg = (this.debug = { candPx: 0, comps: 0, small: 0, size: 0, shape: 0, kept: 0 });
    const cand = new Uint8Array(W * H);
    const resid = new Float32Array(W * H);
    for (let j = 1; j < H - 1; j++) {
      for (let i = 1; i < W - 1; i++) {
        const k = j * W + i;
        const d = depth[k]!;
        if (d <= 0) continue;
        // depth discontinuity (silhouette against a far background) is not a bump
        if (Math.abs(depth[k + 1]! - d) / d > 0.1 || Math.abs(depth[k + W]! - d) / d > 0.1 || depth[k + 1]! <= 0 || depth[k + W]! <= 0) continue;
        let bi = 0;
        while (bi < bands.length - 2 && d >= bands[bi + 1]!) bi++;
        const r = tops[bi]![k]!;
        resid[k] = r;
        if (r > OBJECT.minHeightM) { cand[k] = 1; dbg.candPx++; }
      }
    }
    // 8-connected components of candidate pixels
    const seen = new Uint8Array(W * H);
    const stack: number[] = [];
    const sunEl = frame.meta.sunElevationDeg;
    const tau = frame.meta.tau;
    for (let s = 0; s < W * H; s++) {
      if (!cand[s] || seen[s]) continue;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, cnt = 0, dsum = 0, hmax = 0, lsum = 0;
      const pix: number[] = [];
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        const k = stack.pop()!;
        const i = k % W, j = (k / W) | 0;
        pix.push(k);
        cnt++; dsum += depth[k]!; hmax = Math.max(hmax, resid[k]!); lsum += luma[k]!;
        x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const q = jj * W + ii;
          if (cand[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      dbg.comps++;
      if (cnt < OBJECT.minAreaHalfPx) { dbg.small++; continue; }
      const range = dsum / cnt;
      const wPx = (x1 - x0 + 1) * 2, hPx = (y1 - y0 + 1) * 2;
      const mpp = metresPerPixel(range);
      const widthM = wPx * mpp;
      const fill = cnt / ((x1 - x0 + 1) * (y1 - y0 + 1));
      const aspect = wPx / hPx;
      if (widthM < OBJECT.minWidthM || widthM > OBJECT.maxWidthM || hmax > OBJECT.maxHeightM) { dbg.size++; continue; }
      if (aspect < 0.3 || aspect > 4 || fill < 0.3) { dbg.shape++; continue; }
      dbg.kept++;
      // soft cue: rocks are darker than the ground around them; bright sand ripples are not
      const m = Math.max(3, Math.round(0.3 * Math.max(x1 - x0, y1 - y0)));
      let ring = 0, rn = 0;
      for (let jj = Math.max(0, y0 - m); jj <= Math.min(H - 1, y1 + m); jj++) {
        for (let ii = Math.max(0, x0 - m); ii <= Math.min(W - 1, x1 + m); ii++) {
          if (ii >= x0 && ii <= x1 && jj >= y0 && jj <= y1) continue;
          if (depth[jj * W + ii]! > 0) { ring += luma[jj * W + ii]!; rn++; }
        }
      }
      const dark = rn > 0 ? (ring / rn - lsum / cnt) / (ring / rn + 1) : 0;
      const touches = x0 <= 1 || y0 <= 1 || x1 >= W - 2 || y1 >= H - 2;
      const vis = visibility(range, sunEl, tau, touches ? 1 : 0);
      const raw = 0.9 * (1 - Math.exp(-cnt / 25)) * (1 - Math.exp(-hmax / 0.1)) * Math.min(1, Math.max(0.4, 0.55 + 3 * dark));
      pointAt(b, x0 + x1 + 1, y0 + y1 + 1, range, P);
      const cls = widthM >= OBJECT.boulderWidthM ? C.Boulder : C.Cobble;
      out.push({
        id: 0, cls, name: className(cls), kind: 'object', confidence: combine(raw, vis), rawProb: raw,
        bbox: { x0: x0 * 2, y0: y0 * 2, x1: (x1 + 1) * 2, y1: (y1 + 1) * 2 },
        rangeM: range, areaPx: cnt * 4, sizeM: widthM, heightM: hmax, world: { x: P[0], z: P[2] }, factors: vis,
      });
    }
  }

  /** height - opening(height) with a (2R+1)^2 square element; invalid pixels (depth 0) are ignored. O(N) per pass (van Herk). */
  private tophat(y: Float32Array, depth: Float32Array, W: number, H: number, R: number): Float32Array {
    const BIG = 1e9;
    const lo = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) lo[k] = depth[k]! > 0 ? y[k]! : BIG;
    const eroded = filter2d(lo, W, H, R, true);
    const hi = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) hi[k] = eroded[k]! >= BIG ? -BIG : eroded[k]!;
    const opened = filter2d(hi, W, H, R, false);
    const out = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) out[k] = depth[k]! > 0 && opened[k]! > -BIG ? y[k]! - opened[k]! : 0;
    return out;
  }
}

/** Separable square min (erosion) or max (dilation) filter, window 2R+1, van Herk / Gil-Werman. */
function filter2d(src: Float32Array, W: number, H: number, R: number, isMin: boolean): Float32Array {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const line = new Float32Array(Math.max(W, H));
  const res = new Float32Array(Math.max(W, H));
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) line[i] = src[j * W + i]!;
    filter1d(line, res, W, R, isMin);
    for (let i = 0; i < W; i++) tmp[j * W + i] = res[i]!;
  }
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) line[j] = tmp[j * W + i]!;
    filter1d(line, res, H, R, isMin);
    for (let j = 0; j < H; j++) out[j * W + i] = res[j]!;
  }
  return out;
}

function filter1d(a: Float32Array, out: Float32Array, n: number, R: number, isMin: boolean): void {
  const k = 2 * R + 1;
  if (k >= 2 * n) {
    let v = isMin ? Infinity : -Infinity;
    for (let i = 0; i < n; i++) v = isMin ? Math.min(v, a[i]!) : Math.max(v, a[i]!);
    for (let i = 0; i < n; i++) out[i] = v;
    return;
  }
  const f = isMin ? Math.min : Math.max;
  const id = isMin ? Infinity : -Infinity;
  const m = n + 2 * R + k;
  const g = new Float32Array(m);
  const hh = new Float32Array(m);
  const padded = new Float32Array(m);
  padded.fill(id);
  for (let i = 0; i < n; i++) padded[i + R] = a[i]!;
  for (let i = 0; i < m; i++) g[i] = i % k === 0 ? padded[i]! : f(g[i - 1]!, padded[i]!);
  for (let i = m - 1; i >= 0; i--) hh[i] = i === m - 1 || (i + 1) % k === 0 ? padded[i]! : f(hh[i + 1]!, padded[i]!);
  for (let i = 0; i < n; i++) out[i] = f(hh[i]!, g[i + k - 1]!);
}
