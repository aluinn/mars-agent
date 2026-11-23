import * as THREE from 'three';
import type { Geology } from '../world/geology';
import { rockClass, type Rock } from '../world/rocks';
import type { TruthObject } from './types';

/** Object ids: terrain patches are 1..patchCount, rocks are patchCount + 1 + rock.id. 24 bits is plenty. */
export class IdSpace {
  constructor(
    private geo: Geology,
    private rocks: Rock[],
  ) {}

  rockId(r: Rock): number {
    return this.geo.patchCount + 1 + r.id;
  }

  lookup = (id: number): TruthObject | undefined => {
    if (id <= 0) return undefined;
    if (id <= this.geo.patchCount) return { kind: 'terrain', cls: this.geo.patchClass[id]! };
    const r = this.rocks[id - this.geo.patchCount - 1];
    return r ? { kind: 'rock', cls: rockClass(r), rockId: r.id } : undefined;
  };
}

export const idToRgb = (id: number): [number, number, number] => [(id >> 16) & 255, (id >> 8) & 255, id & 255];

/** Per-patch flat colour lookup texture (NEAREST, no colour management) for the terrain. */
export function buildTerrainIdTexture(geo: Geology): THREE.DataTexture {
  const n = geo.size;
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const [r, g, b] = idToRgb(geo.patchId[k]!);
    data[k * 4] = r;
    data[k * 4 + 1] = g;
    data[k * 4 + 2] = b;
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function terrainIdMaterial(geo: Geology): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { idTex: { value: buildTerrainIdTexture(geo) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // Outside the real data patch (mirrored filler terrain) there is no ground truth: id 0 = unknown, excluded from scoring.
    fragmentShader: `precision highp float; uniform sampler2D idTex; varying vec2 vUv;
      void main() {
        bool inside = vUv.x >= 0.0 && vUv.x <= 1.0 && vUv.y >= 0.0 && vUv.y <= 1.0;
        gl_FragColor = vec4(inside ? texture2D(idTex, vUv).rgb : vec3(0.0), 1.0);
      }`,
    blending: THREE.NoBlending,
    fog: false,
  });
}

/** Adds the per-instance id colour attribute to the rocks mesh and returns the flat-colour ID material. */
export function rockIdMaterial(mesh: THREE.InstancedMesh, ids: IdSpace, rocks: Rock[]): THREE.ShaderMaterial {
  const a = new Float32Array(rocks.length * 3);
  rocks.forEach((r, i) => {
    const [R, G, B] = idToRgb(ids.rockId(r));
    a[i * 3] = R / 255;
    a[i * 3 + 1] = G / 255;
    a[i * 3 + 2] = B / 255;
  });
  mesh.geometry.setAttribute('idColor', new THREE.InstancedBufferAttribute(a, 3));
  return new THREE.ShaderMaterial({
    vertexShader: `attribute vec3 idColor; varying vec3 vId;
      void main() {
        vId = idColor;
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: 'precision highp float; varying vec3 vId; void main() { gl_FragColor = vec4(vId, 1.0); }',
    blending: THREE.NoBlending,
    fog: false,
  });
}
