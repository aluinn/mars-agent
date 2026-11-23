import * as THREE from 'three';
import { findPath } from '../nav/astar';
import { mulberry32 } from '../world/rng';
import { C } from '../world/classes';
import { sunAt } from '../sim/environment';
import type { Simulation } from '../sim/simulation';
import type { SceneEnv } from '../render/sceneEnv';
import { type DetectorModel, Detector } from './detector';
import { FEATURES, NF, TILE, extractTiles } from './features';
import type { MastCamera } from './mastCamera';
import { Metrics, scoreFrame } from './scoring';

/**
 * Dev/test harness exposed as `window.__lab`. It places the camera at arbitrary poses, times and dust levels,
 * and is used by scripts/train_detector.mjs to collect labelled tiles and to run held-out evaluation.
 * Ground truth is used here for TRAINING and SCORING only.
 */
export function installLab(ctx: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; env: SceneEnv; mastCam: MastCamera; sim: Simulation }): void {
  const { renderer, scene, env, mastCam, sim } = ctx;
  const half = sim.hm.sizeMetres / 2;
  const BLOCK = 400;

  const parityOf = (x: number, z: number) => (Math.floor((x + half) / BLOCK) + Math.floor((z + half) / BLOCK)) & 1;

  function capture(x: number, z: number, heading: number, hours: number, tau: number, tilt = -4) {
    sim.tau = tau;
    env.update(hours, tau);
    renderer.shadowMap.needsUpdate = true;
    const sun = sunAt(hours);
    return mastCam.capture(
      renderer,
      scene,
      { panDeg: 0, tiltDeg: tilt, reason: 'lab' },
      { x, y: sim.hm.heightAt(x, z), z, headingRad: heading },
      { simTime: Math.round(x * 7 + z * 13 + hours * 100), sol: 1, localHours: hours, sunElevationDeg: (sun.elevation * 180) / Math.PI, sunAzimuthDeg: (sun.azimuth * 180) / Math.PI, tau },
    );
  }

  function randomPose(rnd: () => number, parity: number) {
    for (;;) {
      const x = (rnd() * 2 - 1) * (half - 150);
      const z = (rnd() * 2 - 1) * (half - 150);
      if (parityOf(x, z) !== parity) continue;
      return { x, z, heading: rnd() * Math.PI * 2, hours: 7 + rnd() * 10, tau: 0.3 + rnd() * 2.2 };
    }
  }

  (window as unknown as { __lab: unknown }).__lab = {
    parityOf,
    features: [...FEATURES],
    capture,
    /** Collect labelled tile features from n random frames at poses whose 400 m block has the given parity (0 = train, 1 = test). */
    collect(n: number, seed: number, parity: number, perClassCap = 120) {
      const rnd = mulberry32(seed);
      const X: number[] = [];
      const Y: number[] = [];
      for (let f = 0; f < n; f++) {
        const p = randomPose(rnd, parity);
        const { agent, truth } = capture(p.x, p.z, p.heading, p.hours, p.tau);
        const g = extractTiles(agent);
        const w = agent.meta.width;
        const perClass = new Map<number, number[]>();
        const cache = new Map<number, { kind: string; cls: number } | null>();
        for (let t = 0; t < g.tw * g.th; t++) {
          if (!g.valid[t] || g.edge[t]) continue;
          const tx = t % g.tw, ty = (t / g.tw) | 0;
          const counts = new Uint16Array(16);
          let known = 0, rock = 0;
          for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
            const id = truth.ids[(ty * TILE + y) * w + tx * TILE + x]!;
            let o = cache.get(id);
            if (o === undefined) { o = id > 0 ? (truth.lookup(id) ?? null) : null; cache.set(id, o); }
            if (!o) continue;
            if (o.kind === 'rock') rock++;
            else { counts[o.cls]!++; known++; }
          }
          if (known < 56 || rock > 8) continue;
          let best = 0;
          for (let c = 1; c < 16; c++) if (counts[c]! > counts[best]!) best = c;
          if (counts[best]! / known < 0.9 || best === C.None) continue;
          (perClass.get(best) ?? perClass.set(best, []).get(best)!).push(t);
        }
        for (const [cls, tiles] of perClass) {
          for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!]; }
          for (const t of tiles.slice(0, perClassCap)) {
            for (let k = 0; k < NF; k++) X.push(g.feat[t * NF + k]!);
            Y.push(cls);
          }
        }
      }
      return { X, Y };
    },
    /** Time n A* searches of 100-600 m on the 1024 x 1024 grid. `withRocks` first marks every boulder as known (worst case). */
    benchPath(n: number, seed: number, withRocks: boolean) {
      const known = sim.agent.known;
      if (withRocks) for (const r of sim.rocks) known.learnRock(r);
      const rnd = mulberry32(seed);
      const ms: number[] = [];
      const expanded: number[] = [];
      let found = 0;
      const lim = half - 120;
      for (let i = 0; i < n; i++) {
        const sx = (rnd() * 2 - 1) * lim, sz = (rnd() * 2 - 1) * lim;
        const ang = rnd() * Math.PI * 2, d = 100 + rnd() * 500;
        const gx = Math.max(-lim, Math.min(lim, sx + Math.cos(ang) * d)), gz = Math.max(-lim, Math.min(lim, sz + Math.sin(ang) * d));
        const t0 = performance.now();
        const r = findPath(sim.grid, known.blocked, sx, sz, gx, gz);
        ms.push(performance.now() - t0);
        if (r.found) { found++; expanded.push(r.expanded); }
      }
      return { ms, found, expanded };
    },
    /** Run the detector + scorer on n random held-out frames. Returns per-class precision/recall and the reliability bins. */
    evaluate(model: DetectorModel | null, n: number, seed: number, parity: number) {
      const det = new Detector(model);
      const m = new Metrics();
      const rnd = mulberry32(seed);
      const dist: number[] = [];
      for (let f = 0; f < n; f++) {
        const p = randomPose(rnd, parity);
        const { agent, truth } = capture(p.x, p.z, p.heading, p.hours, p.tau);
        const res = det.detect(agent);
        const score = scoreFrame(res, agent, truth);
        m.add(res.detections, score, res.ms);
        for (const d of res.detections) if (score.outcome.get(d.id) === 'tp') dist.push(d.rangeM);
      }
      return { frames: m.frames, meanMs: m.meanMs, detections: m.detections, perClass: [...m.perClass.entries()], bins: m.bins };
    },
  };
}
