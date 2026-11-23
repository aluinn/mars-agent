import type { Detection } from '../perception/detector';
import { RULES } from '../habitability/rules';
import type { ClassId } from '../world/classes';
import { C } from '../world/classes';

/** Detector precision per class on held-out frames (discounts how much a detection is worth). */
export type Reliability = Partial<Record<number, number>>;

/** Tracks what has already been sent so repeat sightings of the same thing in the same place are worth less. */
export class NoveltyTracker {
  private seen = new Map<string, number>();
  constructor(private cellM = 120) {}

  private key(cls: number, x: number, z: number): string {
    return `${cls}:${Math.floor(x / this.cellM)}:${Math.floor(z / this.cellM)}`;
  }
  /** 1 for something new, falling toward 0.2 with each earlier transmission of that class in that area. */
  novelty(cls: number, x: number, z: number): number {
    return 1 / (1 + 0.8 * (this.seen.get(this.key(cls, x, z)) ?? 0));
  }
  markSent(cls: number, x: number, z: number): void {
    const k = this.key(cls, x, z);
    this.seen.set(k, (this.seen.get(k) ?? 0) + 1);
  }
}

/** Weight of a detected class for the science return: habitability-relevant evidence counts most, hazards a little. */
export function classWeight(cls: number): number {
  const r = RULES[cls as ClassId];
  if (!r) return 0;
  const evidence = (r.water ?? 0) * 1 + (r.energy ?? 0) * 0.6 + (r.shelter ?? 0) * 0.2;
  if (evidence > 0) return evidence;
  return cls === C.HazardSteep || cls === C.HazardSand ? 0.12 : 0.02; // hazards and background: worth knowing about, not much more
}

/**
 * Science value of an image in [0, 1): the best few detections' weight x confidence x detector reliability x novelty,
 * combined so that several different findings add up but a single frame can never be worth 1.
 */
export function scienceValue(dets: Detection[], tracker: NoveltyTracker, reliability: Reliability = {}): number {
  const terms = dets
    .map((d) => classWeight(d.cls) * d.confidence * Math.min(1, Math.max(0.2, reliability[d.cls] ?? 0.5)) * tracker.novelty(d.cls, d.world.x, d.world.z))
    .filter((v) => v > 0)
    .sort((a, b) => b - a)
    .slice(0, 5);
  const v = 1 - terms.reduce((p, t) => p * (1 - Math.min(0.9, t * 2)), 1);
  return Math.min(0.95, 0.02 + v);
}
