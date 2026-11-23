# Performance

Measured, not estimated. Every number below comes from `scripts/benchmark.mjs`, which drives the real app in a headless browser and writes its raw results to `docs/performance_runs/`.

## Machine

| | |
| --- | --- |
| CPU / memory | Apple M1 Pro, 8 cores, 16 GB |
| OS | Darwin 24.6.0 (macOS 15) |
| Node | v24.20.0 |
| Browser / GPU | Chromium (Playwright) through ANGLE/Metal on the **Apple M1 Pro** GPU |
| Viewport | 1600 x 900, device pixel ratio 1 |
| Scenario | simulation running at 600x, main view + chase camera + HUD + minimap, the rover driving and taking its own images |

This was my everyday laptop, not an idle benchmarking machine: other apps were running (Creative Cloud, Word and the usual system services were visible in the process list). One early run, taken while those were busy, was about four times slower and was discarded; the lesson is that **frame times are sensitive to background load**, so I ran the benchmark three times and report all three and their spread instead of one best run.

## Results (3 runs on the GPU)

| Metric | Run 1 | Run 2 | Run 3 | Range |
| --- | --- | --- | --- | --- |
| Frame time, median (ms) | 16.7 | 16.7 | 16.7 | 16.7 to 16.7 |
| Frame time, mean (ms) | 23.0 | 22.7 | 22.3 | 22.3 to 23.0 |
| Frame time, 95th percentile (ms) | 16.8 | 16.8 | 16.8 | 16.8 to 16.8 |
| Frame time, 99th percentile (ms) | 166.7 | 150.0 | 166.6 | 150.0 to 166.7 |
| Same, image requests suppressed: mean (ms) | 16.7 | 16.7 | 16.7 | 16.7 to 16.7 |
| Same, image requests suppressed: 99th percentile (ms) | 16.8 | 16.8 | 16.8 | 16.8 to 16.8 |
| Camera capture, 3 passes + readback (ms) | 46.7 | 47.1 | 46.9 | 46.7 to 47.1 |
| Detector per frame (ms) | 85.1 | 85.5 | 86.1 | 85.1 to 86.1 |
| A* mean, no boulders known (ms) | 5.9 | 5.8 | 5.9 | 5.8 to 5.9 |
| A* 95th percentile, no boulders known (ms) | 37.5 | 37.9 | 37.0 | 37.0 to 37.9 |
| A* mean, all boulders known (ms) | 4.6 | 4.7 | 4.8 | 4.6 to 4.8 |
| Page ready (ms) | 1680 | 1574 | 1570 | 1570 to 1680 |

A* figures are over 60 searches of 100 to 600 m on the 1024 x 1024 grid (53/60 found with no boulders known, 52/60 with all boulders known; about 21996 and 18136 nodes expanded on average). The searches that fail (goal on a steep or blocked cell) explore the most nodes and account for the long tail. The detector figure is over 24 held-out frames per run.

### What this says

- **Rendering is fine on a real GPU.** With image requests suppressed the frame time is a steady 16.7 ms (60 fps, vsync-limited) and even the 99th percentile is 16.8 ms. The scene is about 2.35 million triangles (the 1024 x 1024 terrain patch is 2.09 million; the eight mirrored filler tiles add 0.26 million), with a 4096 x 4096 shadow map.
- **Taking an image causes a visible hitch.** In the normal run the median is still 16.7 ms but the mean rises to about 22 to 23 ms and the 99th percentile to 150 to 167 ms. The control run isolates the cause: suppress the agent's image requests and the hitches disappear. A capture costs about 47 ms (three renders and the readback) and the detector another 85 ms, both on the main thread, which fits the size of the spikes. Moving the detector to a Web Worker is [a drafted issue](issues/08-detector-web-worker.md).
- **Path finding is cheap.** About 6 ms on average for a 100 to 600 m route; 5 ms when the rover already knows every boulder (it expanded fewer nodes on average; I did not investigate why). The slowest searches reach about 60 ms.

## Software rendering (no GPU), the worst case

Same machine, Chromium with the SwiftShader software renderer (WebGL renderer string: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)`), one run of 60 frames:

| Metric | Value |
| --- | --- |
| Frame time, mean / median / 95th percentile | 3306 / 3100 / 14399 ms |
| Camera capture | 1590 ms |
| Detector per frame | 85.5 ms |
| A* mean | 5.9 ms |
| Page ready | 4968 ms |

Without a GPU the app is not interactive (about 0.3 fps), which is why the README says you need one. The CPU-bound parts (detector, A*) are almost identical to the GPU run, which is a useful cross-check that the GPU run is not hiding anything. The end-to-end test in CI runs on this software path and still passes because it does not depend on frame rate.

## How to reproduce

```bash
npm ci
npm run build
npx vite preview --port 4173 --strictPort     # leave running in one terminal
# in another terminal:
node scripts/benchmark.mjs --gpu metal --frames 400 --out docs/performance_runs/gpu-1.json
node scripts/benchmark.mjs --gpu swiftshader --frames 90 --out docs/performance_runs/software-1.json
```

`--gpu metal` uses the machine's GPU through ANGLE/Metal on macOS; use `--gpu swiftshader` on machines without one. Each run prints the WebGL renderer string and records it in the JSON, so you can see which path was used. Quit heavy apps first and run it a few times; expect spread.

## What is not measured

- Memory use (not recorded).
- Other GPUs or browsers; Windows and Linux.
- Long runs (many sols): a 12-sol simulation without rendering or cameras takes about 2 seconds in the browser, but I have not profiled hours of real-time play.
