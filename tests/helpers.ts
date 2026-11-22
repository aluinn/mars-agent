import { Heightmap, type HeightmapMeta } from '../src/terrain/heightmap';
import { buildNavGrid } from '../src/nav/navgrid';

/** Build a synthetic heightmap from a function of world (x, z). For tests only. */
export function syntheticHeightmap(size: number, sizeMetres: number, f: (x: number, z: number) => number): Heightmap {
  const data = new Float32Array(size * size);
  const half = sizeMetres / 2;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) data[j * size + i] = f((i / (size - 1)) * sizeMetres - half, (j / (size - 1)) * sizeMetres - half);
  const meta: HeightmapMeta = { outputSize: size, sizeMetres, metresPerPixel: sizeMetres / size, minElevation: 0, maxElevation: 100, source: 'synthetic', doi: '', windowLeftM: 0, windowTopM: 0 };
  return new Heightmap(size, sizeMetres, data, meta);
}

export const gridFor = (hm: Heightmap) => buildNavGrid(hm, 1);
