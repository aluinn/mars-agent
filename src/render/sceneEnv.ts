import * as THREE from 'three';
import { atmosphereAt, sunAt } from '../sim/environment';
import { createSky, skyColours } from './sky';

/** Owns the sun (with cast shadows), sky dome, sky light and haze; update() applies local time + dust opacity. */
export class SceneEnv {
  readonly sun = new THREE.DirectionalLight(0xfff0dd, 3);
  readonly skyLight = new THREE.HemisphereLight(0xd9a77a, 0x6b4430, 0.5);
  readonly fog = new THREE.FogExp2(0xc89a6e, 0.0001);
  readonly sky = createSky();
  elevationDeg = 0;
  azimuthDeg = 0;
  directFactor = 0;
  private lastShadowKey = '';

  constructor(
    scene: THREE.Scene,
    private halfExtent: number,
  ) {
    scene.add(this.sun, this.sun.target, this.skyLight, this.sky);
    scene.fog = this.fog;
    scene.background = null;
    const s = this.sun.shadow;
    s.mapSize.set(4096, 4096);
    const e = halfExtent * 1.15;
    Object.assign(s.camera, { left: -e, right: e, top: e, bottom: -e, near: 10, far: halfExtent * 8 });
    s.camera.updateProjectionMatrix();
    s.bias = -0.0004;
    s.normalBias = 0.6;
    this.sun.castShadow = true;
  }

  /** True when the sun moved enough that the shadow map should be refreshed. */
  update(localHours: number, tau: number, lsDeg = 5): boolean {
    const s = sunAt(localHours, lsDeg);
    const a = atmosphereAt(s.elevation, tau);
    this.elevationDeg = (s.elevation * 180) / Math.PI;
    this.azimuthDeg = (s.azimuth * 180) / Math.PI;
    this.directFactor = a.directFactor;
    const d = this.halfExtent * 4;
    const ce = Math.cos(s.elevation);
    const dir = new THREE.Vector3(Math.sin(s.azimuth) * ce, Math.sin(s.elevation), -Math.cos(s.azimuth) * ce);
    this.sun.position.copy(dir).multiplyScalar(d);
    this.sun.intensity = 3.4 * a.directFactor;
    this.sun.color.setRGB(1, 0.93 - 0.1 * (1 - Math.max(0.1, Math.sin(Math.max(s.elevation, 0)))), 0.82 - 0.12 * (tau / 4));
    this.sun.castShadow = a.directFactor > 0.01;

    const c = skyColours(s.elevation, tau);
    this.skyLight.color.copy(c.zenith).lerp(c.horizon, 0.5).multiplyScalar(1.0 / Math.max(c.day, 0.05));
    this.skyLight.color.r = Math.min(1, this.skyLight.color.r);
    this.skyLight.color.g = Math.min(1, this.skyLight.color.g);
    this.skyLight.color.b = Math.min(1, this.skyLight.color.b);
    this.skyLight.groundColor.set(0x6b4430);
    this.skyLight.intensity = (0.5 + 1.8 * (1 - Math.exp(-tau))) * c.day + 0.02;
    this.fog.color.copy(c.horizon);
    this.fog.density = a.fogDensity;
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    u.uSunDir!.value.copy(dir);
    u.uHorizon!.value.copy(c.horizon);
    u.uZenith!.value.copy(c.zenith);
    u.uTau!.value = tau;
    u.uDay!.value = c.day;
    u.uSunVis!.value = Math.min(1, a.directFactor * 2.2);
    u.uSunEl!.value = Math.max(0, s.elevation);

    const key = `${Math.round(this.elevationDeg * 5)}:${Math.round(this.azimuthDeg * 5)}`;
    const changed = key !== this.lastShadowKey;
    this.lastShadowKey = key;
    return changed;
  }
}
