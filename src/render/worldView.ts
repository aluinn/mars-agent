import * as THREE from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { PathPoint } from '../nav/astar';
import { CLASS_INFO } from '../world/classes';
import type { Rock } from '../world/rocks';

/** A lumpy rock shape: an icosphere with fixed noise displacement and a flattened underside. */
function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = Math.sin(x * 4.1 + y * 2.3) * Math.cos(z * 3.7 + x * 1.9) * 0.5 + Math.sin(y * 7.3 + z * 5.1) * 0.25;
    const r = 1 + 0.2 * n;
    p.setXYZ(i, x * r, y < 0 ? y * r * 0.35 : y * r, z * r);
  }
  g.computeVertexNormals();
  return g;
}

export function buildRocks(hm: Heightmap, rocks: Rock[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(rockGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff }), rocks.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  rocks.forEach((r, i) => {
    e.set((r.id * 1.7) % 6.28, (r.id * 2.3) % 6.28, (r.id * 0.9) % 6.28);
    q.setFromEuler(e);
    const flat = 0.55 + ((r.id * 7919) % 100) / 100 * 0.5; // per-rock height/width ratio
    m.compose(new THREE.Vector3(r.x, hm.heightAt(r.x, r.z) + r.radius * 0.25, r.z), q, new THREE.Vector3(r.radius, r.radius * flat, r.radius * (0.8 + ((r.id * 31) % 40) / 100)));
    mesh.setMatrixAt(i, m);
    // Colour follows the (assumed) lithology of the unit beneath, with per-rock brightness variation and a dusty tint.
    const a = CLASS_INFO[r.lithology]?.albedo ?? [90, 80, 70];
    const k = (0.55 + (((r.id * 2654435761) >>> 0) % 100) / 250) / 255;
    col.setRGB(a[0] * k + 0.04, a[1] * k + 0.03, a[2] * k + 0.02, THREE.SRGBColorSpace);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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
