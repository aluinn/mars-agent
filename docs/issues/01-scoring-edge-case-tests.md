---
title: "Add unit tests for scoring edge cases"
labels: ["good first issue"]
---

## Context

`scoreFrame` in `src/perception/scoring.ts` judges every detection against the hidden ground truth and feeds the precision/recall panel. It has tests for the happy paths (a correct terrain region, a wrong class, per-class accumulation) in `tests/detector.test.ts`, but several rules in it have no test.

## Task

Add tests, in the style of the existing `scoring` block in `tests/detector.test.ts`, for these rules:

- A rock detection that overlaps a truth rock but has the **wrong size class** (boulder versus cobble) is a false positive and the truth rock is **not** counted as found.
- A detection that overlaps nothing is a false positive.
- Truth rocks visible in fewer than 20 pixels are ignored (they appear in neither found nor missed).
- Pixels with truth ID 0 (sky and the mirrored filler terrain) never count toward a terrain region.
- Two detections competing for one truth rock: only the higher-confidence one matches.

## Acceptance

- New tests pass with `npm test` and fail if the matching rule in `scoring.ts` is changed.
- No changes to production code are needed. If you find a rule that behaves differently from the docs, open a separate issue.

## Pointers

- `src/perception/scoring.ts` (`scoreFrame`, `iou`, constants `MIN_TRUTH_ROCK_PX`, `IOU_MIN`)
- `tests/detector.test.ts` (`syntheticFrame` builds a scene with known geometry)
