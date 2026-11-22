import type { NavGrid } from '../nav/navgrid';
import type { PathPoint, PathResult } from '../nav/astar';
import type { EnergyParams } from '../sim/energy';
import type { KnownMap } from './knownMap';

/** Everything a planner may look at. Deliberately excludes world ground truth. */
export interface Observation {
  simTime: number;
  localHours: number;
  sunElevationDeg: number;
  /** Sim seconds until the sun drops below the working threshold (Infinity if never within ~1.5 sol). */
  secondsToSunset: number;
  secondsToSunrise: number;
  /** Length of the coming night in sim seconds, for reserve planning. */
  nightSeconds: number;
  batteryWh: number;
  soc: number;
  tau: number;
  pose: PathPoint;
  known: KnownMap;
  grid: NavGrid;
  energy: EnergyParams;
}

export type Decision =
  | { kind: 'drive'; goal: PathPoint; path: PathResult; energyWh: number; etaS: number; reason: string }
  | { kind: 'hibernate'; reason: string }
  | { kind: 'wait'; seconds: number; reason: string };

/**
 * Pluggable decision layer. `decide` may be async, so a future LLM planner (called through a serverless
 * function) can implement this interface without changes to the agent loop. Not built yet.
 */
export interface Planner {
  readonly name: string;
  decide(obs: Observation): Decision | Promise<Decision>;
}
