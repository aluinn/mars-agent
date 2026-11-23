import { Agent } from '../agent/agent';
import type { Planner } from '../agent/planner';
import { UtilityPlanner } from '../agent/utilityPlanner';
import type { NavGrid } from '../nav/navgrid';
import { type Heightmap, latLonToWorld } from '../terrain/heightmap';
import type { Rock } from '../world/rocks';
import type { World } from '../world/world';
import { SimClock } from './clock';
import { Battery, DEFAULT_ENERGY, type EnergyParams } from './energy';
import { Rover } from './rover';

/** Perseverance landing site (Octavia E. Butler), planetocentric degrees. */
export const LANDING = { lat: 18.4446, lon: 77.4509 };

export class Simulation {
  readonly clock: SimClock;
  readonly grid: NavGrid;
  readonly rocks: Rock[];
  readonly rover: Rover;
  readonly battery: Battery;
  readonly agent: Agent;
  tau = 0.6;
  /** Sim seconds advanced per real second. */
  speed = 600;
  paused = false;

  readonly hm: Heightmap;

  constructor(
    readonly world: World,
    planner: Planner = new UtilityPlanner(),
    energy: EnergyParams = DEFAULT_ENERGY,
    startLocalHours = 8,
  ) {
    const hm = world.hm;
    this.hm = hm;
    this.clock = new SimClock(startLocalHours);
    this.grid = world.grid;
    this.rocks = world.rocks;
    // The landing site lies outside this 2 km patch, so start at the gentlest ground nearest to it inside the patch.
    const p = latLonToWorld(hm.meta, LANDING.lat, LANDING.lon);
    const start = findStart(this.grid, p.x, p.z);
    this.rover = new Rover(hm, start.x, start.z);
    this.battery = new Battery(energy);
    this.agent = new Agent(this.rover, this.battery, this.clock, this.grid, this.rocks, planner, energy, this.tau);
  }

  /** Advance by `realDt` wall seconds, in sub-steps of at most 10 sim seconds. */
  advance(realDt: number): void {
    if (this.paused) return;
    let remaining = Math.min(realDt, 0.1) * this.speed;
    this.agent.tau = this.tau;
    while (remaining > 1e-9) {
      const dt = Math.min(10, remaining);
      this.clock.t += dt;
      this.agent.step(dt);
      remaining -= dt;
    }
  }
}

/** Nearest point to (px, pz) within the patch margin whose neighbourhood is gentle (slope < 6 deg over 40 m). */
function findStart(grid: NavGrid, px: number, pz: number): { x: number; z: number } {
  const lim = grid.half - 120;
  const tx = Math.min(lim, Math.max(-lim, px));
  const tz = Math.min(lim, Math.max(-lim, pz));
  let best = { x: tx, z: tz, score: Infinity };
  for (let dz = -300; dz <= 300; dz += 20) {
    for (let dx = -300; dx <= 300; dx += 20) {
      const x = tx + dx;
      const z = tz + dz;
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      let worst = 0;
      for (let k = 0; k < 9; k++) worst = Math.max(worst, grid.hm.slopeAt(x + ((k % 3) - 1) * 20, z + (Math.floor(k / 3) - 1) * 20));
      const score = worst > 6 ? 1000 + worst : Math.hypot(dx, dz);
      if (score < best.score) best = { x, z, score };
    }
  }
  return best;
}
