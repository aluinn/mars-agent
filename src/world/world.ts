import { type NavGrid, buildNavGrid } from '../nav/navgrid';
import { type Heightmap, loadHeightmap, loadImagePixels } from '../terrain/heightmap';
import { type Geology, type UnitsLegend, buildGeology } from './geology';
import { type Rock, generateRocks } from './rocks';

/** Everything that exists in the world. Ground truth: the agent must never read this directly. */
export interface World {
  hm: Heightmap;
  grid: NavGrid;
  geology: Geology;
  rocks: Rock[];
}

export function buildWorld(hm: Heightmap, unitPixels: Uint8ClampedArray | Uint8Array, legend: UnitsLegend): World {
  const grid = buildNavGrid(hm, 1);
  const geology = buildGeology(hm, grid.slope, unitPixels, legend);
  const rocks = generateRocks(hm, geology);
  return { hm, grid, geology, rocks };
}

export async function loadWorld(): Promise<World> {
  const hm = await loadHeightmap();
  const [px, legend] = await Promise.all([loadImagePixels('/data/jezero_units.png'), fetch('/data/jezero_units.json').then((r) => r.json() as Promise<UnitsLegend>)]);
  return buildWorld(hm, px.data, legend);
}
