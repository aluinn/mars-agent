import { type NavGrid, markDisc } from '../nav/navgrid';
import type { Rock } from '../world/rocks';
import { OBSTACLE_RADIUS } from '../world/rocks';

/** Extra clearance around a boulder (rover half-width ~1.35 m plus margin). */
export const ROVER_CLEARANCE = 2;
export const EXPLORE_CELLS = 64;

/**
 * What the agent knows about the world. Slopes come from the orbital DEM (known a priori, like real
 * mission planning). Rocks are only known once sensed. Exploration coverage is a coarse grid.
 */
export class KnownMap {
  /** 1 where a sensed boulder (plus clearance) blocks driving. */
  readonly blocked: Uint8Array;
  readonly explored = new Float32Array(EXPLORE_CELLS * EXPLORE_CELLS);
  readonly knownRocks = new Set<number>();
  /** Orbital-derived interest proxy per coarse cell (local relief). NOT mineral data. */
  readonly interest = new Float32Array(EXPLORE_CELLS * EXPLORE_CELLS);
  readonly coarse: number;

  constructor(private grid: NavGrid) {
    this.blocked = new Uint8Array(grid.n * grid.n);
    this.coarse = (grid.half * 2) / EXPLORE_CELLS;
    this.buildInterest();
  }

  private buildInterest(): void {
    const hm = this.grid.hm;
    let max = 1e-6;
    for (let j = 0; j < EXPLORE_CELLS; j++) {
      for (let i = 0; i < EXPLORE_CELLS; i++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let s = 0; s < 25; s++) {
          const x = -this.grid.half + (i + (s % 5) / 4) * this.coarse;
          const z = -this.grid.half + (j + Math.floor(s / 5) / 4) * this.coarse;
          const h = hm.heightAt(x, z);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
        const r = hi - lo;
        this.interest[j * EXPLORE_CELLS + i] = r;
        max = Math.max(max, r);
      }
    }
    for (let k = 0; k < this.interest.length; k++) this.interest[k] = this.interest[k]! / max;
  }

  /** Learn about a rock. Returns true if it newly blocks the map. */
  learnRock(r: Rock): boolean {
    if (this.knownRocks.has(r.id)) return false;
    this.knownRocks.add(r.id);
    if (r.radius < OBSTACLE_RADIUS) return false;
    markDisc(this.grid, this.blocked, r.x, r.z, r.radius + ROVER_CLEARANCE);
    return true;
  }

  coarseIndex(x: number, z: number): number {
    const i = Math.min(EXPLORE_CELLS - 1, Math.max(0, Math.floor((x + this.grid.half) / this.coarse)));
    const j = Math.min(EXPLORE_CELLS - 1, Math.max(0, Math.floor((z + this.grid.half) / this.coarse)));
    return j * EXPLORE_CELLS + i;
  }

  /** Mark coarse cells within `radius` of the rover as explored. */
  markExplored(x: number, z: number, radius: number): void {
    const r = Math.ceil(radius / this.coarse);
    const c = this.coarseIndex(x, z);
    const ci = c % EXPLORE_CELLS;
    const cj = Math.floor(c / EXPLORE_CELLS);
    for (let j = Math.max(0, cj - r); j <= Math.min(EXPLORE_CELLS - 1, cj + r); j++) {
      for (let i = Math.max(0, ci - r); i <= Math.min(EXPLORE_CELLS - 1, ci + r); i++) {
        const dx = (i + 0.5) * this.coarse - this.grid.half - x;
        const dz = (j + 0.5) * this.coarse - this.grid.half - z;
        if (dx * dx + dz * dz <= radius * radius) this.explored[j * EXPLORE_CELLS + i] = 1;
      }
    }
  }

  /** Fraction of coarse cells within `radius` of (x, z) not yet explored. */
  unexploredNear(x: number, z: number, radius: number): number {
    const r = Math.ceil(radius / this.coarse);
    const c = this.coarseIndex(x, z);
    const ci = c % EXPLORE_CELLS;
    const cj = Math.floor(c / EXPLORE_CELLS);
    let tot = 0;
    let un = 0;
    for (let j = Math.max(0, cj - r); j <= Math.min(EXPLORE_CELLS - 1, cj + r); j++) {
      for (let i = Math.max(0, ci - r); i <= Math.min(EXPLORE_CELLS - 1, ci + r); i++) {
        tot++;
        if (!this.explored[j * EXPLORE_CELLS + i]) un++;
      }
    }
    return tot ? un / tot : 0;
  }

  exploredFraction(): number {
    let s = 0;
    for (let k = 0; k < this.explored.length; k++) s += this.explored[k]!;
    return s / this.explored.length;
  }
}
