import { findPath, lineClear, MAX_SLOPE_DEG } from '../nav/astar';
import type { NavGrid } from '../nav/navgrid';
import type { SimClock } from '../sim/clock';
import { type Battery, type EnergyParams, type PowerMode, drivePowerW, loadW, solarPowerW } from '../sim/energy';
import { secondsToSunCrossing, sunAt } from '../sim/environment';
import type { Rover } from '../sim/rover';
import type { Rock } from '../world/rocks';
import { KnownMap } from './knownMap';
import type { Decision, Observation, Planner } from './planner';
import { WORK_SUN_DEG } from './utilityPlanner';

export type AgentMode = 'driving' | 'idle' | 'hibernating' | 'thinking';

export interface LogEntry {
  t: number;
  sol: number;
  localHours: number;
  stage: 'sense' | 'detect' | 'assess' | 'decide' | 'act' | 'report';
  text: string;
}

/** Hazard camera range: the rover notices rocks this close (a hazcam-like short-range sense). */
export const HAZCAM_RANGE_M = 14;
/** Radius around the rover counted as seen for exploration coverage (until the mast camera lands in stage 3). */
export const SENSE_RADIUS_M = 60;

/**
 * Loop each tick: sense -> detect -> assess -> decide -> act -> report.
 * Stage 2 implements sense (hazcam + coverage), assess (energy), decide, act and report.
 * `detect` is a hook for the mast-camera detector (stage 4).
 */
export class Agent {
  mode: AgentMode = 'idle';
  goal: { x: number; z: number } | null = null;
  readonly known: KnownMap;
  readonly log: LogEntry[] = [];
  powerW = { generated: 0, consumed: 0 };
  replans = 0;
  private pending: Promise<Decision> | null = null;
  private lastSenseT = -Infinity;
  private hibernating = false;
  private sawNight = false;
  private nextDecisionT = 0;

  constructor(
    private rover: Rover,
    private battery: Battery,
    private clock: SimClock,
    private grid: NavGrid,
    private rocks: Rock[],
    private planner: Planner,
    private energy: EnergyParams,
    public tau: number,
  ) {
    this.known = new KnownMap(grid);
    this.say('report', `agent online, planner ${planner.name}, ${energy.batteryCapacityWh} Wh battery`);
  }

  get plannerName(): string {
    return this.planner.name;
  }

  say(stage: LogEntry['stage'], text: string): void {
    this.log.push({ t: this.clock.t, sol: this.clock.sol, localHours: this.clock.localHours, stage, text });
    if (this.log.length > 400) this.log.splice(0, 100);
  }

  /** Advance the whole rover system by dt sim seconds. */
  step(dt: number): void {
    const sun = sunAt(this.clock.localHours);
    const sunDeg = (sun.elevation * 180) / Math.PI;

    // sense
    if (this.clock.t - this.lastSenseT >= 5) {
      this.lastSenseT = this.clock.t;
      this.sense();
    }

    // hibernation bookkeeping
    if (this.hibernating) {
      if (sunDeg < WORK_SUN_DEG) this.sawNight = true;
      const wake = this.sawNight && sunDeg > WORK_SUN_DEG + 2 && this.battery.soc > 0.4;
      if (wake) {
        this.hibernating = false;
        this.sawNight = false;
        this.mode = 'idle';
        this.say('report', `waking at ${sunDeg.toFixed(1)}° sun, battery ${(this.battery.soc * 100).toFixed(0)}%`);
      }
    }

    // decide
    if (!this.hibernating && !this.rover.driving && this.pending === null && this.clock.t >= this.nextDecisionT) {
      this.requestDecision(sunDeg);
    }

    // act
    this.checkPathStillClear();
    const mode: PowerMode = this.hibernating ? 'hibernate' : this.rover.driving ? 'drive' : 'idle';
    if (!this.hibernating) this.rover.step(dt);
    else this.rover.stop();
    if (this.mode !== 'thinking' || this.hibernating) this.mode = this.hibernating ? 'hibernating' : this.rover.driving ? 'driving' : 'idle';
    if (this.goal && !this.rover.driving) {
      this.say('report', `arrived at goal (${this.goal.x.toFixed(0)}, ${this.goal.z.toFixed(0)}), odometer ${this.rover.odometerM.toFixed(0)} m`);
      this.goal = null;
      this.nextDecisionT = this.clock.t + 60;
    }

    // assess energy
    const gen = solarPowerW(this.energy, sun.elevation, this.tau);
    const con = (mode === 'drive' ? drivePowerW(this.energy, this.rover.speed, this.rover.climbRate) : 0) + loadW(this.energy, mode, mode !== 'hibernate');
    this.battery.step(gen, con, dt);
    this.powerW = { generated: gen, consumed: con };
  }

  private sense(): void {
    this.known.markExplored(this.rover.x, this.rover.z, SENSE_RADIUS_M);
    let newBlockers = 0;
    for (const r of this.rocks) {
      if (this.known.knownRocks.has(r.id)) continue;
      if (Math.hypot(r.x - this.rover.x, r.z - this.rover.z) <= HAZCAM_RANGE_M && this.known.learnRock(r)) newBlockers++;
    }
    if (newBlockers > 0) this.say('sense', `hazcam: ${newBlockers} new boulder${newBlockers > 1 ? 's' : ''} marked as obstacles`);
    this.detect();
  }

  /** Hook: mast-camera detector runs here from stage 4. */
  private detect(): void {}

  private requestDecision(sunDeg: number): void {
    const lh = this.clock.localHours;
    const obs: Observation = {
      simTime: this.clock.t,
      localHours: lh,
      sunElevationDeg: sunDeg,
      secondsToSunset: secondsToSunCrossing(lh, WORK_SUN_DEG, 'set'),
      secondsToSunrise: secondsToSunCrossing(lh, WORK_SUN_DEG, 'rise'),
      nightSeconds: secondsToSunCrossing(lh, WORK_SUN_DEG, 'rise') - secondsToSunCrossing(lh, WORK_SUN_DEG, 'set'),
      batteryWh: this.battery.wh,
      soc: this.battery.soc,
      tau: this.tau,
      pose: { x: this.rover.x, z: this.rover.z },
      known: this.known,
      grid: this.grid,
      energy: this.energy,
    };
    if (!(obs.nightSeconds > 0)) obs.nightSeconds = 12.4 * 3600;
    const d = this.planner.decide(obs);
    if (d instanceof Promise) {
      this.mode = 'thinking';
      this.pending = d;
      d.then((r) => {
        this.apply(r);
        this.pending = null;
      }).catch((e: unknown) => {
        this.say('decide', `planner failed: ${String(e)}`);
        this.pending = null;
        this.nextDecisionT = this.clock.t + 300;
      });
    } else this.apply(d);
  }

  private apply(d: Decision): void {
    this.say('decide', `${d.kind}: ${d.reason}`);
    if (d.kind === 'drive') {
      this.goal = d.goal;
      this.rover.setPath(d.path.points);
      this.say('act', `driving ${d.path.lengthM.toFixed(0)} m to (${d.goal.x.toFixed(0)}, ${d.goal.z.toFixed(0)}), eta ${(d.etaS / 60).toFixed(0)} min`);
    } else if (d.kind === 'hibernate') {
      this.hibernating = true;
      this.sawNight = false;
      this.rover.stop();
      this.goal = null;
    } else {
      this.nextDecisionT = this.clock.t + d.seconds;
    }
  }

  /** If a newly sensed boulder now blocks the upcoming path, replan to the same goal. */
  private checkPathStillClear(): void {
    if (!this.rover.driving || !this.goal) return;
    const ahead = this.rover.remaining;
    let ax = this.rover.x;
    let az = this.rover.z;
    let dist = 0;
    for (const p of ahead) {
      if (!lineClear(this.grid, this.known.blocked, ax, az, p.x, p.z, MAX_SLOPE_DEG)) {
        const np = findPath(this.grid, this.known.blocked, this.rover.x, this.rover.z, this.goal.x, this.goal.z);
        this.replans++;
        if (np.found) {
          this.rover.setPath(np.points);
          this.say('act', `new obstacle ahead, replanned (${np.lengthM.toFixed(0)} m)`);
        } else {
          this.say('act', 'goal now unreachable, abandoning drive');
          this.rover.stop();
          this.goal = null;
          this.nextDecisionT = this.clock.t + 60;
        }
        return;
      }
      dist += Math.hypot(p.x - ax, p.z - az);
      if (dist > 40) return; // only look 40 m ahead
      ax = p.x;
      az = p.z;
    }
  }
}
