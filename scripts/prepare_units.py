#!/usr/bin/env python3
"""Rasterise the Stack et al. (2020) Jezero photogeologic map onto the 1024x1024 heightmap grid.

Usage: python3 scripts/prepare_units.py <M2020_JEZ_geology_..._archive.shp> public/data
Needs: numpy, rasterio, shapely, fiona, pillow (dev-time only).

Output: public/data/jezero_units.png   R = bedrock unit id, G = surface unit id (0 = none)
        public/data/jezero_units.json  legends + provenance
Needs jezero_height_rg.json from prepare_hirise.py (window origin and size).
Source: Stack et al. 2020, Space Science Reviews, https://doi.org/10.1007/s11214-020-00739-x
        (supplementary shapefile; Mars 2000 sphere, equidistant cylindrical, std parallel 0).
"""
import json, math, sys
import fiona, numpy as np
from PIL import Image
from rasterio import features
from rasterio.transform import Affine
from shapely.geometry import shape

src, outdir = sys.argv[1], sys.argv[2]
meta = json.load(open(f"{outdir}/jezero_height_rg.json"))
OUT = meta["outputSize"]
# The shapefile and the HiRISE DTM share one CRS (equirectangular, standard parallel 0), so pixel -> CRS is a plain affine.
tf = Affine(meta["windowCrsWidth"] / OUT, 0, meta["crsOriginX"], 0, -meta["windowCrsHeight"] / OUT, meta["crsOriginY"])

bed_names, surf_names = [], []
def uid(names, v):
    v = "None" if v is None else str(v)
    if v not in names: names.append(v)
    return names.index(v) + 1

bed_shapes, surf_shapes = [], []
with fiona.open(src) as f:
    for ft in f:
        if ft["geometry"] is None: continue
        g = shape(ft["geometry"])
        if not g.is_valid: g = g.buffer(0)
        p = ft["properties"]
        b = uid(bed_names, p["BedrkUName"]); s = uid(surf_names, p["SurfUName"])
        bed_shapes.append((g, b)); surf_shapes.append((g, s))

def ras(shapes):
    return features.rasterize(shapes, out_shape=(OUT, OUT), transform=tf, fill=0, dtype="uint8")
bed = ras(bed_shapes); surf = ras(surf_shapes)
rgb = np.zeros((OUT, OUT, 3), dtype="uint8"); rgb[..., 0] = bed; rgb[..., 1] = surf
Image.fromarray(rgb, "RGB").save(f"{outdir}/jezero_units.png")
used_b = {bed_names[i - 1]: int((bed == i).sum()) for i in np.unique(bed) if i}
used_s = {surf_names[i - 1]: int((surf == i).sum()) for i in np.unique(surf) if i}
json.dump(dict(source="Stack et al. 2020 photogeologic map (supplementary shapefile)", doi="10.1007/s11214-020-00739-x",
               bedrock=bed_names, surface=surf_names, pixelsBedrock=used_b, pixelsSurface=used_s,
               uncoveredPixels=int((bed == 0).sum())), open(f"{outdir}/jezero_units.json", "w"), indent=2)
print("bedrock px:", used_b); print("surface px:", used_s); print("uncovered:", int((bed == 0).sum()), "of", OUT * OUT)
