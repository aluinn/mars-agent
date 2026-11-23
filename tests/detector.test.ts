import { describe, expect, it } from 'vitest';
import { C } from '../src/world/classes';
import { MAX_CONFIDENCE, type Detection, type DetectionResult, Detector, type DetectorModel, classifyTile, combine, visibility } from '../src/perception/detector';
import { iou, scoreFrame, Metrics } from '../src/perception/scoring';
import { NF } from '../src/perception/features';
import { MASTCAM, type AgentFrame, type FrameMeta, type TruthFrame } from '../src/perception/types';

describe('confidence model', () => {
  it('falls with range', () => expect(visibility(400, 40, 0.6, 0).range).toBeLessThan(visibility(40, 40, 0.6, 0).range));
  it('falls with low sun', () => expect(visibility(50, 5, 0.6, 0).sun).toBeLessThan(visibility(50, 45, 0.6, 0).sun));
  it('falls with dust opacity and distance', () => {
    expect(visibility(300, 40, 3, 0).haze).toBeLessThan(visibility(300, 40, 0.3, 0).haze);
    expect(visibility(600, 40, 1, 0).haze).toBeLessThan(visibility(100, 40, 1, 0).haze);
  });
  it('falls with occlusion', () => expect(visibility(50, 40, 0.6, 1).occlusion).toBeLessThan(visibility(50, 40, 0.6, 0).occlusion));
  it('is never 100%, even for a perfect observation', () => {
    const best = combine(1, visibility(1, 90, 0.2, 0));
    expect(best).toBeLessThanOrEqual(MAX_CONFIDENCE);
    expect(best).toBeLessThan(1);
  });
  it('combined confidence drops as conditions worsen', () => {
    const good = combine(0.9, visibility(30, 50, 0.4, 0));
    const bad = combine(0.9, visibility(500, 6, 3, 0.6));
    expect(bad).toBeLessThan(good * 0.3);
  });
});

describe('terrain classifier', () => {
  const model: DetectorModel = {
    version: 1, features: [], temperature: 1, info: {},
    classes: [
      { id: C.Regolith, name: 'regolith', prior: 0.5, mean: new Array(NF).fill(0), variance: new Array(NF).fill(1), n: 1 },
      { id: C.Basalt, name: 'basalt', prior: 0.5, mean: new Array(NF).fill(4), variance: new Array(NF).fill(1), n: 1 },
    ],
  };
  it('picks the nearer class', () => {
    const p = new Float32Array(2);
    classifyTile(model, new Float32Array(NF).fill(3.8), 0, p);
    expect(p[1]!).toBeGreaterThan(0.99);
    expect(p[0]! + p[1]!).toBeCloseTo(1, 5);
  });
  it('a higher temperature makes the posterior less certain', () => {
    const f = new Float32Array(NF).fill(3);
    const a = new Float32Array(2), b = new Float32Array(2);
    classifyTile(model, f, 0, a);
    classifyTile({ ...model, temperature: 10 }, f, 0, b);
    expect(Math.max(...b)).toBeLessThan(Math.max(...a));
  });
});

// ---- synthetic scene: flat ground with one hemispherical rock, rendered analytically ----
function syntheticFrame(rockRadius: number, rockDistance: number): { frame: AgentFrame; truth: TruthFrame } {
  const w = MASTCAM.width, h = MASTCAM.height;
  const tilt = (-4 * Math.PI) / 180;
  const camDir: [number, number, number] = [0, Math.sin(tilt), Math.cos(tilt)];
  const meta: FrameMeta = {
    simTime: 0, sol: 1, localHours: 11, sunElevationDeg: 60, sunAzimuthDeg: 0, tau: 0.6, roverX: 0, roverZ: 0, roverHeadingRad: 0,
    camPos: [0, MASTCAM.mastHeightM, 0], camDir, panDeg: 0, tiltDeg: -4, fovYDeg: MASTCAM.fovYDeg, fovXDeg: 25.4, width: w, height: h, far: MASTCAM.far, reason: 'test',
  };
  // camera basis (same convention as perception/geometry.ts)
  let rx = -camDir[2], rz = camDir[0];
  const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
  const up: [number, number, number] = [(0 * camDir[2] - rz * camDir[1]), rz * camDir[0] - rx * camDir[2], rx * camDir[1] - 0 * camDir[0]];
  const tanY = Math.tan((MASTCAM.fovYDeg * Math.PI) / 360), tanX = (tanY * w) / h;
  const rgba = new Uint8ClampedArray(w * h * 4), depthM = new Float32Array(w * h), ids = new Uint32Array(w * h);
  const c: [number, number, number] = [0, 0, rockDistance];
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const x = ((u + 0.5) / w * 2 - 1) * tanX, y = (1 - ((v + 0.5) / h) * 2) * tanY;
      const ray: [number, number, number] = [camDir[0] + rx * x + up[0] * y, camDir[1] + 0 * x + up[1] * y, camDir[2] + rz * x + up[2] * y];
      let d = Infinity, onRock = false;
      if (ray[1] < 0) d = -meta.camPos[1] / ray[1];
      // sphere intersection (upper hemisphere only)
      const ox = -c[0], oy = meta.camPos[1] - c[1], oz = -c[2];
      const A = ray[0] ** 2 + ray[1] ** 2 + ray[2] ** 2, B = 2 * (ox * ray[0] + oy * ray[1] + oz * ray[2]), Cq = ox * ox + oy * oy + oz * oz - rockRadius ** 2;
      const disc = B * B - 4 * A * Cq;
      if (disc >= 0) {
        const t = (-B - Math.sqrt(disc)) / (2 * A);
        if (t > 0 && meta.camPos[1] + ray[1] * t >= 0 && t < d) { d = t; onRock = true; }
      }
      const k = v * w + u;
      depthM[k] = Number.isFinite(d) && d < MASTCAM.far ? d : Infinity;
      const g = onRock ? 70 : 150 + ((u * 7 + v * 13) % 5);
      rgba[k * 4] = g; rgba[k * 4 + 1] = g * 0.8; rgba[k * 4 + 2] = g * 0.6; rgba[k * 4 + 3] = 255;
      ids[k] = !Number.isFinite(depthM[k]!) ? 0 : onRock ? 2 : 1;
    }
  }
  const lookup = (id: number) => (id === 1 ? { kind: 'terrain' as const, cls: C.Regolith } : id === 2 ? { kind: 'rock' as const, cls: rockRadius >= 0.4 ? C.Boulder : C.Cobble, rockId: 0 } : undefined);
  return { frame: { meta, rgba, depthM }, truth: { meta, ids, lookup } };
}

describe('rock detection on a synthetic scene with known geometry', () => {
  it('finds a 0.6 m radius boulder at 15 m and estimates its size', () => {
    const { frame, truth } = syntheticFrame(0.6, 15);
    const res = new Detector(null).detect(frame);
    const rocks = res.detections.filter((d) => d.kind === 'object');
    expect(rocks.length).toBe(1);
    const d = rocks[0]!;
    expect(d.cls).toBe(C.Boulder);
    expect(d.sizeM!).toBeGreaterThan(0.9);
    expect(d.sizeM!).toBeLessThan(1.6);
    expect(d.rangeM).toBeGreaterThan(13);
    expect(d.rangeM).toBeLessThan(17);
    expect(d.confidence).toBeLessThan(1);
    const score = scoreFrame(res, frame, truth);
    expect(score.outcome.get(d.id)).toBe('tp');
    expect(score.truthRegions.find((r) => r.kind === 'object')?.hit).toBe(true);
  });
  it('calls a 0.12 m radius stone a cobble, and is less confident when it is far away', () => {
    const near = new Detector(null).detect(syntheticFrame(0.12, 12).frame).detections.filter((d) => d.kind === 'object');
    expect(near.length).toBe(1);
    expect(near[0]!.cls).toBe(C.Cobble);
    const far = new Detector(null).detect(syntheticFrame(0.6, 90).frame).detections.filter((d) => d.kind === 'object');
    const mid = new Detector(null).detect(syntheticFrame(0.6, 20).frame).detections.filter((d) => d.kind === 'object');
    if (far.length && mid.length) expect(far[0]!.confidence).toBeLessThan(mid[0]!.confidence);
  });
  it('reports nothing on bare ground', () => {
    expect(new Detector(null).detect(syntheticFrame(0.001, 15).frame).detections.length).toBe(0);
  });
});

describe('scoring', () => {
  it('computes box overlap', () => {
    expect(iou({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 0, y0: 0, x1: 10, y1: 10 })).toBe(1);
    expect(iou({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 20, y0: 20, x1: 30, y1: 30 })).toBe(0);
    expect(iou({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 5, y0: 0, x1: 15, y1: 10 })).toBeCloseTo(1 / 3, 5);
  });

  const { frame, truth } = syntheticFrame(0.001, 15); // all-terrain scene (class: regolith everywhere)
  const tw = 80, th = 60;
  const detection = (cls: number): Detection => {
    const tiles: number[] = [];
    for (let t = 0; t < tw * th; t++) if (frame.depthM[((t / tw | 0) * 8) * 640 + (t % tw) * 8]! < Infinity) tiles.push(t);
    return { id: 1, cls, name: '', kind: 'terrain', confidence: 0.6, rawProb: 0.8, bbox: { x0: 0, y0: 0, x1: 640, y1: 480 }, rangeM: 30, areaPx: tiles.length * 64, world: { x: 0, z: 0 }, factors: { range: 1, sun: 1, haze: 1, occlusion: 1 }, tiles };
  };
  const resultFor = (d: Detection): DetectionResult => {
    const tileClass = new Int8Array(tw * th).fill(-1);
    for (const t of d.tiles!) tileClass[t] = d.cls;
    return { detections: [d], tileClass, tw, th, ms: 1 };
  };
  it('counts a correct terrain region as a hit and a true positive', () => {
    const res = resultFor(detection(C.Regolith));
    const s = scoreFrame(res, frame, truth);
    expect(s.outcome.get(1)).toBe('tp');
    expect(s.truthRegions.some((r) => r.cls === C.Regolith && r.hit)).toBe(true);
  });
  it('counts a wrong class as a false positive and the truth region as missed', () => {
    const res = resultFor(detection(C.Basalt));
    const s = scoreFrame(res, frame, truth);
    expect(s.outcome.get(1)).toBe('fp');
    expect(s.truthRegions.every((r) => !r.hit)).toBe(true);
  });
  it('accumulates per-class precision and recall', () => {
    const m = new Metrics();
    for (const cls of [C.Regolith, C.Regolith, C.Basalt]) {
      const res = resultFor(detection(cls));
      m.add(res.detections, scoreFrame(res, frame, truth), 1);
    }
    expect(m.precision(C.Regolith)).toBe(1);
    expect(m.precision(C.Basalt)).toBe(0);
    expect(m.recall(C.Regolith)).toBeCloseTo(2 / 3, 5);
  });
});
