import type { Heightmap } from '../terrain/heightmap';
import { mulberry32 } from './rng';

export type RockKind = 'boulder' | 'cobble';

/** A synthetic rock placed on the real terrain. NOT mapped from imagery (see docs/DATA_SOURCES.md). */
export interface Rock {
  id: number;
  x: number;
  z: number;
  radius: number;
  kind: RockKind;
}

/** Rocks at least this tall are treated as obstacles (rover ground clearance is ~0.4 m). */
export const OBSTACLE_RADIUS = 0.4;

/**
 * Scatter rocks with an exponential size distribution, denser on steeper ground.
 * Size-frequency shape is qualitatively like Mars landing-site rock populations, not fitted to Jezero counts.
 */
export function generateRocks(hm: Heightmap, seed = 2020, count = 900): Rock[] {
  const rnd = mulberry32(seed);
  const half = hm.sizeMetres / 2;
  const rocks: Rock[] = [];
  let guard = 0;
  while (rocks.length < count && guard++ < count * 50) {
    const x = (rnd() * 2 - 1) * (half - 20);
    const z = (rnd() * 2 - 1) * (half - 20);
    const slope = hm.slopeAt(x, z);
    if (slope > 32) continue;
    if (rnd() > 0.25 + slope / 25) continue; // more rocks where it is steeper
    const radius = 0.08 + -Math.log(1 - rnd() * 0.97) * 0.35;
    rocks.push({ id: rocks.length, x, z, radius, kind: radius >= OBSTACLE_RADIUS ? 'boulder' : 'cobble' });
  }
  return rocks;
}
