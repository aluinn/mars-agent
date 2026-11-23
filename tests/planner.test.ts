import { describe, expect, it } from 'vitest';
import { KnownMap } from '../src/agent/knownMap';
import type { Decision, Observation } from '../src/agent/planner';
import { DEFAULT_WEIGHTS, UtilityPlanner } from '../src/agent/utilityPlanner';
import { HabitabilityMap } from '../src/habitability/model';
import { DEFAULT_ENERGY } from '../src/sim/energy';
import { C } from '../src/world/classes';
import { gridFor, syntheticHeightmap } from './helpers';

function observation(hab: HabitabilityMap): Observation {
  const grid = gridFor(syntheticHeightmap(129, 1000, () => 0));
  return {
    simTime: 0, localHours: 10, sunElevationDeg: 50, secondsToSunset: 20000, secondsToSunrise: 60000, nightSeconds: 44000,
    batteryWh: 1000, soc: 0.85, tau: 0.6, pose: { x: 0, z: 0 }, known: new KnownMap(grid), habitability: hab, grid, energy: DEFAULT_ENERGY,
  };
}
const driveGoal = (d: Decision) => {
  if (d.kind !== 'drive') throw new Error(`expected a drive, got ${d.kind}: ${d.reason}`);
  return d.goal;
};

describe('utility planner uses detected habitability evidence', () => {
  // A broad region of strong clay evidence in the east (x from 160 to 320 m); nothing elsewhere.
  const hab = new HabitabilityMap(500, 64, () => 2, { [C.ClayRich]: 0.9 });
  for (let x = 160; x <= 320; x += 20) {
    for (let z = -200; z <= 200; z += 20) {
      for (let i = 0; i < 8; i++) hab.add({ id: 1, cls: C.ClayRich, name: '', kind: 'terrain', confidence: 0.8, rawProb: 0.8, bbox: { x0: 0, y0: 0, x1: 8, y1: 8 }, rangeM: 40, areaPx: 64, world: { x, z }, factors: { range: 1, sun: 1, haze: 1, occlusion: 1 } }, 1, i);
    }
  }

  it('heads for the promising region, where an otherwise identical planner that ignores evidence does not', () => {
    const ignoring = driveGoal(new UtilityPlanner({ ...DEFAULT_WEIGHTS, habitability: 0 }).decide(observation(hab)));
    const seeking = driveGoal(new UtilityPlanner({ ...DEFAULT_WEIGHTS, habitability: 4 }).decide(observation(hab)));
    expect(seeking.x).toBeGreaterThan(150);
    expect(ignoring.x).toBeLessThan(seeking.x);
  });
  it('still hibernates at night regardless of evidence', () => {
    const o = { ...observation(hab), sunElevationDeg: 1 };
    expect(new UtilityPlanner({ ...DEFAULT_WEIGHTS, habitability: 4 }).decide(o).kind).toBe('hibernate');
  });
});
