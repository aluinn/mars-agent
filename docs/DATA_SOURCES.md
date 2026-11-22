# Data sources

## Terrain: Mars 2020 Science Investigation CTX DEM Mosaic (real data)

| Field | Value |
| --- | --- |
| Product | Mars 2020 Science Investigation CTX DEM Mosaic, `M20_JezeroCrater_CTXDEM_20m.tif` |
| Publisher | USGS Astrogeology Science Center (built from MRO CTX stereo, Ames Stereo Pipeline, JPL/USGS) |
| Product page | https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic |
| Download | https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif |
| DOI | https://doi.org/10.5066/P906QQT8 |
| Native resolution | 20 m/pixel, 4456 x 5067 px, 32-bit float, metres |
| Projection | Equirectangular, Mars 2000 sphere (R = 3,396,190 m), standard parallel 18.4663 N |
| Control | MOLA control net (horizontal accuracy "accurate to control net" per the product metadata) |
| Licence | Public domain (USGS use constraint: "public domain", "please cite authors") |
| SHA-256 of the file we used | `ba7f706ea1b5d63a562f28a7dcf7a7f3c79bce7f048e6974b57e8a33c30d1ba2` (90,345,300 bytes) |

The raw GeoTIFF is **not** committed (90 MB). Fetch it from the URL above.

### Our crop

- Window: columns 1049-1298, rows 2310-2559 of the native raster (250 x 250 px = 5 km x 5 km).
- Geographic extent: about 18.426-18.511 N, 77.371-77.460 E. It includes the Jezero delta front scarp, the crater floor edge, and the Perseverance landing site (18.4446 N, 77.4509 E, near the south-east corner).
- Elevation range in the crop: -2588.9 m to -2396.6 m (192 m of relief). Slopes at 4.9 m/px: mean 4.4 deg, 95th percentile 13.3 deg, 99th percentile 21.6 deg, max 37.3 deg.
- Output: `public/data/jezero_height_rg.png` (1024 x 1024, 16-bit height packed into the R and G bytes because browsers decode 16-bit PNGs down to 8 bits) plus `jezero_height_rg.json` (min/max elevation, extent, provenance).
- Regenerate with `scripts/prepare_dem.py` (needs Python with numpy, rasterio and pillow; dev-time only).

### Honest limits

- The source is 20 m/px. The 1024 x 1024 heightmap (4.88 m/px) is a **bicubic upsample** of 250 x 250 real samples, so it is smooth. Features smaller than about 40 m (rocks, ripples, small craters) are **not** in the elevation data.
- Rocks, cobbles, ripples and other small objects in the simulation are synthetic scene objects placed on top of the real terrain. They are not mapped from imagery.
- Terrain colour is a plain regolith tint by elevation. We do not use the CTX orthomosaic.
- A higher-resolution alternative exists (HiRISE DTM mosaic, Bland et al. 2024, https://doi.org/10.5066/P13CPYYU, 5.4 GB zip). It was not used.

## Mineral / geology layer

Not added yet. When added it will be labelled "approximate, derived from published unit maps" (Stack et al. 2020; Horgan et al. 2020).

## Mars constants

Gravity 3.71 m/s2, mean solar day 24 h 39 m 35.244 s, obliquity 25.19 deg, Jezero latitude 18.4446 N. Values are in `src/sim/constants.ts`.
