import { MARS_GRAVITY } from './constants';

/**
 * Power model for a HYPOTHETICAL solar + battery rover. Perseverance itself runs on an MMRTG, so these
 * numbers are assumptions chosen to be Mars-plausible (Spirit/Opportunity-class array), not Perseverance specs.
 * The rover mass (1025 kg) and gravity (3.71 m/s^2) are real.
 */
export interface EnergyParams {
  batteryCapacityWh: number;
  /** Mean top-of-atmosphere solar flux at Mars, W/m^2 (~590). */
  solarConstantWm2: number;
  arrayAreaM2: number;
  arrayEfficiency: number;
  /** Awake, not driving. */
  idleW: number;
  /** Driving electronics + rolling resistance on flat ground, at nominal speed. */
  driveBaseW: number;
  /** Night survival heaters. */
  hibernateW: number;
  /** Camera + compute while sensing/detecting (added on top of idle or drive). */
  sensingW: number;
  massKg: number;
  /** Electrical-to-mechanical efficiency when climbing. */
  climbEfficiency: number;
  /** Below this state of charge the rover must stop and charge. */
  minSocFrac: number;
}

export const DEFAULT_ENERGY: EnergyParams = {
  batteryCapacityWh: 1200,
  solarConstantWm2: 590,
  arrayAreaM2: 1.3,
  arrayEfficiency: 0.25,
  idleW: 35,
  driveBaseW: 100,
  hibernateW: 20,
  sensingW: 12,
  massKg: 1025,
  climbEfficiency: 0.3,
  minSocFrac: 0.2,
};

export type PowerMode = 'drive' | 'idle' | 'hibernate';

/**
 * Electrical power from the array in watts for a horizontal panel.
 * Beam transmittance T = exp(-tau / sin(el)); a simple diffuse term adds 25% of the lost beam as scattered light
 * (more dust scatters more). Zero when the sun is below the horizon.
 */
export function solarPowerW(p: EnergyParams, sunElevationRad: number, tau: number): number {
  if (sunElevationRad <= 0) return 0;
  const s = Math.sin(sunElevationRad);
  const beam = Math.exp(-tau / Math.max(s, 0.02));
  const diffuse = 0.25 * (1 - beam) * (1 - Math.exp(-tau));
  return p.solarConstantWm2 * p.arrayAreaM2 * p.arrayEfficiency * s * (beam + diffuse);
}

/** Electrical drive power at ground speed `v` (m/s) while climbing at `climbRate` (m/s, negative = descending, no regen). */
export function drivePowerW(p: EnergyParams, v: number, climbRate: number, nominalSpeed = 0.1): number {
  const base = p.driveBaseW * Math.min(1, v / nominalSpeed);
  const climb = (p.massKg * MARS_GRAVITY * Math.max(0, climbRate)) / p.climbEfficiency;
  return base + climb;
}

/** Energy in Wh to drive a path of `lengthM` with `climbM` total ascent at `speed`. */
export function driveEnergyWh(p: EnergyParams, lengthM: number, climbM: number, speed = 0.1): number {
  const base = (p.driveBaseW * lengthM) / speed / 3600;
  const climb = (p.massKg * MARS_GRAVITY * climbM) / p.climbEfficiency / 3600;
  return base + climb;
}

export function loadW(p: EnergyParams, mode: PowerMode, sensing: boolean): number {
  const mech = mode === 'hibernate' ? p.hibernateW : p.idleW;
  return mech + (sensing && mode !== 'hibernate' ? p.sensingW : 0);
}

export class Battery {
  constructor(
    readonly params: EnergyParams,
    public wh = params.batteryCapacityWh * 0.9,
  ) {}
  get soc(): number {
    return this.wh / this.params.batteryCapacityWh;
  }
  /** Apply net power for dt seconds. Returns the net watts. Clamped to [0, capacity]. */
  step(generatedW: number, consumedW: number, dt: number): number {
    const net = generatedW - consumedW;
    this.wh = Math.min(this.params.batteryCapacityWh, Math.max(0, this.wh + (net * dt) / 3600));
    return net;
  }
}
