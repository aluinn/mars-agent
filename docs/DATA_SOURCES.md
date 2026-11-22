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

## Geology: Stack et al. (2020) photogeologic map (real polygons, assumed minerals)

| Field | Value |
| --- | --- |
| Product | Photogeologic Map of the Perseverance Rover Field Site in Jezero Crater, Constructed by the Mars 2020 Science Team (supplementary shapefile `M2020_JEZ_geology_edited_equi0_allquads_v6_archive`) |
| Reference | Stack, K.M. et al., 2020, Space Science Reviews 216, https://doi.org/10.1007/s11214-020-00739-x |
| File | https://authors.library.caltech.edu/records/a7qs5-xhq84 (`11214_2020_739_MOESM3_ESM.zip`, 3.5 MB). Mapped at 1:5000 on the 25 cm HiRISE basemap and 1 m HiRISE DTM. |
| Attributes | `SurfUName` (surface unit), `BedrkUName` (bedrock unit) |
| Projection | Mars 2000 sphere, equidistant cylindrical, standard parallel 0 |
| Licence | Not stated in the supplement; it accompanies a journal article. Cite the authors. Check the publisher's terms before redistributing the raw shapefile (we commit only our rasterisation). |

`scripts/prepare_units.py` rasterises the polygons onto the same 1024 x 1024 grid as the heightmap into `public/data/jezero_units.png` (R = bedrock unit id, G = surface unit id) with the legend in `jezero_units.json`. 1,048,539 of 1,048,576 pixels (99.996%) fall inside mapped polygons.

We checked the registration against the DEM: the delta polygons sit on the high ground (mean -2455 m for "Delta blocky") and the crater-floor polygons on the low ground (mean -2557 m for "Crater floor fractured 1"), and the delta polygon edge follows the real scarp.

Units present in the 5 km patch (pixels of 1,048,576): bedrock "Delta blocky" 303k, "Crater floor fractured rough" 305k, "Crater floor fractured 1" 153k, "Delta truncated curvilinear layered" 136k, "Crater floor fractured 2" 108k, "Delta thinly layered" 36k, "Delta thickly layered" 6k, "Margin fractured" 648. Surface: "Undifferentiated smooth" 295k, "Aeolian bedforms, large" 251k, "Minor Cover Us" 68k, "Talus" 32k, "Moderate Cover Us" 27k, "Aeolian bedforms, small" 9k, none 366k.

### How map units become detection classes (`src/world/classes.ts`)

Priority per pixel: steep slope (> 25 deg, from the DEM) > crater (DEM) > possible channel (DEM) > surface unit > bedrock unit.

| Class | Source | Status |
| --- | --- | --- |
| hazard: steep slope | DEM slope > 25 deg | real (derived from the DEM) |
| crater | closed depression at least 5 m deep and about 3.8 ha, from priority-flood fill of the DEM | real (derived; at 20 m posting only large craters survive, one in this patch) |
| possible dried channel | D8 flow accumulation on the filled DEM >= 350 cells, slope < 12 deg | **speculative**: present-day drainage lines, NOT mapped palaeochannels. Neretva Vallis is not inside the patch |
| hazard: loose sand | surface unit "Aeolian bedforms, large" | real unit, interpretation as hazard is ours |
| sand ripples/dunes | surface unit "Aeolian bedforms, small" | real unit |
| regolith | surface units "Undifferentiated smooth", "Moderate Cover Us", "Talus" | real units, merged |
| layered delta sediment | bedrock "Delta thinly layered", "Delta thickly layered", "Delta truncated curvilinear layered" | real (unit names say sedimentary layering) |
| clay-rich outcrop | bedrock "Delta blocky", "Delta layered rough" | **assumed** mineral association |
| olivine-rich rock | bedrock "Crater floor fractured 1" | **assumed** mineral association |
| basalt | bedrock "Crater floor fractured 2", "Crater floor fractured rough" | **assumed** mineral association |
| carbonate-bearing rock | bedrock "Margin fractured", "Crater rim *" | **assumed**; almost absent from this patch (648 px) |

**The map units themselves do not carry mineral labels.** The mineral columns above are approximate, derived from published unit maps and general knowledge of Jezero mineralogy (Horgan et al. 2020 for orbital detections), and they have NOT been verified against per-pixel spectral data. A future improvement is to replace them with CRISM-derived mineral indices (see ROADMAP). Habitability results that depend on these classes inherit that uncertainty.

### What is synthetic

- Rock positions and sizes (4,000 rocks, seeded). Density rises with slope and in talus and falls on sand. Rock colour follows the class of the bedrock unit beneath it.
- The terrain texture: each class has a typical colour (`CLASS_INFO`), with +-6% per-texel variation and elevation-contour banding on delta units. It is not an orbital image.
- The camera noise (Gaussian, 2.5 grey levels).

## Mars constants

Gravity 3.71 m/s2, mean solar day 24 h 39 m 35.244 s, obliquity 25.19 deg, Jezero latitude 18.4446 N. Values are in `src/sim/constants.ts`.
