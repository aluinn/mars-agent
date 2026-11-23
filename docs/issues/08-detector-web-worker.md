---
title: "Run the detector in a Web Worker"
labels: ["enhancement"]
---

## Context

`npm run bench` shows the detector takes about 85 ms per frame on an Apple M1 Pro, and it runs on the main thread inside `Agent.receiveFrame`. Whenever the rover takes an image the page stalls: the 99th-percentile frame time is 150 to 167 ms against a median of 16.7 ms (see `docs/PERFORMANCE.md`).

## Task

Move `Detector.detect` to a Web Worker. The image and depth buffers can be transferred without copying. `Agent.receiveFrame` and `Agent.detect` become asynchronous: the agent records the frame, and applies detections (habitability, memory, notes, downlink priority) when the worker replies.

## Acceptance

- `npm run bench` before and after, with the numbers in your PR. Target: 99th-percentile frame time under 40 ms on the same machine.
- Detections for a given frame are identical to the current main-thread results (add a test comparing both on a synthetic frame).
- The scoring in `main.ts` still receives the matching detections for the matching truth frame (order is preserved).
- No new dependencies. Vite already supports module workers.

## Pointers

- `src/perception/detector.ts` and `features.ts` (pure CPU code; no DOM use)
- `src/agent/agent.ts` (`receiveFrame`, `detect`, `assess`)
- `src/main.ts` (the capture block that calls `scoreFrame` and `submitFrame`)
- `scripts/benchmark.mjs`, `docs/PERFORMANCE.md`
