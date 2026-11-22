import * as THREE from 'three';
import { mulberry32 } from '../world/rng';
import { type AgentFrame, type CaptureRequest, type FrameMeta, MASTCAM, type TruthFrame, type TruthObject } from './types';

const DEPTH_MATERIAL = new THREE.ShaderMaterial({
  vertexShader: `varying float vDepth;
    void main() {
      #include <begin_vertex>
      #include <project_vertex>
      vDepth = -mvPosition.z;
    }`,
  // Pack metric depth (0..far) into 24 bits across RGB. No blending, no colour management.
  fragmentShader: `precision highp float; uniform float uFar; varying float vDepth;
    void main() {
      float v = clamp(vDepth / uFar, 0.0, 1.0) * 16777215.0;
      float r = floor(v / 65536.0);
      float g = floor((v - r * 65536.0) / 256.0);
      float b = floor(v - r * 65536.0 - g * 256.0);
      gl_FragColor = vec4(r, g, b, 255.0) / 255.0;
    }`,
  uniforms: { uFar: { value: MASTCAM.far } },
  blending: THREE.NoBlending,
  fog: false,
});

export interface EnvState {
  simTime: number;
  sol: number;
  localHours: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  tau: number;
}

export interface CapturePose {
  x: number;
  y: number;
  z: number;
  headingRad: number;
}

/** Scene objects can carry `userData.idMaterial` (flat-colour material for the ground-truth pass) and `userData.overlay` (hidden from the camera). */
export class MastCamera {
  readonly camera: THREE.PerspectiveCamera;
  private rtColor: THREE.WebGLRenderTarget;
  private rtData: THREE.WebGLRenderTarget;
  private bufC = new Uint8Array(MASTCAM.width * MASTCAM.height * 4);
  private bufD = new Uint8Array(MASTCAM.width * MASTCAM.height * 4);
  private bufI = new Uint8Array(MASTCAM.width * MASTCAM.height * 4);

  constructor(private lookup: (id: number) => TruthObject | undefined) {
    this.camera = new THREE.PerspectiveCamera(MASTCAM.fovYDeg, MASTCAM.width / MASTCAM.height, MASTCAM.near, MASTCAM.far);
    // Colour pass: sRGB-encoded 8-bit like a real camera image, 4x MSAA for realistic edges.
    this.rtColor = new THREE.WebGLRenderTarget(MASTCAM.width, MASTCAM.height, { samples: 4, depthBuffer: true });
    this.rtColor.texture.colorSpace = THREE.SRGBColorSpace;
    // Data passes (depth, ids): raw bytes, no antialiasing (blended ids would be invalid).
    this.rtData = new THREE.WebGLRenderTarget(MASTCAM.width, MASTCAM.height, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  }

  dispose(): void {
    this.rtColor.dispose();
    this.rtData.dispose();
  }

  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, req: CaptureRequest, pose: CapturePose, env: EnvState): { agent: AgentFrame; truth: TruthFrame } {
    const { width: w, height: h } = MASTCAM;
    const yaw = pose.headingRad + (req.panDeg * Math.PI) / 180;
    const tilt = (req.tiltDeg * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt));
    const pos = new THREE.Vector3(pose.x, pose.y + MASTCAM.mastHeightM, pose.z);
    this.camera.position.copy(pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(pos.clone().add(dir));
    this.camera.updateMatrixWorld(true);

    // Save renderer/scene state.
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevBg = scene.background;
    const prevFog = scene.fog;
    const prevOverride = scene.overrideMaterial;
    const hidden: THREE.Object3D[] = [];
    const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    scene.traverse((o) => {
      if (o.userData.overlay && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });

    try {
      // 1. Colour pass: the scene exactly as lit (sun, dust, haze).
      renderer.setRenderTarget(this.rtColor);
      renderer.render(scene, this.camera);
      renderer.readRenderTargetPixels(this.rtColor, 0, 0, w, h, this.bufC);

      // 2. Depth pass.
      scene.background = null;
      scene.fog = null;
      scene.overrideMaterial = DEPTH_MATERIAL;
      renderer.setClearColor(0xffffff, 1);
      renderer.setRenderTarget(this.rtData);
      renderer.clear();
      renderer.render(scene, this.camera);
      renderer.readRenderTargetPixels(this.rtData, 0, 0, w, h, this.bufD);
      scene.overrideMaterial = null;

      // 3. Ground-truth id pass: flat unique colours per object, nothing else.
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        const idm = o.userData.idMaterial as THREE.Material | undefined;
        if (idm && m.isMesh) {
          swapped.push([m, m.material]);
          m.material = idm;
        }
      });
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(this.rtData);
      renderer.clear();
      renderer.render(scene, this.camera);
      renderer.readRenderTargetPixels(this.rtData, 0, 0, w, h, this.bufI);
    } finally {
      for (const [m, mat] of swapped) m.material = mat;
      for (const o of hidden) o.visible = true;
      scene.background = prevBg;
      scene.fog = prevFog;
      scene.overrideMaterial = prevOverride;
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.setRenderTarget(prevTarget);
    }

    const fovX = (2 * Math.atan(Math.tan((MASTCAM.fovYDeg * Math.PI) / 360) * (w / h)) * 180) / Math.PI;
    const meta: FrameMeta = {
      ...env,
      roverX: pose.x,
      roverZ: pose.z,
      roverHeadingRad: pose.headingRad,
      camPos: [pos.x, pos.y, pos.z],
      camDir: [dir.x, dir.y, dir.z],
      panDeg: req.panDeg,
      tiltDeg: req.tiltDeg,
      fovYDeg: MASTCAM.fovYDeg,
      fovXDeg: fovX,
      width: w,
      height: h,
      far: MASTCAM.far,
      reason: req.reason,
    };

    // Unpack. readRenderTargetPixels returns rows bottom-up; flip to top-down.
    const rgba = new Uint8ClampedArray(w * h * 4);
    const depth = new Float32Array(w * h);
    const ids = new Uint32Array(w * h);
    const rnd = mulberry32(Math.floor(env.simTime) + 1);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w;
      for (let x = 0; x < w; x++) {
        const s = (src + x) * 4;
        const d = y * w + x;
        const n = gauss() * MASTCAM.noiseLevels;
        rgba[d * 4] = this.bufC[s]! + n;
        rgba[d * 4 + 1] = this.bufC[s + 1]! + n;
        rgba[d * 4 + 2] = this.bufC[s + 2]! + n;
        rgba[d * 4 + 3] = 255;
        const v = (this.bufD[s]! * 65536 + this.bufD[s + 1]! * 256 + this.bufD[s + 2]!) / 16777215;
        depth[d] = v >= 0.99999 ? Infinity : v * MASTCAM.far;
        ids[d] = (this.bufI[s]! << 16) | (this.bufI[s + 1]! << 8) | this.bufI[s + 2]!;
      }
    }
    return { agent: { meta, rgba, depthM: depth }, truth: { meta, ids, lookup: this.lookup } };
  }
}
