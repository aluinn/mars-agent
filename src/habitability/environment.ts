import { sunAt } from '../sim/environment';

/**
 * Crude surface environment readouts for the negative factors. These are MODEL ASSUMPTIONS for illustration, not
 * measurements: diurnal surface temperature swing about a cold mean, and a UV index from sun height and dust.
 */
export interface SurfaceEnv {
  /** Estimated surface temperature (K) at this local time. */
  temperatureK: number;
  /** 0-1: how much of the cold-limit applies (1 = far below freezing all day). */
  coldFactor: number;
  /** 0-1 relative UV dose at the surface right now (before any shelter). */
  uvIndex: number;
}

const T_MEAN = 228; // K, assumed
const T_AMP = 40; // K at tau 0, damped by dust

export function surfaceEnv(localHours: number, tau: number): SurfaceEnv {
  const amp = T_AMP * Math.exp(-0.25 * tau);
  const temperatureK = T_MEAN + amp * Math.cos((2 * Math.PI * (localHours - 14)) / 24);
  const sunEl = sunAt(localHours).elevation;
  const uvIndex = Math.max(0, Math.sin(sunEl)) * Math.exp(-0.4 * tau);
  const coldFactor = Math.min(1, Math.max(0, (273 - temperatureK) / 90));
  return { temperatureK, coldFactor, uvIndex };
}
