---
title: "Add a second landing site"
labels: ["enhancement"]
---

## Context

The simulation covers one 2 x 2 km window of Jezero (centre 18.4568 N, 77.4240 E). The window is set by two constants in `scripts/prepare_hirise.py` and the outputs are fixed filenames in `public/data/`. A second site, especially one with a carbonate unit (the current patch has none), would exercise the carbonate class and show the agent working somewhere new.

## Task

Parameterise the data scripts by site, generate a second site's data, and add a site selector.

1. Make `LAT_C`, `LON_C` and the output prefix arguments of `prepare_hirise.py`, `prepare_ortho.py` and `prepare_units.py`.
2. Choose a site covered by both the 1 m HiRISE DTM and the Stack et al. (2020) map (for example a window including the Margin unit near the crater rim) and generate its files under `public/data/<site>/`.
3. Let `loadWorld` take a site name and add a selector in the top bar.
4. Retrain the detector for the site (or document why the existing model is reused) and re-run `npm run train`.

## Acceptance

- Both sites load and run; switching sites resets the simulation cleanly.
- `docs/DATA_SOURCES.md` records the new window, its extent, relief and slope statistics, and any new licence concerns.
- The new site includes carbonate-bearing ground, and the Perception panel shows a row for it.
- Unit tests and the e2e test pass for the default site.

## Pointers

- `scripts/prepare_hirise.py` (`LAT_C`, `LON_C`), `scripts/prepare_ortho.py`, `scripts/prepare_units.py`
- `src/world/world.ts` (`loadWorld`)
- `src/sim/simulation.ts` (`LANDING`, `findStart`)
- `src/world/classes.ts` (`BEDROCK_CLASS`)
- `docs/DATA_SOURCES.md`
