import * as THREE from 'three';

export interface SkyColours {
  horizon: THREE.Color;
  zenith: THREE.Color;
}

/**
 * Butterscotch Martian sky colours (linear) for a sun elevation (radians) and dust opacity tau.
 * More dust: flatter, browner, brighter near the horizon. Night: dark.
 */
export function skyColours(sunElevation: number, tau: number): SkyColours & { day: number } {
  const day = Math.max(0, Math.min(1, (sunElevation + 0.1) / 0.3)); // 0 below -6 deg, 1 above ~11 deg
  const dust = Math.min(1, tau / 4);
  const bright = 0.2 + 0.8 * Math.min(1, Math.max(0, Math.sin(Math.max(sunElevation, 0)) * 1.4 + 0.15));
  const horizon = new THREE.Color(0.82, 0.55, 0.34).multiplyScalar(day * bright * (0.8 + 0.5 * dust));
  const zenith = new THREE.Color(0.42, 0.27, 0.19).lerp(new THREE.Color(0.7, 0.48, 0.31), dust * 0.8).multiplyScalar(day * bright * 0.75);
  // faint night glow so the sky is not pure black
  horizon.add(new THREE.Color(0.012, 0.012, 0.02));
  zenith.add(new THREE.Color(0.004, 0.004, 0.009));
  return { horizon, zenith, day };
}

const VERT = `varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane, never clipped by the camera range
}`;

const FRAG = `precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir; uniform vec3 uHorizon; uniform vec3 uZenith;
uniform float uTau; uniform float uDay; uniform float uSunVis; uniform float uSunEl;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  float up = pow(clamp(e, 0.0, 1.0), 0.5);
  vec3 col = mix(uHorizon, uZenith, up);
  if (e < 0.0) col = mix(uHorizon, uHorizon * 0.85, clamp(-e * 4.0, 0.0, 1.0));
  float c = max(dot(d, uSunDir), 0.0);
  // Forward-scattering dust halo: warm and broad, broader with more dust.
  float haloW = mix(6.0, 2.5, clamp(uTau / 4.0, 0.0, 1.0));
  col += vec3(1.0, 0.72, 0.45) * pow(c, haloW) * 0.55 * uSunVis * uDay;
  // The famous blue sunset glow: tight bluish halo around a low sun.
  float low = clamp(1.0 - uSunEl / 0.35, 0.0, 1.0);
  col += vec3(0.30, 0.46, 0.85) * pow(c, 90.0) * 1.1 * low * uDay;
  // Sun disc (~0.35 deg radius), HDR so tone mapping makes it glare.
  float disc = smoothstep(0.999985, 0.99999, c);
  col += vec3(1.0, 0.93, 0.8) * disc * 40.0 * uSunVis;
  // Stars at night.
  float night = 1.0 - smoothstep(0.0, 0.35, uDay);
  if (night > 0.0 && e > 0.0) col += vec3(step(0.9972, hash(floor(d * 260.0)))) * night * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uHorizon: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uTau: { value: 0.6 },
      uDay: { value: 1 },
      uSunVis: { value: 1 },
      uSunEl: { value: 1 },
    },
    depthWrite: false,
    depthTest: false, // drawn first, terrain draws over it
    side: THREE.BackSide, // we are inside the dome
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  mesh.userData.colorOnly = true; // hidden in the depth and ground-truth passes
  return mesh;
}
