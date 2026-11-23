import { describe, expect, it } from 'vitest';
import { C } from '../src/world/classes';
import type { Detection } from '../src/perception/detector';
import { HabitabilityMap } from '../src/habitability/model';
import { surfaceEnv } from '../src/habitability/environment';

const det = (cls: number, conf: number, x = 100, z = 100, footprint?: { x: number; z: number }[]): Detection => ({
  id: 1, cls, name: '', kind: 'terrain', confidence: conf, rawProb: conf, bbox: { x0: 0, y0: 0, x1: 8, y1: 8 }, rangeM: 50, areaPx: 64,
  world: { x, z }, factors: { range: 1, sun: 1, haze: 1, occlusion: 1 }, footprint,
});
const map = (rel = {}, slope = 4) => new HabitabilityMap(1000, 64, () => slope, rel);
const fill = (m: HabitabilityMap, cls: number, conf: number, n = 8, x = 100, z = 100) => { for (let i = 0; i < n; i++) m.add(det(cls, conf, x, z), 1, i); };
const at = (m: HabitabilityMap, x = 100, z = 100, tau = 0.6, h = 12) => m.cellScore(m.cellIndex(x, z), tau, h);

describe('evidence scoring', () => {
  it('scores past-water evidence above background regolith', () => {
    const a = map(), b = map();
    fill(a, C.ClayRich, 0.6); fill(b, C.Regolith, 0.6);
    expect(at(a).score).toBeGreaterThan(at(b).score);
    expect(at(a).water).toBeGreaterThan(0.2);
  });
  it('rises with confidence and with repeated sightings, but stays below 1', () => {
    const lo = map(), hi = map(), few = map(), many = map();
    fill(lo, C.ClayRich, 0.2); fill(hi, C.ClayRich, 0.9);
    fill(few, C.ClayRich, 0.6, 1); fill(many, C.ClayRich, 0.6, 20);
    expect(at(hi).score).toBeGreaterThan(at(lo).score);
    expect(at(many).score).toBeGreaterThan(at(few).score);
    expect(at(hi).score).toBeLessThan(1);
  });
  it('discounts evidence from classes the detector is unreliable on', () => {
    const good = map({ [C.ClayRich]: 0.9 }), bad = map({ [C.ClayRich]: 0.1 });
    fill(good, C.ClayRich, 0.6); fill(bad, C.ClayRich, 0.6);
    expect(at(bad).score).toBeLessThan(at(good).score);
  });
  it('combines several lines of evidence (water + energy) above either alone', () => {
    const both = map(), water = map();
    fill(both, C.ClayRich, 0.6); fill(both, C.Olivine, 0.6); fill(water, C.ClayRich, 0.6);
    expect(at(both).score).toBeGreaterThan(at(water).score);
  });
});

describe('negative factors', () => {
  it('perchlorate-bearing regolith lowers the score', () => {
    const clean = map(), dusty = map();
    fill(clean, C.ClayRich, 0.7); fill(dusty, C.ClayRich, 0.7); fill(dusty, C.Regolith, 0.9, 12);
    expect(at(dusty).perchlorate).toBeGreaterThan(at(clean).perchlorate);
    expect(at(dusty).score).toBeLessThan(at(clean).score);
  });
  it('steep terrain lowers stability and the score', () => {
    const flat = map({}, 2), steep = map({}, 19);
    fill(flat, C.ClayRich, 0.7); fill(steep, C.ClayRich, 0.7);
    expect(at(steep).stability).toBeLessThan(at(flat).stability);
    expect(at(steep).score).toBeLessThan(at(flat).score);
  });
  it('detected shelter reduces the UV penalty', () => {
    const open = map(), sheltered = map();
    fill(open, C.ClayRich, 0.7); fill(sheltered, C.ClayRich, 0.7); fill(sheltered, C.Crater, 0.9, 12);
    expect(at(sheltered).uv).toBeLessThan(at(open).uv);
  });
  it('UV is zero at night and falls with dust; the surface is cold', () => {
    expect(surfaceEnv(1, 0.6).uvIndex).toBe(0);
    expect(surfaceEnv(12, 3).uvIndex).toBeLessThan(surfaceEnv(12, 0.3).uvIndex);
    expect(surfaceEnv(14, 0.6).temperatureK).toBeGreaterThan(surfaceEnv(4, 0.6).temperatureK);
    expect(surfaceEnv(14, 0.6).temperatureK).toBeLessThan(273);
  });
});

describe('map behaviour', () => {
  it('spreads a terrain region over its footprint cells', () => {
    const m = map();
    m.add(det(C.ClayRich, 0.6, 0, 0, [{ x: -300, z: 0 }, { x: 300, z: 0 }]), 1, 0);
    expect(at(m, -300, 0).sightings).toBeGreaterThan(0);
    expect(at(m, 300, 0).sightings).toBeGreaterThan(0);
    expect(at(m, 0, 0).sightings).toBe(0);
  });
  it('shows no data (-1) where nothing was detected', () => {
    const m = map();
    fill(m, C.ClayRich, 0.6);
    const heat = m.heat();
    expect(heat[m.cellIndex(100, 100)]).toBeGreaterThanOrEqual(0);
    expect(heat[m.cellIndex(-800, -800)]).toBe(-1);
  });
  it('makes nearby cells more interesting to the planner', () => {
    const m = map();
    fill(m, C.ClayRich, 0.7, 10, 100, 100);
    expect(m.interestAt(125, 100)).toBeGreaterThan(m.interestAt(-700, -700));
    expect(m.interestAt(-700, -700)).toBe(0);
  });
  it('ignores classes with no habitability rule', () => {
    const m = map();
    m.add(det(C.None, 0.9), 1, 0);
    expect(m.detections).toBe(0);
  });
});

describe('verdict wording', () => {
  it('says nothing has been assessed before any detection', () => {
    const v = map().verdict();
    expect(v.level).toBe('none');
    expect(v.headline).toMatch(/no assessment/i);
  });
  it('uses "consistent with past habitable conditions" and never claims life', () => {
    const m = map({ [C.ClayRich]: 0.8, [C.LayeredDelta]: 0.8, [C.Olivine]: 0.8 });
    for (const cls of [C.ClayRich, C.LayeredDelta, C.Olivine]) fill(m, cls, 0.9, 25);
    const v = m.verdict();
    expect(['weak', 'moderate', 'strong']).toContain(v.level);
    const text = `${v.headline} ${v.summary} ${v.caveat} ${v.findings.map((f) => f.why).join(' ')}`.toLowerCase();
    expect(v.headline.toLowerCase()).toContain('consistent with past habitable conditions');
    expect(text).not.toMatch(/life (was |is )?found|found life|evidence of life|proof|detected life|alien/);
    expect(v.caveat.toLowerCase()).toContain('not a finding of life');
  });
  it('keeps strong claims out when evidence is weak', () => {
    const m = map();
    fill(m, C.ClayRich, 0.1, 2);
    expect(['insufficient', 'weak']).toContain(m.verdict().level);
  });
  it('lists findings with their reasoning and flags assumed mappings', () => {
    const m = map({ [C.ClayRich]: 0.5 });
    fill(m, C.ClayRich, 0.5);
    const f = m.verdict().findings.find((x) => x.cls === C.ClayRich)!;
    expect(f.why.length).toBeGreaterThan(20);
    expect(f.assumedMapping).toBe(true);
    expect(f.precision).toBe(0.5);
  });
});
