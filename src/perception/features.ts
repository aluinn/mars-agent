import type { AgentFrame } from './types';
import { basisOf, metresPerPixel, pointAt } from './geometry';

export const TILE = 8;
/**
 * Per-tile features, chosen to be robust to lighting:
 *  0 chroma_r   r/(r+g+b)           1 chroma_b   b/(r+g+b)
 *  2 log_rel_luma  ln(tile luma / frame median luma)
 *  3 texture    luma std / mean     4 slope_deg  from the depth-derived plane normal
 *  5 rough      plane-fit residual / tile footprint     6 log_range  ln(axial range in m)
 *  7-10 the mean of features 0, 1, 3, 4 over the 3x3 neighbourhood of valid tiles (context)
 *  11 texture_coarse  std of the four 4x4 sub-block means / mean (bedding-scale banding)
 * Colours are first corrected for atmospheric haze: obs = (1 - f) * true + f * sky, with f = 1 - exp(-(density * range)^2)
 * (density = 0.00025 + 0.00035 * tau, the dust model the camera sees) and `sky` the horizon colour measured from the
 * frame's own sky pixels, so distant ground is not mistaken for a different class.
 */
export const FEATURES = [
  'chroma_r', 'chroma_b', 'log_rel_luma', 'texture', 'slope_deg', 'rough', 'log_range',
  'ctx_chroma_r', 'ctx_chroma_b', 'ctx_texture', 'ctx_slope', 'texture_coarse',
] as const;
export const NF = FEATURES.length;

export interface TileGrid {
  tw: number;
  th: number;
  /** 1 = usable tile with a full set of features. */
  valid: Uint8Array;
  /** 1 = tile touches the horizon / a depth discontinuity / the frame edge (partly occluded or cut off). */
  edge: Uint8Array;
  feat: Float32Array;
  range: Float32Array;
}

const DEFAULT_SKY: [number, number, number] = [215, 170, 125];

/** Mean display colour of the sky pixels (no depth return) in the band just above the horizon; falls back to a default. */
export function estimateSky(f: AgentFrame): [number, number, number] {
  const { width: w, height: h } = f.meta;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const p = y * w + x;
      if (Number.isFinite(f.depthM[p]!)) continue;
      // keep only sky rows near the horizon: the first sky pixel above ground in this column
      if (y + 8 < h && !Number.isFinite(f.depthM[(y + 8) * w + x]!)) continue;
      r += f.rgba[p * 4]!; g += f.rgba[p * 4 + 1]!; b += f.rgba[p * 4 + 2]!; n++;
    }
  }
  return n >= 8 ? [r / n, g / n, b / n] : DEFAULT_SKY;
}

/** Fraction of the haze colour mixed into an observation at axial range `d` (exp-squared fog, as rendered). */
export const hazeFraction = (d: number, tau: number): number => 1 - Math.exp(-(((0.00025 + 0.00035 * tau) * d) ** 2));

/** Compute tile features from the colour image and depth only (no ground truth). */
export function extractTiles(f: AgentFrame): TileGrid {
  const { width: w, height: h } = f.meta;
  const tw = Math.floor(w / TILE);
  const th = Math.floor(h / TILE);
  const n = tw * th;
  const grid: TileGrid = { tw, th, valid: new Uint8Array(n), edge: new Uint8Array(n), feat: new Float32Array(n * NF), range: new Float32Array(n) };
  const b = basisOf(f.meta);
  const sky = estimateSky(f);
  const tau = f.meta.tau;
  const luma = new Float32Array(n);
  const P = [0, 0, 0] as [number, number, number];
  const A: number[] = [0, 0, 0];
  const B: number[] = [0, 0, 0];
  const Cc: number[] = [0, 0, 0];
  const D: number[] = [0, 0, 0];
  const vals: number[] = [];
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const t = ty * tw + tx;
      let sr = 0, sg = 0, sb = 0, finite = 0, dmin = Infinity, dmax = 0, dsum = 0, ls = 0, ls2 = 0;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const p = (ty * TILE + y) * w + tx * TILE + x;
          const r = f.rgba[p * 4]!, g = f.rgba[p * 4 + 1]!, bl = f.rgba[p * 4 + 2]!;
          sr += r; sg += g; sb += bl;
          const l = 0.299 * r + 0.587 * g + 0.114 * bl;
          ls += l; ls2 += l * l;
          const d = f.depthM[p]!;
          if (Number.isFinite(d)) {
            finite++;
            dsum += d;
            if (d < dmin) dmin = d;
            if (d > dmax) dmax = d;
          }
        }
      }
      const cnt = TILE * TILE;
      const tileEdge = tx === 0 || ty === 0 || tx === tw - 1 || ty === th - 1;
      if (finite === 0) continue; // sky
      if (finite < cnt || dmax / dmin > 1.25 || tileEdge) grid.edge[t] = 1;
      if (finite < cnt || dmax / dmin > 1.25) continue;
      const range = dsum / cnt;
      // undo haze (clamped so very distant tiles are not blown up)
      const fz = Math.min(0.75, hazeFraction(range, tau));
      const inv = 1 / (1 - fz);
      sr = Math.max(1, (sr - cnt * fz * sky[0]) * inv);
      sg = Math.max(1, (sg - cnt * fz * sky[1]) * inv);
      sb = Math.max(1, (sb - cnt * fz * sky[2]) * inv);
      const mean = Math.max(1, (ls / cnt - fz * (0.299 * sky[0] + 0.587 * sky[1] + 0.114 * sky[2])) * inv);
      const sd = Math.sqrt(Math.max(0, ls2 / cnt - (ls / cnt) ** 2)) * inv;
      const tot = sr + sg + sb + 1e-6;
      // plane from 3 inner corners, residual at the 4th
      const u0 = tx * TILE + 1, v0 = ty * TILE + 1, u1 = tx * TILE + 6, v1 = ty * TILE + 6;
      const dA = f.depthM[v0 * w + u0]!, dB = f.depthM[v0 * w + u1]!, dC = f.depthM[v1 * w + u0]!, dD = f.depthM[v1 * w + u1]!;
      pointAt(b, u0, v0, dA, P); A[0] = P[0]; A[1] = P[1]; A[2] = P[2];
      pointAt(b, u1, v0, dB, P); B[0] = P[0]; B[1] = P[1]; B[2] = P[2];
      pointAt(b, u0, v1, dC, P); Cc[0] = P[0]; Cc[1] = P[1]; Cc[2] = P[2];
      pointAt(b, u1, v1, dD, P); D[0] = P[0]; D[1] = P[1]; D[2] = P[2];
      const e1 = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!];
      const e2 = [Cc[0]! - A[0]!, Cc[1]! - A[1]!, Cc[2]! - A[2]!];
      let nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
      let ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
      let nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const slope = (Math.acos(Math.min(1, Math.abs(ny))) * 180) / Math.PI;
      const res = Math.abs((D[0]! - A[0]!) * nx + (D[1]! - A[1]!) * ny + (D[2]! - A[2]!) * nz);
      const foot = Math.max(1e-3, Math.hypot(e1[0]!, e1[1]!, e1[2]!));
      luma[t] = mean;
      const o = t * NF;
      grid.valid[t] = 1;
      grid.range[t] = range;
      grid.feat[o] = sr / tot;
      grid.feat[o + 1] = sb / tot;
      grid.feat[o + 3] = sd / (mean + 1);
      grid.feat[o + 4] = slope;
      grid.feat[o + 5] = res / foot;
      grid.feat[o + 6] = Math.log(range);
      // coarse texture: spread of the four 4x4 sub-block mean luminances
      const bm: number[] = [];
      for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
        let q = 0;
        for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
          const pp = (ty * TILE + by * 4 + yy) * w + tx * TILE + bx * 4 + xx;
          q += 0.299 * f.rgba[pp * 4]! + 0.587 * f.rgba[pp * 4 + 1]! + 0.114 * f.rgba[pp * 4 + 2]!;
        }
        bm.push(q / 16);
      }
      const bmean = (bm[0]! + bm[1]! + bm[2]! + bm[3]!) / 4;
      grid.feat[o + 11] = Math.sqrt(bm.reduce((a, c) => a + (c - bmean) ** 2, 0) / 4) / (bmean + 1);
    }
  }
  vals.length = 0;
  for (let t = 0; t < n; t++) if (grid.valid[t]) vals.push(luma[t]!);
  vals.sort((a, c) => a - c);
  const med = vals.length ? vals[vals.length >> 1]! : 1;
  for (let t = 0; t < n; t++) if (grid.valid[t]) grid.feat[t * NF + 2] = Math.log((luma[t]! + 1) / (med + 1));
  // neighbourhood context: mean of features 0, 1, 3, 4 over valid 3x3 neighbours (including the tile itself)
  const src = [0, 1, 3, 4];
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const t = ty * tw + tx;
      if (!grid.valid[t]) continue;
      const acc = [0, 0, 0, 0];
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= tw || y >= th || !grid.valid[y * tw + x]) continue;
        for (let k = 0; k < 4; k++) acc[k]! += grid.feat[(y * tw + x) * NF + src[k]!]!;
        c++;
      }
      for (let k = 0; k < 4; k++) grid.feat[t * NF + 7 + k] = acc[k]! / c;
    }
  }
  return grid;
}

export { metresPerPixel };
