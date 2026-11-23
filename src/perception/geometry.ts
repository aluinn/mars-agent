import { type FrameMeta, ifovMradRendered } from './types';

/** Camera basis for a frame: lets the agent turn pixels + depth into 3D points in the world frame (x east, y up, z south). */
export interface Basis {
  pos: [number, number, number];
  fwd: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  tanX: number;
  tanY: number;
  w: number;
  h: number;
}

export function basisOf(m: FrameMeta): Basis {
  const f = m.camDir;
  // right = normalize(f x worldUp), up = right x f
  let rx = f[1] * 0 - f[2] * 1;
  let ry = f[2] * 0 - f[0] * 0;
  let rz = f[0] * 1 - f[1] * 0;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * f[2] - rz * f[1];
  const uy = rz * f[0] - rx * f[2];
  const uz = rx * f[1] - ry * f[0];
  const tanY = Math.tan((m.fovYDeg * Math.PI) / 360);
  return { pos: m.camPos, fwd: f, right: [rx, ry, rz], up: [ux, uy, uz], tanX: (tanY * m.width) / m.height, tanY, w: m.width, h: m.height };
}

/** World point seen at pixel (u, v) (pixel-centre coordinates) with axial depth `d`. */
export function pointAt(b: Basis, u: number, v: number, d: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const x = ((u + 0.5) / b.w * 2 - 1) * b.tanX;
  const y = (1 - ((v + 0.5) / b.h) * 2) * b.tanY;
  out[0] = b.pos[0] + (b.fwd[0] + b.right[0] * x + b.up[0] * y) * d;
  out[1] = b.pos[1] + (b.fwd[1] + b.right[1] * x + b.up[1] * y) * d;
  out[2] = b.pos[2] + (b.fwd[2] + b.right[2] * x + b.up[2] * y) * d;
  return out;
}

/** Metres of ground covered by one rendered pixel at axial range `d`. */
export const metresPerPixel = (d: number): number => (d * ifovMradRendered()) / 1000;
