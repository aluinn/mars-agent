import * as THREE from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { PathPoint } from '../nav/astar';
import type { Rock } from '../world/rocks';

export function buildRocks(hm: Heightmap, rocks: Rock[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x4a3f38 }), rocks.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  rocks.forEach((r, i) => {
    e.set(r.id * 1.7, r.id * 2.3, r.id * 0.9);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(r.x, hm.heightAt(r.x, r.z) + r.radius * 0.4, r.z), q, new THREE.Vector3(r.radius, r.radius * 0.7, r.radius));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'rocks';
  return mesh;
}

/** Polyline draped over the terrain. */
export class PathLine {
  readonly line: THREE.Line;
  constructor(private hm: Heightmap) {
    this.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x4fd1ff, depthTest: false, fog: false }));
    this.line.renderOrder = 5;
    this.line.frustumCulled = false;
  }
  set(points: PathPoint[]): void {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 6));
      for (let s = 0; s < n; s++) {
        const t = s / n;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        pts.push(new THREE.Vector3(x, this.hm.heightAt(x, z) + 1.5, z));
      }
    }
    const last = points[points.length - 1];
    if (last) pts.push(new THREE.Vector3(last.x, this.hm.heightAt(last.x, last.z) + 1.5, last.z));
    // Three reuses the position buffer on setFromPoints, which cannot grow, so build a fresh geometry each time.
    this.line.geometry.dispose();
    this.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }
}
