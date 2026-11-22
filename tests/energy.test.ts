import { describe, expect, it } from 'vitest';
import { Battery, DEFAULT_ENERGY, driveEnergyWh, drivePowerW, loadW, solarPowerW } from '../src/sim/energy';
import { MARS_GRAVITY } from '../src/sim/constants';

const deg = (d: number) => (d * Math.PI) / 180;

describe('solar power', () => {
  it('is zero at night', () => expect(solarPowerW(DEFAULT_ENERGY, deg(-10), 0.6)).toBe(0));
  it('rises with sun elevation', () => expect(solarPowerW(DEFAULT_ENERGY, deg(60), 0.6)).toBeGreaterThan(solarPowerW(DEFAULT_ENERGY, deg(20), 0.6)));
  it('falls with dust opacity', () => expect(solarPowerW(DEFAULT_ENERGY, deg(60), 3)).toBeLessThan(solarPowerW(DEFAULT_ENERGY, deg(60), 0.5)));
});

describe('drive energy', () => {
  it('flat drive: 100 W for 1000 s (100 m at 0.1 m/s) is 27.78 Wh', () => expect(driveEnergyWh(DEFAULT_ENERGY, 100, 0, 0.1)).toBeCloseTo(27.78, 2));
  it('climbing adds m*g*h/eta using Mars gravity', () => {
    const climb = driveEnergyWh(DEFAULT_ENERGY, 100, 10, 0.1) - driveEnergyWh(DEFAULT_ENERGY, 100, 0, 0.1);
    expect(climb).toBeCloseTo((1025 * MARS_GRAVITY * 10) / 0.3 / 3600, 3);
  });
  it('instantaneous drive power adds a climb term and ignores descent', () => {
    expect(drivePowerW(DEFAULT_ENERGY, 0.1, 0.02)).toBeGreaterThan(drivePowerW(DEFAULT_ENERGY, 0.1, 0));
    expect(drivePowerW(DEFAULT_ENERGY, 0.1, -0.02)).toBe(drivePowerW(DEFAULT_ENERGY, 0.1, 0));
  });
});

describe('battery and loads', () => {
  it('hibernation draws less than idle, sensing adds load', () => {
    expect(loadW(DEFAULT_ENERGY, 'hibernate', true)).toBeLessThan(loadW(DEFAULT_ENERGY, 'idle', false));
    expect(loadW(DEFAULT_ENERGY, 'idle', true)).toBeGreaterThan(loadW(DEFAULT_ENERGY, 'idle', false));
  });
  it('discharges, charges and clamps to [0, capacity]', () => {
    const b = new Battery(DEFAULT_ENERGY, 100);
    b.step(0, 100, 3600);
    expect(b.wh).toBe(0);
    b.step(5000, 0, 3600);
    expect(b.wh).toBe(DEFAULT_ENERGY.batteryCapacityWh);
  });
  it('integrates watts over seconds into Wh', () => {
    const b = new Battery(DEFAULT_ENERGY, 500);
    b.step(0, 36, 3600);
    expect(b.wh).toBeCloseTo(464, 6);
  });
});
