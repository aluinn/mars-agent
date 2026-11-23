import * as THREE from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { Rover } from '../sim/rover';

const matBody = new THREE.MeshStandardMaterial({ color: 0xcfcac2, roughness: 0.7, metalness: 0.2 });
const matDark = new THREE.MeshStandardMaterial({ color: 0x242b3a, roughness: 0.5, metalness: 0.3 });
const matMetal = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.45, metalness: 0.8 });
const matWheel = new THREE.MeshStandardMaterial({ color: 0x6b6e74, roughness: 0.55, metalness: 0.7 });
const matGold = new THREE.MeshStandardMaterial({ color: 0xb98b2e, roughness: 0.4, metalness: 0.9 });
const matLens = new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.1, metalness: 0.6 });

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  return o;
}
function cyl(r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, rotX = 0, rotZ = 0, seg = 16): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  o.position.set(x, y, z);
  o.rotation.set(rotX, 0, rotZ);
  return o;
}

/** Perseverance-sized (3 m long, 2.7 m wide, wheels 0.52 m) detailed model at true scale, with a marker ring for orbit views. */
export class RoverView {
  readonly group = new THREE.Group();
  private marker: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];

  constructor(private hm: Heightmap) {
    const g = this.group;
    // chassis (warm electronics box) and solar-black top deck
    g.add(box(2.3, 0.55, 2.7, matBody, 0, 0.95, 0));
    g.add(box(2.1, 0.12, 2.4, matDark, 0, 1.28, -0.05));
    g.add(box(2.5, 0.2, 2.9, matMetal, 0, 0.62, 0));
    // RTG at the rear: finned gold cylinder
    g.add(cyl(0.3, 1.1, matGold, 0, 1.0, -1.75, Math.PI / 2, 0, 20));
    for (let i = 0; i < 6; i++) g.add(cyl(0.34, 0.04, matMetal, 0, 1.0, -1.35 - i * 0.18, Math.PI / 2, 0, 20));
    // robotic arm turret at the front
    g.add(box(0.7, 0.35, 0.5, matMetal, 0, 0.9, 1.5));
    g.add(cyl(0.07, 0.9, matMetal, -0.4, 0.8, 1.7, Math.PI / 2.4, 0));
    // mast with camera head
    g.add(cyl(0.05, 1.05, matMetal, 0.55, 1.8, 0.85));
    g.add(box(0.5, 0.22, 0.2, matBody, 0.55, 2.38, 0.85));
    g.add(cyl(0.07, 0.12, matLens, 0.43, 2.4, 0.97, Math.PI / 2, 0));
    g.add(cyl(0.07, 0.12, matLens, 0.67, 2.4, 0.97, Math.PI / 2, 0));
    // high-gain antenna dish and a UHF stub
    const dish = cyl(0.28, 0.04, matMetal, -0.7, 1.75, -0.7, 0.5, 0.2, 24);
    g.add(dish);
    g.add(cyl(0.025, 0.7, matMetal, -0.7, 1.5, -0.7));
    g.add(cyl(0.02, 0.6, matMetal, 0.8, 1.6, -0.9));
    // rocker-bogie: for each side, a rocker bar and a bogie bar plus three wheels
    for (const side of [-1, 1]) {
      const sx = side * 1.3;
      g.add(cyl(0.04, 2.0, matMetal, sx, 0.58, 0.35, Math.PI / 2, 0));
      g.add(cyl(0.04, 1.4, matMetal, sx, 0.45, -0.85, Math.PI / 2, 0));
      for (const z of [1.35, -0.1, -1.55]) {
        const w = cyl(0.26, 0.24, matWheel, sx, 0.26, z, 0, Math.PI / 2, 20);
        const hub = cyl(0.1, 0.27, matMetal, sx, 0.26, z, 0, Math.PI / 2, 12);
        // cleats: thin ring on the tread
        const cleat = cyl(0.265, 0.05, matDark, sx, 0.26, z, 0, Math.PI / 2, 20);
        this.wheels.push(w);
        g.add(w, hub, cleat);
        g.add(cyl(0.025, 0.35, matMetal, sx * 0.97, 0.43, z));
      }
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // Marker ring so the rover is findable from orbit-scale distances.
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff7a2f, side: THREE.DoubleSide, fog: false, depthTest: false, transparent: true }),
    );
    this.marker.renderOrder = 10;
    this.marker.position.y = 0.3;
    this.marker.userData.overlay = true;
    this.marker.castShadow = false;
    this.group.add(this.marker);
  }

  update(r: Rover, camera: THREE.Camera): void {
    const y = r.y;
    this.group.position.set(r.x, y, r.z);
    // Align to terrain normal, then yaw about it. Model +z is forward.
    const e = 1.5;
    const nx = this.hm.heightAt(r.x - e, r.z) - this.hm.heightAt(r.x + e, r.z);
    const nz = this.hm.heightAt(r.x, r.z - e) - this.hm.heightAt(r.x, r.z + e);
    const normal = new THREE.Vector3(nx, 2 * e, nz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.heading);
    this.group.quaternion.copy(q).multiply(yaw);
    for (const w of this.wheels) w.rotation.x = r.odometerM / 0.26; // wheels turn with distance driven
    const d = camera.position.distanceTo(this.group.position);
    this.marker.scale.setScalar(Math.max(1, d / 45));
    this.marker.visible = d > 40; // only a locator for far views
  }
}
