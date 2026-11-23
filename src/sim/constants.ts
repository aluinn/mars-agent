/** Real Mars values used across the simulation. */
export const MARS_GRAVITY = 3.71; // m/s^2 (surface, equatorial mean)
export const SOL_SECONDS = 24 * 3600 + 39 * 60 + 35.244; // 88775.244 s, mean solar day
export const SOL_HOURS = SOL_SECONDS / 3600;
export const MARS_OBLIQUITY_DEG = 25.19;
/** Jezero Crater (landing site is 18.4446 N, 77.4509 E). */
export const JEZERO_LAT_DEG = 18.4446;
/** Perseverance auto-nav top speed is ~0.1 m/s or less (hazard-avoidance autonav is slower). */
export const ROVER_MAX_SPEED = 0.1; // m/s
