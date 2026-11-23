#!/usr/bin/env python3
"""Cut a 2 x 2 km window from the 1 m USGS/JPL HiRISE DTM of Jezero into a 1024 x 1024 heightmap.

Usage: python3 scripts/prepare_hirise.py <dtm path or https URL> public/data
Needs: numpy, rasterio, pillow (dev-time only, not a runtime dependency).

The DTM is in an equirectangular projection with standard parallel 0, so east-west pixels cover
cos(lat) metres of ground (about 0.95 m here) while north-south pixels cover 1 m. The window is
resampled (area average) to a square grid with uniform ground spacing of 2000/1024 = 1.95 m/px.
Heights are packed as 16 bits into R (high) and G (low) because browsers decode 16-bit PNG to 8 bits.
"""
import json, math, sys
import numpy as np, rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.windows import Window

src, outdir = sys.argv[1], sys.argv[2]
R = 3396190.0           # Mars 2000 sphere radius (m)
SIZE_M, OUT = 2000.0, 1024
# Window centre, chosen from the CTX hillshade + Stack et al. (2020) units so the delta front,
# the crater-floor edge and an isolated delta butte all fall inside. Planetocentric degrees.
LAT_C, LON_C = 18.4568, 77.4240

lat_c = math.radians(LAT_C)
xc, yc = R * math.radians(LON_C), R * lat_c         # window centre in CRS metres (x = R*lon, y = R*lat)
kx = math.cos(lat_c)                                  # ground metres per CRS x metre
w_px, h_px = SIZE_M / kx, SIZE_M                      # window size in source pixels (1 px = 1 CRS metre)
env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_TIMEOUT="120")
with rasterio.Env(**env):
    with rasterio.open(src) as s:
        assert abs(s.transform.a - 1) < 1e-9 and abs(s.transform.e + 1) < 1e-9, "expected 1 m pixels"
        col0 = (xc - w_px / 2) - s.transform.c
        row0 = s.transform.f - (yc + h_px / 2)
        win = Window(col0, row0, w_px, h_px)
        a = s.read(1, window=win, out_shape=(OUT, OUT), resampling=Resampling.average, masked=True)
        left, top = xc - w_px / 2, yc + h_px / 2
assert not np.ma.getmaskarray(a).any(), "nodata inside the window"
a = a.filled(0).astype("float64")
lo, hi = float(a.min()), float(a.max())
u16 = np.round((a - lo) / (hi - lo) * 65535).astype("uint16")
rgb = np.zeros((OUT, OUT, 3), dtype="uint8"); rgb[..., 0] = (u16 >> 8); rgb[..., 1] = (u16 & 255)
Image.fromarray(rgb, "RGB").save(f"{outdir}/jezero_height_rg.png")
cell = SIZE_M / OUT
meta = dict(source="JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif",
            product="Mars 2020 TRN HiRISE DTM mosaic (USGS Astrogeology / JPL)", doi="10.5066/P9REJ9JN",
            nativeMetresPerPixel=1, outputSize=OUT, sizeMetres=SIZE_M, metresPerPixel=cell,
            minElevation=lo, maxElevation=hi,
            projection="Equirectangular, Mars 2000 sphere R=3396190 m, standard parallel 0",
            centreLatDeg=LAT_C, centreLonDeg=LON_C, crsOriginX=left, crsOriginY=top, groundPerCrsX=kx,
            windowCrsWidth=w_px, windowCrsHeight=h_px)
json.dump(meta, open(f"{outdir}/jezero_height_rg.json", "w"), indent=2)
gy, gx = np.gradient(a, cell)
sl = np.degrees(np.arctan(np.hypot(gx, gy)))
print(json.dumps(meta, indent=1)); print("slope deg: mean %.2f p95 %.2f p99 %.2f max %.2f" % (sl.mean(), np.percentile(sl, 95), np.percentile(sl, 99), sl.max()))
