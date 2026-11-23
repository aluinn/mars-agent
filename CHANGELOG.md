# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-23

First public version.

### Added

- **Real terrain.** A 2 x 2 km window of the 1 m HiRISE DTM of Jezero Crater (delta front, crater-floor edge, an isolated butte, megaripples), resampled to a 1024 x 1024 heightmap at true scale, textured with the matching 25 cm HiRISE orthoimage. Sources, projection and limits are in `docs/DATA_SOURCES.md`.
- **Geology.** The Stack et al. (2020) photogeologic map rasterised onto the grid, turned into detection classes with DEM-derived slope hazards, craters and possible channels. Mineral associations are flagged as assumed.
- **Mars lighting.** Sun elevation by local time, latitude and season; dust opacity (tau) dims and tints the scene; a butterscotch sky dome with a blue sunset halo; ACES tone mapping; cast shadows.
- **Rover agent.** Sense, detect, assess, decide, act, report loop. Slope-aware A* that refuses slopes over 20 degrees and avoids sensed boulders. Solar and battery energy model with night hibernation and sunset-aware planning. A pluggable `Planner` interface (synchronous or asynchronous) with a rule and utility implementation.
- **Perception.** A Mastcam-Z-like camera (25.4 x 19.2 degrees, 640 x 480, 1500 m range) rendering colour, metric depth and a hidden ground-truth ID pass. A detector for 12 classes (10 terrain classes from a trained classifier plus boulders and cobbles from depth; carbonate-bearing rock is defined but never occurs in this patch) with confidence that falls with range, low sun, dust and occlusion and is capped at 97 percent. Precision and recall per class against the hidden truth, a compare view, and a reliability table.
- **Habitability assessment.** Per-location scoring from detected evidence (past water, energy, shelter) discounted by measured detector precision and limited by perchlorates, UV, cold and instability. A verdict that says "evidence consistent with past habitable conditions" and never claims life. Evidence log and heatmap.
- **Earth link.** Relay passes with a small assumed data rate, a priority queue ranked by science value, a light-time delay model with a speed-up slider, rover notes, and a Mission Control screen with annotated received images and a timeline.
- **UI.** Mission-control interface with orbit and follow cameras, a chase-camera second screen, a minimap on the real orthoimage, keyboard shortcuts.
- **Quality gates.** 81 unit tests, an end-to-end smoke test, ESLint, CI, CodeQL, and weekly grouped Dependabot updates.

### Known limitations

- The terrain classifier is weak on mineral classes (about 33 percent held-out tile accuracy overall). See `docs/PERCEPTION.md`.
- Rocks are synthetic scene objects. The mineral mapping, energy parameters, data rates and surface temperature model are assumptions.

[Unreleased]: https://github.com/aluinn/mars-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aluinn/mars-agent/releases/tag/v0.1.0
