import type { Detection, DetectionResult } from '../perception/detector';
import type { AgentFrame } from '../perception/types';
import { type Reliability, scienceValue } from './priority';
import type { EarthLink } from './link';
import type { NoveltyTracker } from './priority';
import { formatLocalTime } from '../sim/environment';

/** What Earth receives for an image: the JPEG the rover took, plus the rover's own detections as compact metadata. */
export interface EarthImagePayload {
  blob: Blob;
  bytes: number;
  meta: { sol: number; localHours: number; panDeg: number; tau: number; sunElevationDeg: number; reason: string; width: number; height: number };
  detections: { cls: number; name: string; kind: 'terrain' | 'object'; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; rangeM: number; x: number; z: number }[];
}

/** Encode the rover's image as JPEG (what would actually be downlinked); returns the real compressed size. */
export function encodeJpeg(frame: AgentFrame, quality = 0.6): Promise<Blob> {
  const { width: w, height: h } = frame.meta;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), w, h), 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('JPEG encode failed'))), 'image/jpeg', quality));
}

const compact = (d: Detection) => ({ cls: d.cls, name: d.name, kind: d.kind, confidence: d.confidence, bbox: d.bbox, rangeM: d.rangeM, x: d.world.x, z: d.world.z });

/** Queue an image for downlink. Its priority is the science value of what the rover detected in it. */
export async function submitFrame(link: EarthLink, tracker: NoveltyTracker, frame: AgentFrame, res: DetectionResult | null, reliability: Reliability, now: number): Promise<void> {
  const blob = await encodeJpeg(frame);
  const dets = (res?.detections ?? []).filter((d) => d.confidence >= 0.08).map(compact);
  const value = scienceValue(res?.detections ?? [], tracker, reliability);
  const m = frame.meta;
  const payload: EarthImagePayload = {
    blob,
    bytes: blob.size,
    meta: { sol: m.sol, localHours: m.localHours, panDeg: m.panDeg, tau: m.tau, sunElevationDeg: m.sunElevationDeg, reason: m.reason, width: m.width, height: m.height },
    detections: dets,
  };
  link.enqueue(
    { kind: 'image', title: `image sol ${m.sol} ${formatLocalTime(m.localHours)} pan ${m.panDeg.toFixed(0)}°`, createdT: now, sizeBits: 8 * (blob.size + 24 * dets.length + 64), value, payload },
    now,
  );
}
