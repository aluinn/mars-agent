# Roadmap

Where the project is going. Nothing here is a promise or a schedule; it is an honest list of what would make the simulation more real or more useful, roughly in order. Items marked with an issue draft in [docs/issues/](docs/issues/) are scoped and ready to pick up.

## Now (the weak spots)

- **Better mineral detection.** The terrain classifier is near chance on basalt, olivine, clay and delta sediment ([docs/PERCEPTION.md](docs/PERCEPTION.md)). Two routes: stronger models and features on the same data, and more realistic data (below).
- **Real mineral maps.** Replace the assumed unit-to-mineral mapping with per-pixel mineral indices from CRISM-based orbital maps (Horgan et al. 2020).
- **Detector off the main thread.** The detector takes about 85 ms per frame and causes a visible hitch each time the rover takes an image ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)). Move it to a Web Worker.

## Next

- **LLM planner.** The `Planner` interface already allows asynchronous decisions. Add an implementation that calls a model through a Vercel serverless function (keys stay server-side; see [SECURITY.md](SECURITY.md)) and compare it with the rule and utility planner on the same scenarios.
- **A second landing site.** The data scripts take a window centre; add a site selector and the data for another site. Candidates with carbonate units would exercise the carbonate class, which never occurs in the current patch.
- **Real orbiter geometry.** Replace the two fixed daily relay passes with overpass times derived from orbiter orbits.
- **Multi-sol history in Mission Control.** The timeline shows one sol; add a strip across sols.

## Later

- **Rover-scale rocks from real data.** Rock positions and sizes are synthetic. Use HiRISE-derived rock counts or boulder inventories for the landing region.
- **Two-way link.** Commands from Earth (with the same delay) so a human can approve science goals.
- **Dynamic dust.** Dust storms that change opacity over sols, with the agent adapting its plans.
- **Higher-resolution camera model.** Render at the native 1600 x 1200 and add zoom, multispectral filters and pan/tilt scheduling.
- **Learning from the downlink.** Let Earth-side feedback (confirmed or rejected detections) update the detector.

## Out of scope

Real mission operations, anything claiming to detect life, and a backend server. The site is static by design.
