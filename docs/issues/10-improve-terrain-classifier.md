---
title: "Improve the terrain classifier beyond naive Bayes"
labels: ["enhancement"]
---

## Context

The terrain classifier is a Gaussian naive Bayes over 12 tile features. On held-out frames overall tile accuracy is about 33% and basalt, olivine, clay, delta sediment, crater and ripples are near chance (`docs/PERCEPTION.md`). One round of feature work did not move the overall number.

## Task

Try a stronger model and richer features, and keep whatever demonstrably helps.

Ideas: a small multilayer perceptron or gradient-boosted trees written in plain TypeScript (do not add a machine-learning dependency without asking first), multi-scale texture and gradient-orientation features for bedding and ripples, using neighbouring tiles' predictions, more training frames, or class-balanced loss.

Keep the protocol in `scripts/train_detector.mjs` (even blocks train, odd blocks calibrate and evaluate) so numbers are comparable. If you change the model format, update `classifyTile` and the model loader together.

## Acceptance

- Held-out overall tile accuracy improves by at least 5 points over the 33.1% baseline, **or** several named classes improve with the trade-offs written down.
- The new model runs within the per-frame budget in `docs/PERFORMANCE.md` (report the detector time).
- `public/data/detector_model.json`, `docs/perception_eval.json` and `docs/PERCEPTION.md` are updated together, with before and after tables.
- Unit tests cover the new classifier code.

## Pointers

- `scripts/train_detector.mjs`
- `src/perception/detector.ts` (`classifyTile`, `DetectorModel`)
- `src/perception/features.ts` (`extractTiles`, `FEATURES`)
- `src/perception/lab.ts` (`collect`, `evaluate`)
- `docs/PERCEPTION.md`
