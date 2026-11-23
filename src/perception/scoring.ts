import type { Detection, DetectionResult } from './detector';
import { TILE } from './features';
import type { AgentFrame, TruthFrame } from './types';

/** EVALUATION ONLY. This is the only perception code that reads ground truth; the agent never imports it. */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TruthRegion {
  cls: number;
  kind: 'terrain' | 'object';
  bbox: Box;
  hit: boolean;
}

export interface FrameScore {
  /** detection id -> outcome ('ignored' when there is too little ground truth to judge it). */
  outcome: Map<number, 'tp' | 'fp' | 'ignored'>;
  truthRegions: TruthRegion[];
}

export interface ClassTally {
  /** detections judged correct / incorrect */
  tp: number;
  fp: number;
  /** ground-truth regions or rocks that were visible / that were found */
  total: number;
  hit: number;
}

const MIN_TRUTH_TILES = 6;
const MIN_TRUTH_ROCK_PX = 20;
const IOU_MIN = 0.2;
const TILE_PURITY = 0.6;
const HIT_FRACTION = 0.4;

export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return u > 0 ? inter / u : 0;
}

export function scoreFrame(res: DetectionResult, frame: AgentFrame, truth: TruthFrame): FrameScore {
  const w = frame.meta.width;
  const { tw, th } = res;
  const cache = new Map<number, { kind: string; cls: number } | null>();
  const look = (id: number) => {
    let v = cache.get(id);
    if (v === undefined) {
      v = id > 0 ? (truth.lookup(id) ?? null) : null;
      cache.set(id, v);
    }
    return v;
  };

  // per-tile truth class (terrain only, majority with purity), and per-rock pixel boxes
  const ttile = new Int8Array(tw * th).fill(-1);
  const counts = new Uint16Array(16);
  const rocks = new Map<number, { cls: number; x0: number; y0: number; x1: number; y1: number; n: number }>();
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      counts.fill(0);
      let known = 0;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const px = tx * TILE + x, py = ty * TILE + y;
          const p = py * w + px;
          const id = truth.ids[p]!;
          if (!Number.isFinite(frame.depthM[p]!)) continue;
          const o = look(id);
          if (!o) continue;
          if (o.kind === 'rock') {
            const r = rocks.get(id);
            if (r) { r.x0 = Math.min(r.x0, px); r.y0 = Math.min(r.y0, py); r.x1 = Math.max(r.x1, px + 1); r.y1 = Math.max(r.y1, py + 1); r.n++; }
            else rocks.set(id, { cls: o.cls, x0: px, y0: py, x1: px + 1, y1: py + 1, n: 1 });
            continue;
          }
          counts[o.cls]!++;
          known++;
        }
      }
      if (known < 32) continue;
      let best = 0;
      for (let c = 1; c < 16; c++) if (counts[c]! > counts[best]!) best = c;
      if (counts[best]! / known >= TILE_PURITY) ttile[ty * tw + tx] = best;
    }
  }

  const outcome = new Map<number, 'tp' | 'fp' | 'ignored'>();
  const truthRegions: TruthRegion[] = [];

  // terrain detections: correct if at least half of the judged tiles carry the predicted class
  for (const d of res.detections) {
    if (d.kind !== 'terrain') continue;
    let known = 0, same = 0;
    for (const t of d.tiles!) {
      if (ttile[t]! < 0) continue;
      known++;
      if (ttile[t] === d.cls) same++;
    }
    outcome.set(d.id, known < 3 ? 'ignored' : same / known >= 0.5 ? 'tp' : 'fp');
  }
  // terrain truth regions (connected equal-class tiles): hit if enough of it is labelled with the right class
  const seen = new Uint8Array(tw * th);
  const stack: number[] = [];
  for (let s = 0; s < tw * th; s++) {
    if (seen[s] || ttile[s]! < 0) continue;
    const cls = ttile[s]!;
    const tiles: number[] = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const t = stack.pop()!;
      tiles.push(t);
      const x = t % tw, y = (t / tw) | 0;
      const nb = [x > 0 ? t - 1 : -1, x < tw - 1 ? t + 1 : -1, y > 0 ? t - tw : -1, y < th - 1 ? t + tw : -1];
      for (const q of nb) if (q >= 0 && !seen[q] && ttile[q] === cls) { seen[q] = 1; stack.push(q); }
    }
    if (tiles.length < MIN_TRUTH_TILES) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, ok = 0;
    for (const t of tiles) {
      const x = t % tw, y = (t / tw) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (res.tileClass[t] === cls) ok++;
    }
    truthRegions.push({ cls, kind: 'terrain', bbox: { x0: x0 * TILE, y0: y0 * TILE, x1: (x1 + 1) * TILE, y1: (y1 + 1) * TILE }, hit: ok / tiles.length >= HIT_FRACTION });
  }

  // rocks: greedy highest-confidence-first matching by box overlap
  const truthRocks = [...rocks.values()].filter((r) => r.n >= MIN_TRUTH_ROCK_PX);
  const used = new Set<number>();
  const objs = res.detections.filter((d) => d.kind === 'object').sort((a, b) => b.confidence - a.confidence);
  const hitRock = new Set<number>();
  for (const d of objs) {
    let best = -1, bi = 0;
    truthRocks.forEach((r, i) => {
      if (used.has(i)) return;
      const v = iou(d.bbox, r);
      if (v > bi) { bi = v; best = i; }
    });
    if (best >= 0 && bi >= IOU_MIN) {
      used.add(best);
      if (truthRocks[best]!.cls === d.cls) { outcome.set(d.id, 'tp'); hitRock.add(best); } else outcome.set(d.id, 'fp');
    } else outcome.set(d.id, 'fp');
  }
  truthRocks.forEach((r, i) => truthRegions.push({ cls: r.cls, kind: 'object', bbox: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }, hit: hitRock.has(i) }));
  return { outcome, truthRegions };
}

/** Running totals across frames, plus a confidence reliability table. */
export class Metrics {
  readonly perClass = new Map<number, ClassTally>();
  /** 10 confidence bins: judged detections and how many were correct. */
  readonly bins = Array.from({ length: 10 }, () => ({ n: 0, tp: 0, sumConf: 0 }));
  frames = 0;
  detections = 0;
  msTotal = 0;

  private tally(cls: number): ClassTally {
    let t = this.perClass.get(cls);
    if (!t) this.perClass.set(cls, (t = { tp: 0, fp: 0, total: 0, hit: 0 }));
    return t;
  }

  add(dets: Detection[], score: FrameScore, ms: number): void {
    this.frames++;
    this.msTotal += ms;
    this.detections += dets.length;
    for (const d of dets) {
      const o = score.outcome.get(d.id);
      if (o === 'ignored' || !o) continue;
      const t = this.tally(d.cls);
      if (o === 'tp') t.tp++;
      else t.fp++;
      const bin = this.bins[Math.min(9, Math.floor(d.confidence * 10))]!;
      bin.n++;
      bin.sumConf += d.confidence;
      if (o === 'tp') bin.tp++;
    }
    for (const r of score.truthRegions) {
      const t = this.tally(r.cls);
      t.total++;
      if (r.hit) t.hit++;
    }
  }

  precision(cls: number): number | null {
    const t = this.perClass.get(cls);
    return t && t.tp + t.fp > 0 ? t.tp / (t.tp + t.fp) : null;
  }
  recall(cls: number): number | null {
    const t = this.perClass.get(cls);
    return t && t.total > 0 ? t.hit / t.total : null;
  }
  get meanMs(): number {
    return this.frames ? this.msTotal / this.frames : 0;
  }
}

