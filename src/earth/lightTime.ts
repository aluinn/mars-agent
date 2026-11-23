/**
 * One-way Earth-Mars light time from a SIMPLIFIED model: circular, coplanar orbits (Earth 1 AU, Mars 1.524 AU).
 * That gives about 4.4 min at closest approach to 21 min at conjunction; the real range is roughly 3-22 min because the
 * orbits are eccentric. The phase is set so the delay starts near 11.3 min (Perseverance landing, Feb 2021) and then
 * rises toward conjunction, as it did in reality.
 */
const AU_LIGHT_SECONDS = 499.005;
const R_EARTH = 1;
const R_MARS = 1.524;
const SYNODIC_DAYS = 779.94;
/** Earth-Mars angle at mission start (degrees), chosen so the start delay is about 11.3 minutes. */
const START_ANGLE_DEG = 61;

export const lightTimeAtAngle = (thetaRad: number): number => {
  const d = Math.sqrt(R_EARTH ** 2 + R_MARS ** 2 - 2 * R_EARTH * R_MARS * Math.cos(thetaRad));
  return d * AU_LIGHT_SECONDS;
};

/** One-way light time in seconds at `simSeconds` since mission start (Earth days = seconds / 86400). */
export function lightTimeSeconds(simSeconds: number): number {
  const theta = ((START_ANGLE_DEG + (360 * (simSeconds / 86400)) / SYNODIC_DAYS) * Math.PI) / 180;
  return lightTimeAtAngle(theta);
}

export const LIGHT_TIME_RANGE_S = { min: lightTimeAtAngle(0), max: lightTimeAtAngle(Math.PI) };
