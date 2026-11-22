import { type PathPoint, findPath, profilePath } from '../nav/astar';
import { driveEnergyWh } from '../sim/energy';
import { ROVER_MAX_SPEED } from '../sim/constants';
import { mulberry32 } from '../world/rng';
import type { Decision, Observation, Planner } from './planner';

export interface UtilityWeights {
  unexplored: number;
  interest: number;
  distance: number;
  energy: number;
}

export const DEFAULT_WEIGHTS: UtilityWeights = { unexplored: 1.0, interest: 0.6, distance: 0.25, energy: 0.3 };

/** Working threshold: the rover stops driving when the sun is lower than this. */
export const WORK_SUN_DEG = 6;
/** Stop driving this long before sunset (seconds) so there is time to settle. */
export const SUNSET_MARGIN_S = 1800;

/**
 * Rule + utility planner. Rules first (night, low battery, no time before sunset), then pick the goal with the
 * highest science-value utility among reachable candidates that fit in the remaining daylight and energy budget.
 * Science value here = unexplored area + orbital relief proxy. Habitability evidence joins in stage 5.
 */
export class UtilityPlanner implements Planner {
  readonly name = 'utility-v1';
  private rnd = mulberry32(7);
  constructor(
    private weights: UtilityWeights = DEFAULT_WEIGHTS,
    private minDriveM = 60,
    private maxDriveM = 450,
  ) {}

  decide(o: Observation): Decision {
    if (o.sunElevationDeg < WORK_SUN_DEG) return { kind: 'hibernate', reason: 'sun below working elevation, hibernating until sunrise' };
    if (o.soc < o.energy.minSocFrac) return { kind: 'wait', seconds: 900, reason: 'battery below minimum, charging in place' };

    const daylightLeft = o.secondsToSunset - SUNSET_MARGIN_S;
    // Keep enough to survive the night on heaters alone (with a 20% margin), PLUS the minimum-charge buffer
    // so the rover still has headroom at dawn.
    const nightReserveWh = (o.energy.hibernateW * o.nightSeconds * 1.2) / 3600;
    const spendableWh = o.batteryWh - nightReserveWh - o.energy.batteryCapacityWh * o.energy.minSocFrac;
    if (daylightLeft < this.minDriveM / ROVER_MAX_SPEED) return { kind: 'hibernate', reason: 'not enough daylight left for a drive, settling for the night' };

    const cands: { p: PathPoint; u: number }[] = [];
    for (let k = 0; k < 60; k++) {
      const ang = this.rnd() * Math.PI * 2;
      const d = this.minDriveM + this.rnd() * (this.maxDriveM - this.minDriveM);
      const p = { x: o.pose.x + Math.cos(ang) * d, z: o.pose.z + Math.sin(ang) * d };
      if (Math.abs(p.x) > o.grid.half - 30 || Math.abs(p.z) > o.grid.half - 30) continue;
      const un = o.known.unexploredNear(p.x, p.z, 80);
      const interest = o.known.interest[o.known.coarseIndex(p.x, p.z)]!;
      const rough = (d / this.maxDriveM) * this.weights.distance;
      cands.push({ p, u: this.weights.unexplored * un + this.weights.interest * interest - rough });
    }
    cands.sort((a, b) => b.u - a.u);

    let tried = 0;
    for (const c of cands) {
      if (tried++ >= 6) break;
      const path = findPath(o.grid, o.known.blocked, o.pose.x, o.pose.z, c.p.x, c.p.z);
      if (!path.found) continue;
      const prof = profilePath(o.grid, path.points);
      const speed = ROVER_MAX_SPEED * 0.85; // conservative average including slope derating
      const etaS = prof.lengthM / speed;
      const energyWh = driveEnergyWh(o.energy, prof.lengthM, prof.climbM, speed);
      if (etaS > daylightLeft) continue;
      if (energyWh > spendableWh) continue;
      const u = c.u - this.weights.energy * (energyWh / o.energy.batteryCapacityWh);
      return {
        kind: 'drive',
        goal: c.p,
        path,
        energyWh,
        etaS,
        reason: `utility ${u.toFixed(2)}: ${(o.known.unexploredNear(c.p.x, c.p.z, 80) * 100).toFixed(0)}% unexplored, ${prof.lengthM.toFixed(0)} m, ${energyWh.toFixed(0)} Wh, max slope ${prof.maxSlopeDeg.toFixed(0)}°`,
      };
    }
    if (o.soc < 0.95) return { kind: 'wait', seconds: 1200, reason: 'no feasible goal this cycle, charging' };
    return { kind: 'hibernate', reason: 'no goal fits the daylight and energy budget, settling for the night' };
  }
}
