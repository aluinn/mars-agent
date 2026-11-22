import { JEZERO_LAT_DEG, MARS_OBLIQUITY_DEG, SOL_SECONDS } from './constants';

const rad = (d: number) => (d * Math.PI) / 180;

/** Solar declination (radians) for areocentric longitude Ls (degrees), simple obliquity model. */
export function declination(lsDeg: number): number {
  return Math.asin(Math.sin(rad(MARS_OBLIQUITY_DEG)) * Math.sin(rad(lsDeg)));
}

export interface SunState {
  /** Elevation above the horizon, radians (negative = night). */
  elevation: number;
  /** Azimuth measured clockwise from north, radians. */
  azimuth: number;
}

/** Sun position for local mean solar time `hours` (0-24 Mars hours, 12 = noon). */
export function sunAt(localHours: number, lsDeg = 5, latDeg = JEZERO_LAT_DEG): SunState {
  const lat = rad(latDeg);
  const dec = declination(lsDeg);
  const h = ((localHours / 24) - 0.5) * 2 * Math.PI; // hour angle, 0 at noon
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const elevation = Math.asin(Math.min(1, Math.max(-1, sinEl)));
  const az = Math.atan2(-Math.sin(h) * Math.cos(dec), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(h));
  return { elevation, azimuth: (az + 2 * Math.PI) % (2 * Math.PI) };
}

export interface Atmosphere {
  /** Direct-beam transmittance 0..1 (Beer-Lambert through optical depth tau along the slant path). */
  directFactor: number;
  /** Diffuse sky light fraction 0..1. */
  diffuseFactor: number;
  sky: [number, number, number];
  fogDensity: number;
}

/** Dust opacity `tau` dims the direct beam, adds diffuse light, and tints the sky. Daylight only. */
export function atmosphereAt(sunElevation: number, tau: number): Atmosphere {
  const sinEl = Math.max(Math.sin(sunElevation), 0.02);
  const day = Math.max(0, Math.min(1, (sunElevation + rad(6)) / rad(12))); // twilight ramp
  const direct = Math.exp(-tau / sinEl) * (sunElevation > 0 ? 1 : 0);
  const diffuse = (0.12 + 0.18 * (1 - Math.exp(-tau))) * day;
  // Butterscotch: dusty salmon-tan sky, darker/redder with more dust, dark at night.
  const dust = Math.min(1, tau / 4);
  const sky: [number, number, number] = [
    (0.78 - 0.1 * dust) * day,
    (0.58 - 0.12 * dust) * day,
    (0.38 - 0.1 * dust) * day,
  ];
  return { directFactor: direct, diffuseFactor: diffuse, sky, fogDensity: 0.00006 + 0.00018 * tau };
}

/** Local mean solar time as HH:MM in Mars hours (1/24 of a sol; a Mars hour is ~61.7 Earth minutes). */
export function formatLocalTime(hours: number): string {
  const total = ((hours % 24) + 24) % 24;
  const h = Math.floor(total);
  const m = Math.floor((total - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Sim seconds until the sun next crosses `thresholdDeg` going down ('set') or up ('rise').
 * Scans forward in 5-minute steps (error < 5 min). Returns 0 if already past it in that direction
 * is not the case: e.g. asking 'set' while the sun is already below returns the time to the NEXT sunset.
 */
export function secondsToSunCrossing(localHours: number, thresholdDeg: number, dir: 'set' | 'rise', lsDeg = 5): number {
  const stepS = 300;
  const stepH = (stepS / SOL_SECONDS) * 24;
  const th = (thresholdDeg * Math.PI) / 180;
  const above = (h: number) => sunAt(h, lsDeg).elevation > th;
  let prev = above(localHours);
  for (let s = 1; s * stepS < SOL_SECONDS * 1.5; s++) {
    const cur = above(localHours + s * stepH);
    if (dir === 'set' && prev && !cur) return s * stepS;
    if (dir === 'rise' && !prev && cur) return s * stepS;
    prev = cur;
  }
  return Infinity;
}
