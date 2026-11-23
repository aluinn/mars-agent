# Perception

How the rover sees: the camera model, the hidden ground-truth pass, the detector, how confidence is computed, and how well it works. Everything here is verified against the code or measured; the numbers come from `docs/perception_eval.json`, produced by `npm run train`.

**Short version.** The agent only ever receives an RGB image and a metric depth image. A second, hidden render of the same view gives every pixel its true object, which is used only to score the agent. The detector is imperfect by design and by data: it is decent at slope hazards and loose sand, weak at telling mineral classes apart, and its confidence is capped below 100%.

## Camera model

`src/perception/types.ts` (`MASTCAM`) and `src/perception/mastCamera.ts`.

| Property | Value | Basis |
| --- | --- | --- |
| Field of view | 25.4 x 19.2 degrees (19.2 vertical, 4:3) | Mastcam-Z widest zoom is 25.6 x 19.2 degrees (Bell et al. 2021); our 4:3 render gives 25.4 horizontally |
| Rendered resolution | 640 x 480 | Real detector is 1600 x 1200 active pixels; we render at 2.5x downsampling for speed, so one pixel covers about 0.71 mrad (native 0.283 mrad) |
| Range | 1500 m | Rendering and depth limit |
| Height above ground | 2.1 m | Approximate mast height (assumed) |
| Sensor noise | 2.5 grey levels (1 sigma), Gaussian | Assumed |
| Near-field blind zone | about 9 m | Camera tilts 4 degrees down with a 9.6 degree half field of view, so the ground is not visible inside roughly 2.1 / tan(13.6 degrees) |

Each capture renders the scene three times into offscreen targets, then reads them back:

1. **Colour.** Linear HDR (float) with 4x MSAA, as lit by the sun, sky and dust haze. It is tone-mapped to 8-bit sRGB on the CPU with the same ACES curve the on-screen view uses (`src/render/tone.ts`), so the camera image matches what you see.
2. **Depth.** Metric depth along the optical axis, packed into 24 bits across the RGB channels with no blending, so values are exact. Pixels with no surface within range are `Infinity`.
3. **Ground-truth IDs.** Every terrain patch and every rock is drawn in a unique flat colour with no lighting, fog or antialiasing, so each pixel decodes to exactly one object.

The rover itself and the path line are hidden from all passes; the sky dome appears only in the colour pass.

## Keeping the agent honest

`src/perception/types.ts` defines two separate types:

- `AgentFrame` is the image plus depth plus metadata the agent legitimately knows (pose, time, sun elevation, dust opacity). The agent and planner only ever see this.
- `TruthFrame` is the per-pixel object IDs and a lookup to classes. Only `src/perception/scoring.ts`, the dev `lab.ts` harness and the UI import it.

Outside the real data patch the renderer shows 8 mirrored copies of the terrain so the horizon has no edge. Those pixels report ID 0 ("unknown") in the truth pass and are never scored.

## Ground-truth classes

12 classes are detected (`src/world/classes.ts`). Terrain classes come from the Stack et al. (2020) map units plus slope, crater and drainage analysis of the DEM; mineral associations for clay-rich, olivine-rich, basalt and carbonate-bearing are **assumed** (see `docs/DATA_SOURCES.md`). Boulders and cobbles are synthetic scene rocks. Carbonate-bearing rock is defined but never occurs in this 2 km patch, so the trained model has no carbonate class.

## Detector

`src/perception/features.ts`, `detector.ts`.

### Terrain regions (trained classifier)

1. The image is split into 8 x 8 pixel tiles (80 x 60 tiles).
2. Each fully valid tile gets 12 features: haze-corrected chromaticity (2), log brightness relative to the frame median, texture, coarse-scale texture, slope and roughness from a plane fitted to the tile's 3D points, log range, and the 3x3 neighbourhood mean of chromaticity, texture and slope.
3. **Haze correction.** Distant ground is tinted by dust haze. The camera is rendered with exponential-squared fog, so the detector undoes `obs = (1 - f) * true + f * sky` with `f = 1 - exp(-(density * range)^2)` and `density = 0.00025 + 0.00035 * tau`. The sky colour is measured from the frame's own sky pixels just above the horizon. Correction is clamped at f = 0.75.
4. A **Gaussian naive Bayes** classifier gives a posterior per tile, calibrated with a temperature fitted on held-out data (T = 4.887). A 3x3 modal filter removes speckle, connected tiles of one class become a region (at least 6 tiles), and each region is located on the ground from its tiles' ranges.

**Why this approach rather than hand-tuned thresholds.** A threshold such as "olivine is more green" would have been my guess about a synthetic world. Training on labelled frames makes the accuracy measurable and honest, and the same script re-trains whenever the scene changes.

### Rocks (geometry, not learned)

Boulders and cobbles are found from depth. The 3D height of each pixel is compared to its local ground using a morphological **top-hat** (height minus its opening) with a window up to about 4 m wide (capped at close range by the image size), at four depth bands because pixel size grows with range. Compact bumps of 0.07 to 1.6 m height and 0.1 to 3.2 m width are kept. Width is computed physically from pixel size and range; 0.8 m or wider is a boulder, otherwise a cobble. A "darker than its surroundings" cue lowers the score of bright ripples. Early versions used a mean-based residual, which was swamped by ordinary terrain undulation and found almost nothing; the top-hat fixed it.

### Confidence

`confidence = min(0.97, raw x range x sun x haze x occlusion)` (`visibility` and `combine` in `detector.ts`), where `raw` is the classifier posterior or, for rocks, a size and contrast score.

| Factor | Formula | Effect |
| --- | --- | --- |
| range | `1 / (1 + (range / 350)^2)` | 0.5 at 350 m |
| sun | `clamp(0.35 + 0.65 sin(elevation) / sin(35 deg), 0.3, 1)` | about 0.45 at 5 degrees, full above about 35 |
| haze | `exp(-0.0006 x tau x range)` | dust and distance |
| occlusion | `1 - 0.5 x (fraction cut by edges or depth jumps)` | up to a 50% penalty |

These factors are assumptions chosen to behave plausibly; unit tests check that each one moves confidence in the right direction and that confidence is never 100%.

## Evaluation

Protocol (`scripts/train_detector.mjs`): the 2 km patch is a checkerboard of 400 m blocks. The classifier trains on 150 frames from even blocks (39,627 tiles). The temperature is fitted on 40 frames from odd blocks (10,030 tiles). The full detector is then evaluated on **60 separate frames from odd blocks** at random positions, headings, times of day (sun above about 10 degrees) and dust levels (tau 0.3 to 2.5). Scoring (`scoring.ts`):

- A terrain detection is correct if at least half of the tiles it covers carry its class in the truth; a truth region (4-connected same-class tiles, at least 6) counts as found if at least 40% of it is labelled with the right class.
- A rock detection is correct if its box overlaps a truth rock (visible in at least 20 pixels) with IoU of at least 0.2 and it has the right size class.

**Held-out tile accuracy: 33.1%** over the calibration tiles. Per class:

| Class | Held-out tile accuracy |
| --- | --- |
| regolith | 41% |
| basalt | 28% |
| olivine-rich rock | 9% |
| layered delta sediment | 20% |
| clay-rich outcrop | 26% |
| sand ripples/dunes | 0% |
| possible dried channel | 67% |
| crater | 28% |
| hazard: steep slope | 97% |
| hazard: loose sand | 22% |

**Full detector, 60 held-out frames, 1,433 detections:**

| Class | Precision | Recall | Correct / detections | Found / visible |
| --- | --- | --- | --- | --- |
| regolith | 36% | 34% | 66 / 185 | 22 / 65 |
| basalt | 2% | 15% | 3 / 120 | 2 / 13 |
| olivine-rich rock | 37% | 6% | 29 / 79 | 2 / 31 |
| layered delta sediment | 15% | 50% | 13 / 85 | 5 / 10 |
| clay-rich outcrop | 46% | 16% | 18 / 39 | 4 / 25 |
| sand ripples/dunes | 2% | 43% | 1 / 41 | 3 / 7 |
| boulder | 28% | 12% | 24 / 87 | 24 / 206 |
| cobbles | 30% | 23% | 18 / 61 | 18 / 77 |
| possible dried channel | 3% | 50% | 7 / 202 | 9 / 18 |
| crater | 1% | 50% | 1 / 163 | 2 / 4 |
| hazard: steep slope | 42% | 91% | 23 / 55 | 32 / 35 |
| hazard: loose sand | 63% | 32% | 168 / 265 | 19 / 59 |

**Confidence versus accuracy** (judged detections only):

| Confidence bin | Detections | Mean confidence | Actually correct |
| --- | --- | --- | --- |
| 0-10% | 222 | 5% | 26% |
| 10-20% | 596 | 16% | 29% |
| 20-30% | 460 | 24% | 21% |
| 30-40% | 62 | 34% | 47% |
| 40-50% | 5 | 44% | 20% |
| 50-60% | 15 | 54% | 40% |
| 60-70% | 6 | 65% | 83% |
| 70-80% | 5 | 72% | 20% |
| 80-90% | 8 | 85% | 25% |
| 90-100% | 3 | 93% | 0% |

### Reading these results honestly

- **It works best for geometric classes.** Steep slope has 91% recall (42% precision) and loose sand 63% precision (32% recall); slope from depth and brightness separate them.
- **Mineral classes are weak.** Basalt, olivine, clay, delta sediment, crater and ripples are near chance. I tried one improvement round (haze correction, context and coarse-texture features). Overall tile accuracy did not change (34.8% before, 33.1% after); some classes improved and regolith got worse. The limit is the data, not the tuning: class colours in the synthetic scene are subtle on purpose so the real orthoimage dominates, and RGB imagery cannot separate minerals. Real rovers use multispectral data for this.
- **Confidence is only roughly calibrated.** Low bins (0 to 30%) are about 25% correct, which is reasonable. Above 50% there are only about 40 detections in total, too few to trust, and the 90 to 100% bin was never correct (3 of 3 wrong).
- **Rocks have low recall** (12% of boulders, 23% of cobbles). Many truth rocks are small, far or partly hidden.

## Limits and caveats

- **Circular labels.** The detector is trained and tested on the simulator's own labels, so it measures how separable the synthetic classes are, not how it would do on real Mars imagery.
- **Spatial leakage.** Odd blocks sit next to training blocks, so test frames are not fully independent of training areas.
- **Small evaluation.** 60 frames; per-class counts are small, especially for crater (4 truth regions) and ripples (7).
- **Priors.** Class priors in the trained model are proportional to the square root of the training counts; that is a modelling choice, not a measurement of Jezero.
- **Runs on the main thread.** The detector takes about 85 ms per frame (see `docs/PERFORMANCE.md`), which is visible as a hitch each time the rover takes an image.
