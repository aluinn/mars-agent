import { Agent } from '../agent/agent';
import type { Planner } from '../agent/planner';
import { UtilityPlanner } from '../agent/utilityPlanner';
import { type NavGrid, buildNavGrid } from '../nav/navgrid';
import { type Heightmap, latLonToWorld } from '../terrain/heightmap';
import { generateRocks, type Rock } from '../world/rocks';
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

  constructor(
    readonly hm: Heightmap,
    planner: Planner = new UtilityPlanner(),
    energy: EnergyParams = DEFAULT_ENERGY,
    startLocalHours = 8,
  ) {
    this.clock = new SimClock(startLocalHours);
    this.grid = buildNavGrid(hm, 1);
    this.rocks = generateRocks(hm);
    const p = latLonToWorld(hm.meta, LANDING.lat, LANDING.lon);
    // Keep the start inside the patch (the landing site is near its south-east corner).
    const lim = hm.sizeMetres / 2 - 150;
    this.rover = new Rover(hm, Math.min(lim, Math.max(-lim, p.x - 150)), Math.min(lim, Math.max(-lim, p.z - 150)));
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
