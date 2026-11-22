/** Camera model and frame types. The agent only ever receives AgentFrame; TruthFrame is for scoring. */

/**
 * Mastcam-Z-like camera. Wide-end optical specs from Bell et al. (2021): 25.6 x 19.2 deg field of view,
 * 1600 x 1200 active pixels, 283 microradian/pixel. We render at 640 x 480 (2.5x downsample), so each
 * simulated pixel covers about 0.71 mrad. Square-pixel 4:3 projection at 19.2 deg vertical gives 25.4 deg horizontal.
 */
export const MASTCAM = {
  fovYDeg: 19.2,
  width: 640,
  height: 480,
  nativeWidth: 1600,
  nativeHeight: 1200,
  nativeIfovMrad: 0.283,
  near: 0.5,
  /** Rendering/depth range limit in metres (limited range). */
  far: 1500,
  /** Camera height above the local ground, metres (approximate mast height). */
  mastHeightM: 2.1,
  /** Sensor read noise added to the 8-bit image, in grey levels (1 sigma). */
  noiseLevels: 2.5,
} as const;

export const ifovMradRendered = (): number => MASTCAM.nativeIfovMrad * (MASTCAM.nativeWidth / MASTCAM.width);

export interface CaptureRequest {
  /** Pan relative to rover heading, degrees (+ = right). */
  panDeg: number;
  tiltDeg: number;
  reason: string;
}

export interface FrameMeta {
  simTime: number;
  sol: number;
  localHours: number;
  sunElevationDeg: number;
  /** Sun azimuth from north, degrees. */
  sunAzimuthDeg: number;
  tau: number;
  roverX: number;
  roverZ: number;
  roverHeadingRad: number;
  /** Camera world position and look direction (unit vector). */
  camPos: [number, number, number];
  camDir: [number, number, number];
  panDeg: number;
  tiltDeg: number;
  fovYDeg: number;
  fovXDeg: number;
  width: number;
  height: number;
  far: number;
  reason: string;
}

/** What the agent sees: an RGBA image (sRGB, top row first) and metric depth. */
export interface AgentFrame {
  meta: FrameMeta;
  rgba: Uint8ClampedArray;
  /** Distance along the optical axis in metres per pixel; Infinity where nothing is in range (sky / beyond far). */
  depthM: Float32Array;
}

export interface TruthObject {
  kind: 'terrain' | 'rock';
  cls: number;
  rockId?: number;
}

/** Hidden ground truth for scoring only. Never pass to the agent or planner. */
export interface TruthFrame {
  meta: FrameMeta;
  /** Object id per pixel (0 = sky / nothing). */
  ids: Uint32Array;
  lookup(id: number): TruthObject | undefined;
}
