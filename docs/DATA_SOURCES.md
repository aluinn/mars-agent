# Data sources

## Terrain: HiRISE DTM (real data, 1 m posting)

| Field | Value |
| --- | --- |
| Product | Mars 2020 Terrain Relative Navigation HiRISE DTM mosaic, `JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif` |
| Publisher | USGS Astrogeology Science Center with JPL (built from MRO HiRISE stereo pairs, tied to MOLA topography) |
| Download | https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif (1.84 GB; we read only our window over HTTP range requests, about 170 MB) |
| Also the base of | Stack et al. (2020), whose README names this exact file as the DTM used for the geologic map |
| Data release DOI | https://doi.org/10.5066/P9REJ9JN is the DOI USGS lists for the Mars 2020 TRN HiRISE DTM mosaic. We did not verify that the `soc_006` file is that exact release version |
| Native resolution | 1 m/pixel, 21,400 x 21,488 px, float32, metres |
| Projection | Equirectangular, Mars 2000 sphere (R = 3,396,190 m), **standard parallel 0**. East-west pixels therefore cover cos(lat) = 0.9486 m of ground; we resample to a uniform ground grid |
| Licence | **Not verified.** The USGS pages did not expose usage terms to automated requests. USGS Astrogeology products are generally US-Government works, but check before redistributing the raw file. We commit only our derived 1024 x 1024 crop |

### Our crop

- Centre 18.4568 N, 77.4240 E, 2 km x 2 km (2108 x 2000 source pixels), area-averaged to 1024 x 1024 at 1.953 m/px of ground.
- It contains the south-eastern lobe of the Jezero delta (a scarp up to 70 degrees steep), the crater-floor edge with megaripples, an isolated delta butte and several craters. The Perseverance landing site (18.4446 N, 77.4509 E) is about 2.1 km south-east of the patch.
- Elevation range -2574.7 m to -2460.3 m (114 m of relief). Slope on the 1.95 m grid: mean 5.2 deg, 95th percentile 17.8 deg, 99th percentile 28.9 deg.
- Output: `public/data/jezero_height_rg.png` (16-bit height packed into the R and G bytes because browsers decode 16-bit PNG to 8 bits) and `jezero_height_rg.json` (extent, CRS origin, provenance).
- Regenerate with `scripts/prepare_hirise.py` (needs numpy, rasterio and pillow; dev-time only).

### Terrain outside the patch

The renderer surrounds the real patch with 8 **mirrored** copies of it so the horizon has no edge. This is visual filler only: it carries no ground truth (the hidden ID pass reports "unknown" there), the rover never goes there, and it is never scored.

### Honest limits

- The heightmap is a 1.95 m grid area-averaged from 1 m data. Features smaller than a few metres (individual rocks, ripple crests) are not in the elevation data.
- Rocks, cobbles and other small objects in the simulation are synthetic scene objects placed on top of the real terrain. They are not mapped from imagery.
- The fine-scale "grain" in the terrain shader (value noise, fading out beyond about 250 m) is cosmetic detail, not elevation data.

## Terrain texture: HiRISE orthoimage (real data, 25 cm)

| Field | Value |
| --- | --- |
| Product | Mars 2020 TRN HiRISE orthorectified image mosaic, `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif` |
| Publisher | USGS Astrogeology Science Center with JPL (MRO HiRISE) |
| Download | https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif (7.4 GB; we read only our window over HTTP range requests, roughly 700 MB of reads estimated from the row size, not measured) |
| Format | 85,600 x 85,952 px, 8-bit greyscale (HiRISE red band), 0.25 m/px, same footprint and CRS as the DTM |
| Licence | **Not verified**, same status as the DTM. Check before redistributing the raw file |

`scripts/prepare_ortho.py` cuts the matching window and area-averages it to **4096 x 4096** (0.49 m per texel), saved as a greyscale JPEG at quality 90 (`public/data/jezero_ortho.jpg`, 3.2 MB).

What is real and what is not: the **brightness** of every texel is the real orbital image, so real boulders, ripples, bedding and shadows show through. The **colour** is synthetic, because the orthoimage is greyscale: each ground-truth class has a typical colour that is blended 75% toward it over the real luminance (`CLASS_TINT` in `src/terrain/terrainMesh.ts`). The orthoimage carries its own baked-in sun shading, which doubles up with the simulation's lighting in places.

The same image is the basemap of the minimap.

## Geology: Stack et al. (2020) photogeologic map (real polygons, assumed minerals)

| Field | Value |
| --- | --- |
| Product | Photogeologic Map of the Perseverance Rover Field Site in Jezero Crater, Constructed by the Mars 2020 Science Team (supplementary shapefile `M2020_JEZ_geology_edited_equi0_allquads_v6_archive`) |
| Reference | Stack, K.M. et al., 2020, Space Science Reviews 216, https://doi.org/10.1007/s11214-020-00739-x |
| File | https://authors.library.caltech.edu/records/a7qs5-xhq84 (`11214_2020_739_MOESM3_ESM.zip`, 3.5 MB). Mapped at 1:5000 on the 25 cm HiRISE basemap and 1 m HiRISE DTM. |
| Attributes | `SurfUName` (surface unit), `BedrkUName` (bedrock unit) |
| Projection | Mars 2000 sphere, equidistant cylindrical, standard parallel 0 |
| Licence | Not stated in the supplement; it accompanies a journal article. Cite the authors. Check the publisher's terms before redistributing the raw shapefile (we commit only our rasterisation). |

`scripts/prepare_units.py` rasterises the polygons onto the same 1024 x 1024 grid as the heightmap (the shapefile and the DTM share one CRS) into `public/data/jezero_units.png` (R = bedrock unit id, G = surface unit id) with the legend in `jezero_units.json`. 1,048,558 of 1,048,576 pixels (99.998%) fall inside mapped polygons.

We checked the registration against the DEM: the delta polygons sit on the high ground (mean -2455 m for "Delta blocky") and the crater-floor polygons on the low ground (mean -2557 m for "Crater floor fractured 1"), and the delta polygon edge follows the real scarp.

Units present in the 2 km patch (pixels of 1,048,576): bedrock "Crater floor fractured rough" 454k, "Crater floor fractured 1" 303k, "Delta blocky" 190k, "Delta truncated curvilinear layered" 77k, "Delta thinly layered" 20k, "Crater floor fractured 2" 5k. Surface: "Undifferentiated smooth" 370k, "Aeolian bedforms, large" 325k, none 216k, "Moderate Cover Us" 67k, "Talus" 50k, "Minor Cover Us" 12k, "Aeolian bedforms, small" 8k. No "Margin fractured" or crater-rim unit falls inside this patch, so **carbonate-bearing rock does not occur here at all**.

### How map units become detection classes (`src/world/classes.ts`)

Priority per pixel: steep slope (> 25 deg, from the DEM) > crater (DEM) > possible channel (DEM) > surface unit > bedrock unit.

| Class | Source | Status |
| --- | --- | --- |
| hazard: steep slope | DEM slope > 25 deg | real (derived from the DEM) |
| crater | closed depression at least 2 m deep and 1,500 m2, from priority-flood fill of the DEM | real (derived from the 1 m DTM) |
| possible dried channel | D8 catchment area on the filled DEM >= 130,000 m2, slope < 12 deg | **speculative**: present-day drainage lines, NOT mapped palaeochannels. Neretva Vallis is not inside the patch |
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

- Rock positions and sizes (8,000 rocks, seeded). Density rises with slope and in talus and falls on sand. Rock colour follows the class of the bedrock unit beneath it.
- The class tints: each class has a typical colour (`CLASS_INFO`), blended 55% toward regolith over the real orthoimage luminance. The luminance is real; the colour is synthetic (the orthoimage is greyscale).
- The camera noise (Gaussian, 2.5 grey levels).

## Mars constants

Gravity 3.71 m/s2, mean solar day 24 h 39 m 35.244 s, obliquity 25.19 deg, Jezero latitude 18.4446 N. Values are in `src/sim/constants.ts`.

## Detector training data (synthetic)

The terrain classifier is trained on frames rendered by this simulator, labelled by its own hidden ID pass, so it learns the appearance of the simulator's classes, not of real Mars imagery. The protocol, sample sizes and results are in `docs/PERCEPTION.md`; the trained model is `public/data/detector_model.json` and the per-class measurements are `public/data/perception_eval.json` (a copy of `docs/perception_eval.json`).

## Assumptions that are not data

These parameters are illustrative, set in code, and labelled as assumptions where they are used:

| Parameter | Where | Note |
| --- | --- | --- |
| Rover power: 1200 Wh battery, 1.3 m2 solar array at 25%, 35 W idle, 100 W driving, 20 W hibernating | `src/sim/energy.ts` | A hypothetical solar rover. Perseverance runs on a nuclear MMRTG. Mass (1025 kg) and gravity (3.71 m/s2) are real |
| Relay passes: two per sol, 9 minutes each, 2.5 kb/s | `src/earth/link.ts` | Deliberately small so the queue has to ration; real data rates are far higher |
| Radio draw 15 W while transmitting | `src/sim/simulation.ts` | Assumed |
| Light time: circular coplanar orbits, 4.4 to 21 min, 11.3 min at the start | `src/earth/lightTime.ts` | Simplified; the real range is roughly 3 to 22 min |
| Surface temperature: 228 K mean, 40 K swing damped by dust | `src/habitability/environment.ts` | Illustrative |
| Habitability rule weights and verdict thresholds | `src/habitability/rules.ts`, `model.ts` | Our choices from general astrobiology rationale, not measurements |
| Camera height 2.1 m, sensor noise 2.5 grey levels | `src/perception/types.ts` | Assumed (field of view and pixel scale are from Bell et al. 2021) |
