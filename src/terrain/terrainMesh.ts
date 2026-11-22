import * as THREE from 'three';
import { CLASS_INFO, C } from '../world/classes';
import type { Geology } from '../world/geology';
import type { Heightmap } from './heightmap';

/**
 * Albedo texture from the ground-truth class map (4.9 m/texel). The colours are SYNTHETIC appearances for each
 * class (see CLASS_INFO), not an orbital image. Delta layering uses real elevation contours as bands.
 */
export function buildAlbedoTexture(hm: Heightmap, geo: Geology): THREE.DataTexture {
  const n = hm.size;
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const cls = geo.classMap[k]!;
    const base = CLASS_INFO[cls]?.albedo ?? [128, 128, 128];
    // Deterministic per-texel hash for +-6% variation (cosmetic albedo texture, not terrain elevation).
    let h = Math.imul(k, 2654435761) >>> 0;
    h ^= h >>> 15;
    const v = 0.94 + ((h & 255) / 255) * 0.12;
    let m = v;
    if (cls === C.LayeredDelta) m *= 0.86 + 0.14 * Math.sin((hm.data[k]! * Math.PI * 2) / 2.5);
    data[k * 4] = Math.min(255, base[0] * m);
    data[k * 4 + 1] = Math.min(255, base[1] * m);
    data[k * 4 + 2] = Math.min(255, base[2] * m);
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Terrain mesh at true scale (1 unit = 1 m, no vertical exaggeration). x = east, z = south, y = up. */
export function buildTerrainGeometry(hm: Heightmap, step = 2): THREE.BufferGeometry {
  const n = Math.floor((hm.size - 1) / step) + 1;
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const half = hm.sizeMetres / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const px = Math.min(i * step, hm.size - 1);
      const pz = Math.min(j * step, hm.size - 1);
      const k = (j * n + i) * 3;
      pos[k] = (px / (hm.size - 1)) * hm.sizeMetres - half;
      pos[k + 1] = hm.data[pz * hm.size + px] ?? 0;
      pos[k + 2] = (pz / (hm.size - 1)) * hm.sizeMetres - half;
      uv[(j * n + i) * 2] = (px + 0.5) / hm.size;
      uv[(j * n + i) * 2 + 1] = (pz + 0.5) / hm.size;
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
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

export function buildTerrainMesh(hm: Heightmap, geo: Geology, step = 2): THREE.Mesh {
  const mesh = new THREE.Mesh(buildTerrainGeometry(hm, step), new THREE.MeshLambertMaterial({ map: buildAlbedoTexture(hm, geo) }));
  mesh.name = 'terrain';
  return mesh;
}
