/** Shared display transform: ACES filmic (the same fit three.js uses) so the on-screen view and the camera image match. */
export const EXPOSURE = 1.0;

const fit = (v: number): number => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
const oetf = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Linear HDR rgb -> sRGB 0-255 after exposure and ACES filmic tone mapping. */
export function acesToSrgb(r: number, g: number, b: number, exposure = EXPOSURE, out: number[] = [0, 0, 0]): number[] {
  const k = exposure / 0.6;
  r *= k; g *= k; b *= k;
  const ar = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const ag = 0.076 * r + 0.90834 * g + 0.01566 * b;
  const ab = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const fr = fit(ar), fg = fit(ag), fb = fit(ab);
  const or = 1.60475 * fr - 0.53108 * fg - 0.07367 * fb;
  const og = -0.10208 * fr + 1.10813 * fg - 0.00605 * fb;
  const ob = -0.00327 * fr - 0.07276 * fg + 1.07602 * fb;
  out[0] = 255 * oetf(Math.min(1, Math.max(0, or)));
  out[1] = 255 * oetf(Math.min(1, Math.max(0, og)));
  out[2] = 255 * oetf(Math.min(1, Math.max(0, ob)));
  return out;
}
