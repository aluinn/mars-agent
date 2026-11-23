import { type NavGrid, buildNavGrid } from '../nav/navgrid';
import { type Heightmap, loadHeightmap, loadImagePixels } from '../terrain/heightmap';
import type { OrthoImage } from '../terrain/terrainMesh';
import { type Geology, type UnitsLegend, buildGeology } from './geology';
import { type Rock, generateRocks } from './rocks';

/** Everything that exists in the world. Ground truth: the agent must never read this directly. */
export interface World {
  hm: Heightmap;
  grid: NavGrid;
  geology: Geology;
  rocks: Rock[];
  /** Real HiRISE orthoimage luminance for the terrain texture and map, if the file is present. */
  ortho?: OrthoImage;
}

export function buildWorld(hm: Heightmap, unitPixels: Uint8ClampedArray | Uint8Array, legend: UnitsLegend, ortho?: OrthoImage): World {
  const grid = buildNavGrid(hm, 1);
  const geology = buildGeology(hm, grid.slope, unitPixels, legend);
  const rocks = generateRocks(hm, geology);
  return { hm, grid, geology, rocks, ortho };
}

export async function loadWorld(): Promise<World> {
  const hm = await loadHeightmap();
  const [px, legend] = await Promise.all([loadImagePixels('/data/jezero_units.png'), fetch('/data/jezero_units.json').then((r) => r.json() as Promise<UnitsLegend>)]);
  return buildWorld(hm, px.data, legend, await loadOrtho());
}

/** Load the real HiRISE orthoimage (greyscale JPEG) if it was generated; the app works without it. */
async function loadOrtho(): Promise<OrthoImage | undefined> {
  try {
    const head = await fetch('/data/jezero_ortho.jpg', { method: 'HEAD' });
    if (!head.ok || !(head.headers.get('content-type') ?? '').startsWith('image/')) return undefined;
    const px = await loadImagePixels('/data/jezero_ortho.jpg');
    const data = new Uint8Array(px.width * px.height);
    for (let i = 0; i < data.length; i++) data[i] = px.data[i * 4]!;
    return { size: px.width, data };
  } catch {
    return undefined;
  }
}
