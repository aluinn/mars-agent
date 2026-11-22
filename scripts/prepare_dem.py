#!/usr/bin/env python3
"""Crop a 5 x 5 km Jezero window from the USGS CTX DEM and write a 1024x1024 heightmap (16-bit packed into RG).

Usage: python3 scripts/prepare_dem.py <M20_JezeroCrater_CTXDEM_20m.tif> public/data
Needs: numpy, rasterio, pillow (dev-time only, not a runtime dependency).
Native posting is 20 m/px, so 5 km = 250 px; the 1024 output is a bicubic upsample.
"""
import json, sys
import numpy as np, rasterio
from PIL import Image

src, outdir = sys.argv[1], sys.argv[2]
COL0, ROW0, N = 1049, 2310, 250  # window origin (native px) chosen from hillshade, see docs/DATA_SOURCES.md
OUT = 1024
with rasterio.open(src) as s:
    a = s.read(1, window=((ROW0, ROW0 + N), (COL0, COL0 + N))).astype("float64")
    t = s.transform
    left, top = t.c + COL0 * t.a, t.f + ROW0 * t.e
assert a.min() > -1e30, "nodata inside crop"
lo, hi = float(a.min()), float(a.max())
im = Image.fromarray(a.astype("float32"), mode="F").resize((OUT, OUT), Image.BICUBIC)
up = np.asarray(im, dtype="float64")
up = np.clip(up, lo, hi)
u16 = np.round((up - lo) / (hi - lo) * 65535).astype("uint16")
# Browsers decode 16-bit PNG to 8-bit, so pack the 16-bit height into R (high byte) and G (low byte).
rgb = np.zeros((OUT, OUT, 3), dtype="uint8")
rgb[..., 0] = (u16 >> 8).astype("uint8")
rgb[..., 1] = (u16 & 255).astype("uint8")
Image.fromarray(rgb, "RGB").save(f"{outdir}/jezero_height_rg.png")
meta = dict(source="M20_JezeroCrater_CTXDEM_20m.tif", doi="10.5066/P906QQT8", nativeMetresPerPixel=20,
            nativeSize=N, outputSize=OUT, sizeMetres=N * 20, metresPerPixel=N * 20 / OUT,
            minElevation=lo, maxElevation=hi, projection="Equirectangular, Mars 2000 sphere R=3396190, std parallel 18.4663",
            windowLeftM=left, windowTopM=top, windowCol0=COL0, windowRow0=ROW0)
json.dump(meta, open(f"{outdir}/jezero_height_rg.json", "w"), indent=2)
gy, gx = np.gradient(up, N * 20 / OUT)
sl = np.degrees(np.arctan(np.hypot(gx, gy)))
print(json.dumps(meta, indent=1)); print("slope deg: mean %.2f p95 %.2f p99 %.2f max %.2f" % (sl.mean(), np.percentile(sl, 95), np.percentile(sl, 99), sl.max()))
