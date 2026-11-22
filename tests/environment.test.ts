import { describe, expect, it } from 'vitest';
import { SOL_SECONDS } from '../src/sim/constants';
import { SimClock } from '../src/sim/clock';
import { atmosphereAt, secondsToSunCrossing, sunAt } from '../src/sim/environment';

const deg = (r: number) => (r * 180) / Math.PI;

describe('sun position at Jezero', () => {
  it('peaks near 90 - lat + declination at local noon', () => expect(deg(sunAt(12, 5).elevation)).toBeCloseTo(73.7, 0));
  it('is below the horizon at midnight', () => expect(sunAt(0).elevation).toBeLessThan(0));
  it('is symmetric about noon', () => expect(sunAt(9).elevation).toBeCloseTo(sunAt(15).elevation, 6));
});

describe('dust', () => {
  it('dims the direct beam as tau rises', () => expect(atmosphereAt(deg(1) * 40, 3).directFactor).toBeLessThan(atmosphereAt(deg(1) * 40, 0.5).directFactor));
});

describe('sun crossings and clock', () => {
  it('finds sunset within a sol', () => {
    const s = secondsToSunCrossing(12, 6, 'set');
    expect(s).toBeGreaterThan(5 * 3600);
    expect(s).toBeLessThan(8 * 3700);
  });
  it('sol length is 88775 s and a sol rolls over', () => {
    expect(SOL_SECONDS).toBeCloseTo(88775.244, 3);
    const c = new SimClock(8);
    expect(c.sol).toBe(1);
    c.t = SOL_SECONDS;
    expect(c.sol).toBe(2);
    expect(c.localHours).toBeCloseTo(8, 6);
  });
  it('setLocalHours stays in the same sol', () => {
    const c = new SimClock(8);
    c.setLocalHours(14);
    expect(c.localHours).toBeCloseTo(14, 6);
    expect(c.sol).toBe(1);
  });
});
