import * as THREE from 'three';
import { atmosphereAt, sunAt } from '../sim/environment';

/** Owns the sun, sky light and fog; update() applies local time + dust opacity. */
export class SceneEnv {
  readonly sun = new THREE.DirectionalLight(0xfff0dd, 3);
  readonly sky = new THREE.HemisphereLight(0xd9a77a, 0x6b4430, 0.5);
  readonly fog = new THREE.FogExp2(0xc89a6e, 0.0001);
  elevationDeg = 0;
  directFactor = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.sun, this.sun.target, this.sky);
    scene.fog = this.fog;
  }

  update(scene: THREE.Scene, localHours: number, tau: number, lsDeg = 5): void {
    const s = sunAt(localHours, lsDeg);
    const a = atmosphereAt(s.elevation, tau);
    this.elevationDeg = (s.elevation * 180) / Math.PI;
    this.directFactor = a.directFactor;
    const d = 8000;
    // azimuth clockwise from north (-z); x = east
    const ce = Math.cos(s.elevation);
    this.sun.position.set(Math.sin(s.azimuth) * ce * d, Math.sin(s.elevation) * d, -Math.cos(s.azimuth) * ce * d);
    this.sun.intensity = 3.2 * a.directFactor;
    // Sun colour reddens toward the horizon/with dust.
    this.sun.color.setRGB(1, 0.93 - 0.1 * (1 - Math.max(0.1, Math.sin(Math.max(s.elevation, 0)))), 0.82 - 0.12 * (tau / 4));
    this.sky.intensity = 2.2 * a.diffuseFactor + 0.02;
    const bg = new THREE.Color(a.sky[0], a.sky[1], a.sky[2]);
    scene.background = bg;
    this.fog.color.copy(bg);
    this.fog.density = a.fogDensity;
  }
}
