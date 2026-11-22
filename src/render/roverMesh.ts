import * as THREE from 'three';
import type { Heightmap } from '../terrain/heightmap';
import type { Rover } from '../sim/rover';

/** Perseverance-sized (about 3 x 2.7 m body, wheels 0.52 m diameter) low-poly rover at true scale, plus a marker ring. */
export class RoverView {
  readonly group = new THREE.Group();
  readonly mast = new THREE.Object3D();
  private marker: THREE.Mesh;

  constructor(private hm: Heightmap) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.6, 3), new THREE.MeshLambertMaterial({ color: 0xd9d4cc }));
    body.position.y = 0.75;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 2.2), new THREE.MeshLambertMaterial({ color: 0x2b3a55 }));
    deck.position.y = 1.15;
    const mastMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), new THREE.MeshLambertMaterial({ color: 0xbbbbbb }));
    mastMesh.position.set(0.5, 1.85, 0.8);
    this.mast.position.set(0.5, 2.45, 0.8);
    const wheelGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.3, 14).rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    for (const sx of [-1.35, 1.35]) for (const sz of [-1.3, 0, 1.3]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(sx, 0.26, sz);
      this.group.add(w);
    }
    this.group.add(body, deck, mastMesh, this.mast);
    // Marker ring so the rover is findable from orbit-scale distances.
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff7a2f, side: THREE.DoubleSide, fog: false, depthTest: false, transparent: true }),
    );
    this.marker.renderOrder = 10;
    this.marker.position.y = 0.3;
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
    const d = camera.position.distanceTo(this.group.position);
    this.marker.scale.setScalar(Math.max(1, d / 45));
  }
}
