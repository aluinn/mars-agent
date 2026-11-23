import { findPath, lineClear, MAX_SLOPE_DEG } from '../nav/astar';
import type { NavGrid } from '../nav/navgrid';
import type { SimClock } from '../sim/clock';
import { type Battery, type EnergyParams, type PowerMode, drivePowerW, loadW, solarPowerW } from '../sim/energy';
import { secondsToSunCrossing, sunAt } from '../sim/environment';
import type { Rover } from '../sim/rover';
import type { Detection, DetectionResult, Detector } from '../perception/detector';
import type { AgentFrame, CaptureRequest } from '../perception/types';
import type { Rock } from '../world/rocks';
import { HabitabilityMap, type Reliability, type VerdictLevel } from '../habitability/model';
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
const BUCKET_M = 32;
const bucketKey = (x: number, z: number): number => Math.floor(x / BUCKET_M) * 4096 + Math.floor(z / BUCKET_M);

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
  /** Rocks bucketed in 32 m cells so the hazard camera only checks nearby ones. */
  private rockBuckets = new Map<number, Rock[]>();
  private nextLookT = 0;
  /** Pending camera requests; the renderer layer fulfils them (the agent has no GPU access). */
  readonly captureQueue: CaptureRequest[] = [];
  /** Latest image the agent has seen. The agent never sees ground truth. */
  lastFrame: AgentFrame | null = null;
  framesTaken = 0;
  /** Detector output for the latest frame, and a bounded memory of everything detected so far (input to habitability scoring). */
  lastResult: DetectionResult | null = null;
  readonly memory: (Detection & { t: number; sol: number })[] = [];
  detector: Detector | null = null;
  /** The agent's belief about habitability, built only from its own detections. */
  readonly habitability: HabitabilityMap;
  private lastLevel: VerdictLevel = 'none';
  private loggedClasses = new Set<number>();

  constructor(
    private rover: Rover,
    private battery: Battery,
    private clock: SimClock,
    private grid: NavGrid,
    rocks: Rock[],
    private planner: Planner,
    private energy: EnergyParams,
    public tau: number,
  ) {
    this.known = new KnownMap(grid);
    this.habitability = new HabitabilityMap(grid.half, 64, (x, z) => grid.hm.slopeAt(x, z));
    for (const r of rocks) {
      const key = bucketKey(r.x, r.z);
      const list = this.rockBuckets.get(key);
      if (list) list.push(r);
      else this.rockBuckets.set(key, [r]);
    }
    this.say('report', `agent online, planner ${planner.name}, ${energy.batteryCapacityWh} Wh battery`);
  }

  takeCaptureRequest(): CaptureRequest | undefined {
    return this.captureQueue.shift();
  }

  requestCapture(req: CaptureRequest): void {
    if (this.captureQueue.length < 6) this.captureQueue.push(req);
  }

  receiveFrame(f: AgentFrame): void {
    this.lastFrame = f;
    this.framesTaken++;
    this.detect(f);
  }

  setReliability(r: Reliability): void {
    this.habitability.setReliability(r);
  }

  setDetector(d: Detector | null): void {
    this.detector = d;
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
      for (const pan of [-24, 0, 24]) this.requestCapture({ panDeg: pan, tiltDeg: -4, reason: 'survey at goal' });
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
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.rockBuckets.get(bucketKey(this.rover.x + dx * BUCKET_M, this.rover.z + dz * BUCKET_M));
        if (!list) continue;
        for (const r of list) {
          if (this.known.knownRocks.has(r.id)) continue;
          if (Math.hypot(r.x - this.rover.x, r.z - this.rover.z) <= HAZCAM_RANGE_M && this.known.learnRock(r)) newBlockers++;
        }
      }
    }
    if (newBlockers > 0) this.say('sense', `hazcam: ${newBlockers} new boulder${newBlockers > 1 ? 's' : ''} marked as obstacles`);
    // Look around: a short look-ahead image while driving, a 3-frame sweep after stopping (daylight only).
    const sunDeg = (sunAt(this.clock.localHours).elevation * 180) / Math.PI;
    if (!this.hibernating && sunDeg > 8 && this.clock.t >= this.nextLookT) {
      this.nextLookT = this.clock.t + (this.rover.driving ? 600 : 1800);
      this.requestCapture({ panDeg: 0, tiltDeg: -4, reason: this.rover.driving ? 'drive look-ahead' : 'survey' });
    }
  }

  /** Assess step: fold detections into the habitability belief and report notable changes. */
  private assess(dets: Detection[]): void {
    for (const d of dets) {
      this.habitability.add(d, this.clock.sol, this.clock.t);
      if (d.confidence >= 0.3 && d.kind === 'terrain' && !this.loggedClasses.has(d.cls) && this.habitability.log.some((l) => l.cls === d.cls)) {
        this.loggedClasses.add(d.cls);
        this.say('assess', `first notable ${d.name} (${(d.confidence * 100).toFixed(0)}% confidence) near (${d.world.x.toFixed(0)}, ${d.world.z.toFixed(0)})`);
      }
    }
    const v = this.habitability.verdict(this.tau, this.clock.localHours);
    if (v.level !== this.lastLevel) {
      this.lastLevel = v.level;
      this.say('assess', `habitability assessment now: ${v.headline.toLowerCase()}`);
    }
  }

  /** The mast-camera detector runs on each received frame: only the image and depth go in. */
  private detect(frame: AgentFrame): void {
    if (!this.detector) return;
    const res = this.detector.detect(frame);
    this.lastResult = res;
    for (const d of res.detections) this.memory.push({ ...d, tiles: undefined, t: this.clock.t, sol: this.clock.sol });
    if (this.memory.length > 800) this.memory.splice(0, this.memory.length - 800);
    const top = [...res.detections].sort((a, b) => b.confidence - a.confidence).slice(0, 3).map((d) => `${d.name} ${(d.confidence * 100).toFixed(0)}%`);
    this.assess(res.detections);
    this.say('detect', `${res.detections.length} detections in ${res.ms.toFixed(0)} ms${top.length ? ': ' + top.join(', ') : ''}`);
  }

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
      habitability: this.habitability,
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
