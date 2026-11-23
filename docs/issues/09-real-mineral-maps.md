---
title: "Replace the assumed unit-to-mineral mapping with real mineral data"
labels: ["enhancement"]
---

## Context

The Stack et al. (2020) map has bedrock and surface units but no mineral labels. `BEDROCK_CLASS` in `src/world/classes.ts` turns units into clay-rich, olivine-rich, basalt and carbonate-bearing classes using an **assumed** association, and every place that uses those classes says so. That is the weakest scientific link in the project, and the habitability assessment inherits it.

## Task

Derive mineral classes from orbital spectral data instead of from unit names. The CRISM-based mineral mapping of the Jezero region (Horgan et al. 2020) is the natural source.

1. Find the data product, record its source, product ID, resolution and licence in `docs/DATA_SOURCES.md`, and download only the window you need.
2. Write a `scripts/prepare_minerals.py` that rasterises per-pixel mineral indices onto the 1024 x 1024 grid.
3. Use them in `buildGeology` in place of `BEDROCK_CLASS` where data exist, keeping the unit-based mapping (clearly labelled) as the fallback.
4. Change the status of the affected classes from "assumed" to "real" only where the data justify it, and update the habitability card text.
5. Retrain the detector and report the before and after.

## Acceptance

- Mineral classes in the world come from the new data wherever it covers the patch.
- Docs and UI labels reflect which classes are now real and which are still assumed.
- `npm run train` results are re-recorded in `docs/perception_eval.json` and `docs/PERCEPTION.md`.
- Resolution mismatches (CRISM is much coarser than the 1.95 m grid) are documented honestly.

## Pointers

- `src/world/classes.ts` (`BEDROCK_CLASS`)
- `src/world/geology.ts` (`buildGeology`)
- `scripts/prepare_units.py`
- `src/habitability/rules.ts` (`assumedMapping` flags)
- `docs/DATA_SOURCES.md`
