export interface HeightmapMeta {
  outputSize: number;
  sizeMetres: number;
  metresPerPixel: number;
  minElevation: number;
  maxElevation: number;
  source: string;
  doi: string;
  windowLeftM: number;
  windowTopM: number;
}

/** Elevation grid in metres, row 0 = north edge, relative to the patch minimum. */
export class Heightmap {
  constructor(
    readonly size: number,
    readonly sizeMetres: number,
    readonly data: Float32Array,
    readonly meta: HeightmapMeta,
  ) {}

  get cell(): number {
    return this.sizeMetres / this.size;
  }

  /** World x (east) / z (south) in metres, centred on the patch. Returns bilinear height above patch minimum. */
  heightAt(x: number, z: number): number {
    const half = this.sizeMetres / 2;
    const fx = ((x + half) / this.sizeMetres) * (this.size - 1);
    const fz = ((z + half) / this.sizeMetres) * (this.size - 1);
    const cx = Math.min(Math.max(fx, 0), this.size - 1.001);
    const cz = Math.min(Math.max(fz, 0), this.size - 1.001);
    const x0 = Math.floor(cx);
    const z0 = Math.floor(cz);
    const tx = cx - x0;
    const tz = cz - z0;
    const i = z0 * this.size + x0;
    const d = this.data;
    const h00 = d[i] ?? 0;
    const h10 = d[i + 1] ?? 0;
    const h01 = d[i + this.size] ?? 0;
    const h11 = d[i + this.size + 1] ?? 0;
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
  }

  /** Slope in degrees at a world position (central differences over one cell). */
  slopeAt(x: number, z: number): number {
    const e = this.cell;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  }
}

/** Decode a heightmap packed as 16-bit height in the R (high) and G (low) bytes of an RGB PNG. */
export function decodePackedHeights(rgba: Uint8ClampedArray | Uint8Array, size: number, meta: HeightmapMeta): Heightmap {
  const range = meta.maxElevation - meta.minElevation;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const v = ((rgba[i * 4] ?? 0) << 8) | (rgba[i * 4 + 1] ?? 0);
    out[i] = (v / 65535) * range;
  }
  return new Heightmap(size, meta.sizeMetres, out, meta);
}

/** Decode an image URL into RGBA bytes via a 2D canvas (no colour conversion for plain PNGs). */
export async function loadImagePixels(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
}

export async function loadHeightmap(base = '/data/jezero_height_rg'): Promise<Heightmap> {
  const meta = (await (await fetch(`${base}.json`)).json()) as HeightmapMeta;
  const px = await loadImagePixels(`${base}.png`);
  return decodePackedHeights(px.data, px.width, meta);
}

const MARS_RADIUS_M = 3396190;
const STD_PARALLEL_DEG = 18.4663;

/** Convert planetocentric lat/lon (degrees) to patch world coordinates (x east, z south, metres from centre). */
export function latLonToWorld(meta: HeightmapMeta, latDeg: number, lonDeg: number): { x: number; z: number } {
  const X = MARS_RADIUS_M * ((lonDeg * Math.PI) / 180) * Math.cos((STD_PARALLEL_DEG * Math.PI) / 180);
  const Y = MARS_RADIUS_M * ((latDeg * Math.PI) / 180);
  const half = meta.sizeMetres / 2;
  return { x: X - meta.windowLeftM - half, z: meta.windowTopM - Y - half };
}
