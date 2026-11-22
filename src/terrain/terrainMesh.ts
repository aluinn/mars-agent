import * as THREE from 'three';
import type { Heightmap } from './heightmap';

/** Terrain mesh at true scale (1 unit = 1 m, no vertical exaggeration). x = east, z = south, y = up. */
export function buildTerrainMesh(hm: Heightmap, step = 2): THREE.Mesh {
  const n = Math.floor((hm.size - 1) / step) + 1;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const half = hm.sizeMetres / 2;
  const range = hm.meta.maxElevation - hm.meta.minElevation;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const px = Math.min(i * step, hm.size - 1);
      const pz = Math.min(j * step, hm.size - 1);
      const x = (px / (hm.size - 1)) * hm.sizeMetres - half;
      const z = (pz / (hm.size - 1)) * hm.sizeMetres - half;
      const h = hm.data[pz * hm.size + px] ?? 0;
      const k = (j * n + i) * 3;
      pos[k] = x;
      pos[k + 1] = h;
      pos[k + 2] = z;
      // Albedo: regolith tan, slightly darker low (crater floor), lighter high. Not a mineral map.
      const t = range > 0 ? h / range : 0;
      col[k] = 0.46 + 0.1 * t;
      col[k + 1] = 0.3 + 0.07 * t;
      col[k + 2] = 0.2 + 0.05 * t;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b;
      idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'terrain';
  return mesh;
}
