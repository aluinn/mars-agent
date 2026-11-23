import * as THREE from 'three';
import { CLASS_INFO, C } from '../world/classes';
import type { Geology } from '../world/geology';
import type { Heightmap } from './heightmap';

const REGOLITH = CLASS_INFO[C.Regolith]!.albedo;
/** 0 = every class looks like regolith, 1 = full class colours. */
const CLASS_TINT = 0.55;

/** Optional real orthoimage luminance (HiRISE), same footprint as the heightmap. */
export interface OrthoImage {
  size: number;
  /** 8-bit luminance, row 0 = north. */
  data: Uint8Array;
}

/**
 * Albedo texture: each ground-truth class has a typical colour (SYNTHETIC, see CLASS_INFO), modulated by the real
 * orthoimage luminance when available (so real boulders, ripples and bedding show through), otherwise by a small
 * hash variation. Delta layering gets elevation-contour banding.
 */
export function buildAlbedoTexture(hm: Heightmap, geo: Geology, ortho?: OrthoImage): THREE.DataTexture {
  const n = ortho ? ortho.size : hm.size;
  const f = hm.size / n; // heightmap cells per texel (can be < 1)
  const data = new Uint8Array(n * n * 4);
  let mean = 0;
  if (ortho) {
    for (let k = 0; k < ortho.data.length; k += 7) mean += ortho.data[k]!;
    mean /= Math.ceil(ortho.data.length / 7);
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const hk = Math.min(hm.size - 1, Math.floor(j * f)) * hm.size + Math.min(hm.size - 1, Math.floor(i * f));
      const cls = geo.classMap[hk]!;
      const ca = CLASS_INFO[cls]?.albedo ?? [128, 128, 128];
      // Pull class colours toward the regolith base so the real orthoimage dominates the look and the tints stay subtle.
      const base = [0, 1, 2].map((c) => REGOLITH[c]! + (ca[c]! - REGOLITH[c]!) * CLASS_TINT) as [number, number, number];
      let m: number;
      if (ortho) m = Math.min(1.7, Math.max(0.45, 0.25 + 0.75 * (ortho.data[k]! / mean)));
      else {
        let h = Math.imul(k, 2654435761) >>> 0;
        h ^= h >>> 15;
        m = 0.94 + ((h & 255) / 255) * 0.12;
      }
      if (cls === C.LayeredDelta) m *= 0.9 + 0.1 * Math.sin((hm.data[hk]! * Math.PI * 2) / 2.5);
      data[k * 4] = Math.min(255, base[0] * m);
      data[k * 4 + 1] = Math.min(255, base[1] * m);
      data[k * 4 + 2] = Math.min(255, base[2] * m);
      data[k * 4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** World-space normals at full heightmap resolution (x east, y up, z south), packed into RGB. */
export function buildNormalTexture(hm: Heightmap): THREE.DataTexture {
  const n = hm.size;
  const data = new Uint8Array(n * n * 4);
  const c = hm.cell;
  const h = (i: number, j: number) => hm.data[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))]!;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * c);
      const dz = (h(i, j + 1) - h(i, j - 1)) / (2 * c);
      const l = Math.hypot(dx, 1, dz);
      const k = (j * n + i) * 4;
      data[k] = ((-dx / l) * 0.5 + 0.5) * 255;
      data[k + 1] = ((1 / l) * 0.5 + 0.5) * 255;
      data[k + 2] = ((-dz / l) * 0.5 + 0.5) * 255;
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * One terrain tile. (ox, oz) = (0, 0) is the real data patch; the 8 neighbours MIRROR the patch (height and texture)
 * so the horizon has no edge. Mirrored tiles are visual filler only: they carry no ground truth and the rover never goes there.
 * A short skirt hides cracks between tiles of different resolution.
 */
export function buildTerrainTile(hm: Heightmap, ox: number, oz: number, step: number): THREE.BufferGeometry {
  const n = Math.floor((hm.size - 1) / step) + 1;
  const S = hm.sizeMetres;
  const verts = n * n;
  const skirt = 4 * n;
  const pos = new Float32Array((verts + skirt) * 3);
  const uv = new Float32Array((verts + skirt) * 2);
  const sample = (u: number, v: number) => {
    const x = Math.min(hm.size - 1, Math.round(u * (hm.size - 1)));
    const z = Math.min(hm.size - 1, Math.round(v * (hm.size - 1)));
    return hm.data[z * hm.size + x]!;
  };
  const put = (idx: number, u: number, v: number, dropY: number) => {
    const su = ox !== 0 ? 1 - u : u;
    const sv = oz !== 0 ? 1 - v : v;
    pos[idx * 3] = (ox + u - 0.5) * S;
    pos[idx * 3 + 1] = sample(su, sv) - dropY;
    pos[idx * 3 + 2] = (oz + v - 0.5) * S;
    uv[idx * 2] = ox + u;
    uv[idx * 2 + 1] = oz + v;
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) put(j * n + i, i / (n - 1), j / (n - 1), 0);
  // skirt vertices: duplicate the four edges 4 m lower
  let s = verts;
  const edges: [number, number][][] = [[], [], [], []];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    put(s, t, 0, 4); edges[0]!.push([k, s++]);
    put(s, t, 1, 4); edges[1]!.push([(n - 1) * n + k, s++]);
    put(s, 0, t, 4); edges[2]!.push([k * n, s++]);
    put(s, 1, t, 4); edges[3]!.push([k * n + n - 1, s++]);
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6 + 4 * (n - 1) * 6);
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
  for (const e of edges) {
    for (let k = 0; k < e.length - 1; k++) {
      const [a, as] = e[k]!;
      const [b, bs] = e[k + 1]!;
      idx[o++] = a; idx[o++] = as; idx[o++] = b;
      idx[o++] = b; idx[o++] = as; idx[o++] = bs;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

const DETAIL_GLSL = `
uniform sampler2D uNormalMap;
varying vec3 vWPos;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ return 0.5 * vn(p) + 0.3 * vn(p * 2.7 + 7.1) + 0.2 * vn(p * 7.3 + 3.3); }
`;

/**
 * Terrain material: Lambert with a full-resolution world-space normal map, plus a fine-scale COSMETIC detail layer
 * (grain and micro-bump from value noise, fading out beyond ~250 m). The detail is not elevation data.
 */
export function buildTerrainMaterial(hm: Heightmap, geo: Geology, ortho?: OrthoImage): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ map: buildAlbedoTexture(hm, geo, ortho) });
  const normalTex = buildNormalTexture(hm);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNormalMap = { value: normalTex };
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vWPos;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${DETAIL_GLSL}\nvoid main() {`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  float tdist = length(vViewPosition);
  float tfade = 1.0 - smoothstep(60.0, 260.0, tdist);
  float g1 = fbm(vWPos.xz * 2.3);
  float g2 = fbm(vWPos.xz * 0.37 + 19.0);
  diffuseColor.rgb *= mix(1.0, 0.78 + 0.5 * (0.6 * g1 + 0.4 * g2), tfade);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `vec2 fl = floor(vMapUv);
  vec3 wn = texture2D(uNormalMap, vMapUv).xyz * 2.0 - 1.0;
  if (mod(fl.x, 2.0) > 0.5) wn.x = -wn.x;
  if (mod(fl.y, 2.0) > 0.5) wn.z = -wn.z;
  float bh = fbm(vWPos.xz * 3.1);
  float bx = fbm((vWPos.xz + vec2(0.12, 0.0)) * 3.1) - bh;
  float bz = fbm((vWPos.xz + vec2(0.0, 0.12)) * 3.1) - bh;
  wn = normalize(wn + tfade * 0.9 * vec3(-bx, 0.0, -bz));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`,
      );
  };
  return mat;
}

/** The terrain: the real patch plus 8 mirrored filler tiles. Returns the group and the inner patch mesh. */
export function buildTerrain(hm: Heightmap, geo: Geology, ortho?: OrthoImage, innerStep = 1): { group: THREE.Group; patch: THREE.Mesh } {
  const material = buildTerrainMaterial(hm, geo, ortho);
  const group = new THREE.Group();
  group.name = 'terrain';
  let patch!: THREE.Mesh;
  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const inner = ox === 0 && oz === 0;
      const mesh = new THREE.Mesh(buildTerrainTile(hm, ox, oz, inner ? innerStep : 8), material);
      mesh.receiveShadow = true;
      mesh.castShadow = inner; // only the real patch casts into the (patch-sized) shadow map
      mesh.frustumCulled = true;
      if (inner) patch = mesh;
      else mesh.userData.filler = true;
      group.add(mesh);
    }
  }
  return { group, patch };
}
