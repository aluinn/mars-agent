import type { Heightmap } from '../terrain/heightmap';
import { C, type ClassId, ROCK_DENSITY } from './classes';
import type { Geology } from './geology';
import { mulberry32 } from './rng';

export type RockKind = 'boulder' | 'cobble';

/** A synthetic rock placed on the real terrain. NOT mapped from imagery (see docs/DATA_SOURCES.md). */
export interface Rock {
  id: number;
  x: number;
  z: number;
  radius: number;
  kind: RockKind;
  /** Rock type inherited from the bedrock map unit under it (assumed mineral association). */
  lithology: ClassId;
}

/** Rocks at least this tall are treated as obstacles (rover ground clearance is ~0.4 m). */
export const OBSTACLE_RADIUS = 0.4;

/** Ground-truth detection class of a rock: by size. */
export const rockClass = (r: Rock): ClassId => (r.kind === 'boulder' ? C.Boulder : C.Cobble);

/**
 * Scatter rocks with an exponential size distribution. Denser on steeper ground and in talus, sparser on sand.
 * Size-frequency shape is qualitatively like Mars landing-site rock populations, not fitted to Jezero counts.
 */
export function generateRocks(hm: Heightmap, geo: Geology, seed = 2020, count = 8000): Rock[] {
  const rnd = mulberry32(seed);
  const half = hm.sizeMetres / 2;
  const rocks: Rock[] = [];
  let guard = 0;
  while (rocks.length < count && guard++ < count * 80) {
    const x = (rnd() * 2 - 1) * (half - 20);
    const z = (rnd() * 2 - 1) * (half - 20);
    const slope = hm.slopeAt(x, z);
    if (slope > 32) continue;
    const dens = ROCK_DENSITY[geo.surfaceNameAt(x, z)] ?? 1;
    if (rnd() * 3 > (0.25 + slope / 25) * dens) continue;
    const radius = 0.05 + -Math.log(1 - rnd() * 0.97) * 0.28;
    rocks.push({ id: rocks.length, x, z, radius, kind: radius >= OBSTACLE_RADIUS ? 'boulder' : 'cobble', lithology: geo.bedrockClassAt(x, z) as ClassId });
  }
  return rocks;
}
