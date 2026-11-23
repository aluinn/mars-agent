import { describe, expect, it } from 'vitest';
import { EarthLink, DEFAULT_LINK, type LinkItem } from '../src/earth/link';
import { LIGHT_TIME_RANGE_S, lightTimeSeconds } from '../src/earth/lightTime';
import { NoveltyTracker, scienceValue } from '../src/earth/priority';
import { SOL_SECONDS } from '../src/sim/constants';
import { C } from '../src/world/classes';
import type { Detection } from '../src/perception/detector';

/** Sim time (s) at a given sol and local hour, mission starting at 08:00 on sol 1. */
const tAt = (sol: number, hours: number) => (((sol - 1) * 24 + hours - 8) / 24) * SOL_SECONDS;

describe('light time', () => {
  it('starts near the 11 minute delay of the Perseverance landing', () => {
    expect(lightTimeSeconds(0) / 60).toBeGreaterThan(10.5);
    expect(lightTimeSeconds(0) / 60).toBeLessThan(12.2);
  });
  it('stays within a realistic range over a full synodic cycle', () => {
    let lo = Infinity, hi = 0;
    for (let d = 0; d < 800; d += 5) {
      const m = lightTimeSeconds(d * 86400) / 60;
      lo = Math.min(lo, m); hi = Math.max(hi, m);
    }
    expect(lo).toBeGreaterThan(3.5);
    expect(hi).toBeLessThan(24);
    expect(LIGHT_TIME_RANGE_S.min / 60).toBeCloseTo(4.4, 0);
    expect(LIGHT_TIME_RANGE_S.max / 60).toBeCloseTo(21, 0);
  });
  it('rises after landing toward conjunction', () => {
    expect(lightTimeSeconds(100 * 86400)).toBeGreaterThan(lightTimeSeconds(0));
  });
});

const item = (title: string, value: number, bits = 8000, extra: Partial<LinkItem> = {}) => ({ kind: 'image' as const, title, createdT: tAt(1, 9), sizeBits: bits, value, payload: null, ...extra });
const mk = (over = {}) => new EarthLink({ ...DEFAULT_LINK, rateBps: 8000, ...over }, () => 600);

describe('relay passes', () => {
  const link = mk();
  it('are open only during the configured windows', () => {
    expect(link.passOpen(tAt(1, 4.05))).toBe(true);
    expect(link.passOpen(tAt(1, 16.05))).toBe(true);
    expect(link.passOpen(tAt(1, 10))).toBe(false);
    expect(link.passOpen(tAt(1, 4.5))).toBe(false); // 9 min pass is ~0.146 Mars hours
  });
  it('reports the time to the next pass', () => {
    const s = link.secondsToNextPass(tAt(1, 10));
    expect(s).toBeGreaterThan(5.5 * 3600);
    expect(s).toBeLessThan(6.5 * 3700);
    expect(link.secondsToNextPass(tAt(1, 4.05))).toBe(0);
  });
});

describe('bandwidth and queue', () => {
  it('transmits nothing outside a pass', () => {
    const l = mk();
    l.enqueue(item('a', 0.5), tAt(1, 9));
    for (let t = tAt(1, 9); t < tAt(1, 12); t += 10) l.step(t, 10);
    expect(l.bitsSentTotal).toBe(0);
    expect(l.queue.length).toBe(1);
  });
  it('never exceeds rate x pass length, and leaves the rest queued', () => {
    const l = mk({ maxQueued: 200 });
    for (let i = 0; i < 100; i++) l.enqueue(item(`img${i}`, 0.5, 80_000), tAt(1, 9)); // 100 x 80 kb = 8 Mb
    const t0 = tAt(2, 4.0);
    for (let t = t0; t < t0 + 700; t += 10) l.step(t, 10);
    expect(l.bitsSentTotal).toBeLessThanOrEqual(8000 * 540 + 1);
    expect(l.bitsSentTotal).toBeGreaterThan(8000 * 540 * 0.9);
    expect(l.queue.length).toBeGreaterThan(40);
  });
  it('sends safety notes first, then the highest-value images', () => {
    const l = mk({ maxQueued: 100 });
    l.enqueue(item('low', 0.1), tAt(1, 9));
    l.enqueue(item('high', 0.9), tAt(1, 9));
    l.enqueue({ kind: 'note', title: 'battery low', createdT: tAt(1, 9), sizeBits: 1600, value: 0, severity: 'safety', payload: null }, tAt(1, 9));
    const t0 = tAt(2, 4.0);
    for (let t = t0; t < t0 + 30; t += 1) l.step(t, 1);
    const order = l.events.filter((e) => e.type === 'sent').map((e) => e.text);
    expect(order[0]).toContain('battery low');
    expect(order[1]).toContain('high');
  });
  it('drops the lowest-priority item when the queue is full', () => {
    const l = mk({ maxQueued: 3 });
    for (const [n, v] of [['a', 0.5], ['b', 0.1], ['c', 0.7], ['d', 0.6]] as const) l.enqueue(item(n, v), tAt(1, 9));
    expect(l.queue.map((q) => q.title).sort()).toEqual(['a', 'c', 'd']);
    expect(l.dropped.map((q) => q.title)).toEqual(['b']);
  });
  it('ages waiting items so they are not starved forever', () => {
    const l = mk();
    const old = l.enqueue(item('old', 0.1), tAt(1, 9));
    const fresh = l.enqueue(item('fresh', 0.3, 8000, { createdT: tAt(15, 9) }), tAt(15, 9));
    expect(l.priority(old, tAt(15, 9))).toBeGreaterThan(l.priority(fresh, tAt(15, 9)));
  });
});

describe('light-time delay', () => {
  const run = (compression: number) => {
    const l = mk();
    l.compression = compression;
    l.enqueue(item('x', 0.5), tAt(1, 9));
    const t0 = tAt(2, 4.0);
    let sentT = -1, arrive = -1;
    for (let t = t0; t < t0 + 1500; t += 1) {
      l.step(t, 1);
      if (sentT < 0 && l.events.some((e) => e.type === 'sent')) sentT = t;
      if (arrive < 0 && l.received.length) arrive = t;
    }
    return { sentT, arrive };
  };
  it('delivers one light-time after the last bit is sent', () => {
    const { sentT, arrive } = run(1);
    expect(arrive - sentT).toBeGreaterThanOrEqual(599);
    expect(arrive - sentT).toBeLessThanOrEqual(601);
  });
  it('is divided by the speed-up slider', () => {
    const fast = run(60);
    expect(fast.arrive - fast.sentT).toBeLessThanOrEqual(11);
  });
});

const det = (cls: number, conf: number, x = 0, z = 0): Detection => ({
  id: 1, cls, name: '', kind: 'terrain', confidence: conf, rawProb: conf, bbox: { x0: 0, y0: 0, x1: 8, y1: 8 }, rangeM: 40, areaPx: 64, world: { x, z }, factors: { range: 1, sun: 1, haze: 1, occlusion: 1 },
});

describe('science value', () => {
  it('ranks habitability evidence above background ground', () => {
    const t = new NoveltyTracker();
    expect(scienceValue([det(C.ClayRich, 0.5)], t)).toBeGreaterThan(scienceValue([det(C.Regolith, 0.5)], t));
  });
  it('rises with confidence and never reaches 1', () => {
    const t = new NoveltyTracker();
    const hi = scienceValue([det(C.ClayRich, 0.9), det(C.LayeredDelta, 0.9), det(C.Olivine, 0.9)], t);
    expect(hi).toBeGreaterThan(scienceValue([det(C.ClayRich, 0.2)], t));
    expect(hi).toBeLessThan(1);
  });
  it('is worth less once the same thing was already sent from the same place', () => {
    const t = new NoveltyTracker();
    const first = scienceValue([det(C.ClayRich, 0.6, 50, 50)], t);
    t.markSent(C.ClayRich, 50, 50);
    t.markSent(C.ClayRich, 50, 50);
    expect(scienceValue([det(C.ClayRich, 0.6, 50, 50)], t)).toBeLessThan(first * 0.7);
    expect(scienceValue([det(C.ClayRich, 0.6, 900, 900)], t)).toBeCloseTo(first, 5); // somewhere new is still novel
  });
  it('discounts classes the detector is unreliable on', () => {
    const t = new NoveltyTracker();
    expect(scienceValue([det(C.ClayRich, 0.6)], t, { [C.ClayRich]: 0.1 })).toBeLessThan(scienceValue([det(C.ClayRich, 0.6)], t, { [C.ClayRich]: 0.9 }));
  });
});
