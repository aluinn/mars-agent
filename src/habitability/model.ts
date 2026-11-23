import type { ClassId } from '../world/classes';
import type { Detection } from '../perception/detector';
import { POSITIVE_CLASSES, RULES, WEIGHTS } from './rules';
import { surfaceEnv } from './environment';

/** Detector reliability per class (held-out precision), used to discount evidence. Falls back to 0.5 when unknown. */
export type Reliability = Partial<Record<number, number>>;

interface Acc {
  /** effective number of sightings (a region is one sighting spread over its footprint cells) */
  n: number;
  sumConf: number;
  bestConf: number;
  bestAt: { x: number; z: number } | null;
}

const newAcc = (): Acc => ({ n: 0, sumConf: 0, bestConf: 0, bestAt: null });
/** Verdict thresholds on the patch score. A strong verdict needs high-confidence, multi-line evidence (the score is capped well below 1 by detector reliability). */
export const LEVELS = { weak: 0.025, moderate: 0.07, strong: 0.15 } as const;
const noisyOr = (xs: number[]): number => 1 - xs.reduce((p, x) => p * (1 - Math.min(0.99, Math.max(0, x))), 1);

export interface CellScore {
  score: number;
  water: number;
  energy: number;
  shelter: number;
  perchlorate: number;
  uv: number;
  stability: number;
  /** effective sightings contributing to this cell (0 = no data) */
  sightings: number;
  /** low / medium / high, from sightings and mean confidence */
  certainty: 'none' | 'low' | 'medium' | 'high';
}

export interface Finding {
  cls: ClassId;
  label: string;
  why: string;
  sightings: number;
  meanConfidence: number;
  bestConfidence: number;
  bestAt: { x: number; z: number } | null;
  /** detector precision for this class on held-out frames, if known */
  precision: number | null;
  strength: number;
  /** positive evidence, evidence that counts against habitability, or neither */
  kind: 'positive' | 'negative' | 'neutral';
  assumedMapping: boolean;
  speculative: boolean;
}

export type VerdictLevel = 'none' | 'insufficient' | 'weak' | 'moderate' | 'strong';

export interface Verdict {
  level: VerdictLevel;
  score: number;
  /** Careful headline: never claims life. */
  headline: string;
  summary: string;
  findings: Finding[];
  negatives: { name: string; value: string; note: string }[];
  caveat: string;
}

export interface LogItem {
  sol: number;
  t: number;
  cls: ClassId;
  label: string;
  confidence: number;
  at: { x: number; z: number };
}

/**
 * The agent's belief about habitability, built ONLY from what its detector reported (never ground truth).
 * Evidence is accumulated per coarse map cell and per class; a cell's score combines past-water, energy and shelter
 * evidence (discounted by how reliable the detector is for that class), reduced by perchlorate, UV and cold.
 */
export class HabitabilityMap {
  readonly n: number;
  private readonly half: number;
  private readonly cell: number;
  private readonly acc: Map<number, Acc>[];
  /** orbital slope per cell (degrees), known a priori from the DEM; used for the stability factor */
  private readonly slope: Float32Array;
  readonly log: LogItem[] = [];
  private totals = new Map<number, Acc>();
  detections = 0;
  version = 0;

  constructor(
    half: number,
    n = 64,
    slopeAt: (x: number, z: number) => number = () => 5,
    private reliability: Reliability = {},
  ) {
    this.n = n;
    this.half = half;
    this.cell = (half * 2) / n;
    this.acc = Array.from({ length: n * n }, () => new Map());
    this.slope = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.slope[j * n + i] = slopeAt(-half + (i + 0.5) * this.cell, -half + (j + 0.5) * this.cell);
  }

  setReliability(r: Reliability): void {
    this.reliability = r;
  }

  cellIndex(x: number, z: number): number {
    const i = Math.min(this.n - 1, Math.max(0, Math.floor((x + this.half) / this.cell)));
    const j = Math.min(this.n - 1, Math.max(0, Math.floor((z + this.half) / this.cell)));
    return j * this.n + i;
  }
  cellCentre(idx: number): { x: number; z: number } {
    return { x: -this.half + ((idx % this.n) + 0.5) * this.cell, z: -this.half + (Math.floor(idx / this.n) + 0.5) * this.cell };
  }

  private bump(map: Map<number, Acc>, cls: number, conf: number, share: number, at: { x: number; z: number }): void {
    let a = map.get(cls);
    if (!a) map.set(cls, (a = newAcc()));
    a.n += share;
    a.sumConf += conf * share;
    if (conf > a.bestConf) {
      a.bestConf = conf;
      a.bestAt = at;
    }
  }

  /** Add one detection. Terrain regions spread over their ground footprint; objects count at their own position. */
  add(d: Detection, sol: number, t: number): void {
    if (!RULES[d.cls as ClassId]) return;
    this.detections++;
    const pts = d.footprint && d.footprint.length ? d.footprint : [d.world];
    if (Math.abs(d.world.x) > this.half * 1.5 || Math.abs(d.world.z) > this.half * 1.5) return; // outside the mapped patch
    const share = 1 / pts.length;
    for (const p of pts) {
      if (Math.abs(p.x) > this.half || Math.abs(p.z) > this.half) continue;
      this.bump(this.acc[this.cellIndex(p.x, p.z)]!, d.cls, d.confidence, share, d.world);
    }
    this.bump(this.totals, d.cls, d.confidence, 1, d.world);
    if (POSITIVE_CLASSES.includes(d.cls as ClassId) && d.confidence >= 0.2) {
      this.log.push({ sol, t, cls: d.cls as ClassId, label: RULES[d.cls as ClassId]!.label, confidence: d.confidence, at: d.world });
      if (this.log.length > 300) this.log.splice(0, 100);
    }
    this.version++;
  }

  /** Evidence strength for a class from an accumulator: mean confidence, rising toward it with repeated sightings, discounted by detector reliability. */
  private strength(a: Acc | undefined, cls: number, saturation: number): number {
    if (!a || a.n <= 0) return 0;
    const mean = a.sumConf / a.n;
    const rel = Math.min(1, Math.max(0.15, this.reliability[cls] ?? 0.5));
    return mean * (1 - Math.exp(-a.n / saturation)) * rel;
  }

  private components(get: (cls: number) => Acc | undefined, saturation: number, slopeDeg: number, tau: number, localHours: number) {
    const s = (cls: ClassId) => this.strength(get(cls), cls, saturation);
    const w: number[] = [], e: number[] = [], sh: number[] = [], pc: number[] = [], un: number[] = [];
    for (const k of Object.keys(RULES)) {
      const cls = Number(k) as ClassId;
      const r = RULES[cls]!;
      const v = s(cls);
      if (v <= 0) continue;
      if (r.water) w.push(v * r.water);
      if (r.energy) e.push(v * r.energy);
      if (r.shelter) sh.push(v * r.shelter);
      if (r.perchlorate) pc.push(v * r.perchlorate);
      if (r.unstable) un.push(v * r.unstable);
    }
    const water = noisyOr(w), energy = noisyOr(e), shelter = noisyOr(sh), perch = noisyOr(pc), unstable = noisyOr(un);
    const env = surfaceEnv(localHours, tau);
    const stability = Math.max(0, 1 - slopeDeg / 20) * (1 - 0.5 * unstable);
    const uv = (1 - shelter) * env.uvIndex;
    const positive = WEIGHTS.water * water + WEIGHTS.energy * energy + WEIGHTS.shelter * shelter;
    // Negative factors limit habitability multiplicatively: they never erase evidence, they cap what it is worth.
    const score = positive * (0.7 + 0.3 * stability) * (1 - 0.5 * perch) * (1 - 0.3 * uv) * (1 - 0.15 * env.coldFactor);
    return { score: Math.min(1, Math.max(0, score)), water, energy, shelter, perchlorate: perch, uv, stability };
  }

  cellScore(idx: number, tau = 0.6, localHours = 12): CellScore {
    const m = this.acc[idx]!;
    let total = 0, conf = 0;
    for (const a of m.values()) { total += a.n; conf += a.sumConf; }
    const c = this.components((cls) => m.get(cls), 2, this.slope[idx]!, tau, localHours);
    const meanConf = total > 0 ? conf / total : 0;
    const certainty = total < 0.5 ? 'none' : total < 2 || meanConf < 0.15 ? 'low' : total < 6 ? 'medium' : 'high';
    return { ...c, sightings: total, certainty };
  }

  /** Score for map drawing: -1 where nothing has been detected. */
  heat(tau = 0.6, localHours = 12): Float32Array {
    const out = new Float32Array(this.n * this.n).fill(-1);
    for (let k = 0; k < out.length; k++) if (this.acc[k]!.size > 0) out[k] = this.cellScore(k, tau, localHours).score;
    return out;
  }

  /** How promising (x, z) looks for the planner: its own score plus a share of the best neighbouring score. */
  interestAt(x: number, z: number, tau = 0.6, localHours = 12): number {
    const idx = this.cellIndex(x, z);
    const ci = idx % this.n, cj = Math.floor(idx / this.n);
    let best = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
      const k = j * this.n + i;
      if (this.acc[k]!.size > 0) best = Math.max(best, this.cellScore(k, tau, localHours).score);
    }
    const own = this.acc[idx]!.size > 0 ? this.cellScore(idx, tau, localHours).score : 0;
    return Math.min(1, own + 0.6 * best);
  }

  /** Patch-level assessment from everything detected so far. */
  verdict(tau = 0.6, localHours = 12, meanSlopeDeg = 6): Verdict {
    const get = (cls: number) => this.totals.get(cls);
    const comp = this.components(get, 6, meanSlopeDeg, tau, localHours);
    const findings: Finding[] = [];
    for (const k of Object.keys(RULES)) {
      const cls = Number(k) as ClassId;
      const r = RULES[cls]!;
      const a = this.totals.get(cls);
      if (!a || a.n <= 0) continue;
      findings.push({
        cls, label: r.label, why: r.why, sightings: a.n, meanConfidence: a.sumConf / a.n, bestConfidence: a.bestConf, bestAt: a.bestAt,
        precision: this.reliability[cls] ?? null, strength: this.strength(a, cls, 6), kind: r.water || r.energy || r.shelter ? 'positive' : r.perchlorate || r.unstable ? 'negative' : 'neutral', assumedMapping: !!r.assumedMapping, speculative: !!r.speculative,
      });
    }
    findings.sort((p, q) => (RULES[q.cls]!.water ?? 0) * q.strength + (RULES[q.cls]!.energy ?? 0) * q.strength - ((RULES[p.cls]!.water ?? 0) * p.strength + (RULES[p.cls]!.energy ?? 0) * p.strength));
    const env = surfaceEnv(localHours, tau);
    const level: VerdictLevel = this.detections === 0 ? 'none' : comp.score < LEVELS.weak ? 'insufficient' : comp.score < LEVELS.moderate ? 'weak' : comp.score < LEVELS.strong ? 'moderate' : 'strong';
    const head: Record<VerdictLevel, string> = {
      none: 'No assessment yet',
      insufficient: 'Insufficient evidence so far',
      weak: 'Weak evidence consistent with past habitable conditions',
      moderate: 'Moderate evidence consistent with past habitable conditions',
      strong: 'Strong evidence consistent with past habitable conditions',
    };
    const evidenceClasses = findings.filter((f) => (RULES[f.cls]!.water ?? 0) > 0 || (RULES[f.cls]!.energy ?? 0) > 0);
    const top = evidenceClasses.slice(0, 2).map((f) => f.label.toLowerCase());
    const summary =
      level === 'none'
        ? 'The rover has not yet detected anything it can assess.'
        : level === 'insufficient'
          ? 'Detections so far do not add up to meaningful evidence of past water or usable energy.'
          : `Past-water ${(comp.water * 100).toFixed(0)}%, energy ${(comp.energy * 100).toFixed(0)}%, shelter ${(comp.shelter * 100).toFixed(0)}% (evidence strength, not probability of life)${top.length ? `; strongest findings: ${top.join(', ')}` : ''}.`;
    const precs = findings.map((f) => f.precision).filter((v): v is number => v !== null);
    const caveat = `${this.detections} detections feed this. The detector is imperfect${precs.length ? ` (held-out precision for these classes ranges from ${(Math.min(...precs) * 100).toFixed(0)}% to ${(Math.max(...precs) * 100).toFixed(0)}%)` : ''}, and some mineral classes rest on an assumed mapping. This is evidence consistent with past habitable conditions, not a finding of life.`;
    return {
      level, score: comp.score, headline: head[level], summary, findings, caveat,
      negatives: [
        { name: 'Perchlorates', value: `${(comp.perchlorate * 100).toFixed(0)}%`, note: 'Inferred from detected loose regolith and sand; not measured.' },
        { name: 'UV exposure', value: `${(comp.uv * 100).toFixed(0)}%`, note: `Relative dose now (model), reduced by detected shelter.` },
        { name: 'Cold', value: `${env.temperatureK.toFixed(0)} K`, note: 'Assumed diurnal model; surface stays below freezing most of the time.' },
        { name: 'Stability', value: `${(comp.stability * 100).toFixed(0)}%`, note: 'From terrain slope and detected sand and steep ground.' },
      ],
    };
  }
}

