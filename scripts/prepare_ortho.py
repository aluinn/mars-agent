#!/usr/bin/env python3
"""Cut the matching window from the 25 cm HiRISE orthoimage into a 4096 x 4096 greyscale JPEG.

Usage: python3 scripts/prepare_ortho.py <ortho path or https URL> public/data
Needs jezero_height_rg.json from prepare_hirise.py in the same folder (same window and CRS).
Needs: numpy, rasterio, pillow (dev-time only).
Source: Mars 2020 TRN HiRISE orthorectified image mosaic (USGS Astrogeology / JPL), HiRISE red band, 0.25 m/px.
"""
import json, sys
import numpy as np, rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.windows import Window

src, outdir = sys.argv[1], sys.argv[2]
m = json.load(open(f"{outdir}/jezero_height_rg.json"))
OUT = 4096
env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_TIMEOUT="180")
with rasterio.Env(**env):
    with rasterio.open(src) as s:
        px = s.transform.a  # 0.25 m per CRS metre
        col0 = (m["crsOriginX"] - s.transform.c) / px
        row0 = (s.transform.f - m["crsOriginY"]) / px
        win = Window(col0, row0, m["windowCrsWidth"] / px, m["windowCrsHeight"] / px)
        a = s.read(1, window=win, out_shape=(OUT, OUT), resampling=Resampling.average)
print("nodata (0) fraction:", float((a == 0).mean()), "mean", float(a.mean()))
Image.fromarray(a, "L").save(f"{outdir}/jezero_ortho.jpg", quality=90, optimize=True)
json.dump(dict(source="JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif", size=OUT, nativeMetresPerPixel=0.25,
               metresPerPixel=m["sizeMetres"] / OUT, band="HiRISE red, 8-bit greyscale", note="area-averaged from 0.25 m"), open(f"{outdir}/jezero_ortho.json", "w"), indent=2)
