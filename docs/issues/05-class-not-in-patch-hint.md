---
title: "Mark classes that do not occur in the patch in the Perception panel"
labels: ["good first issue"]
---

## Context

Carbonate-bearing rock is a defined class, but it never occurs in the 2 km patch (no carbonate unit falls inside it), so the detector has no carbonate model and the Perception panel never shows a row for it. A reader could wonder whether it is broken.

## Task

Show a muted footnote row in the Perception panel listing classes that exist in `CLASS_INFO` but have no training data or no truth in the current patch, with a one-line reason ("not present in this 2 km patch").

## Acceptance

- The footnote appears and names carbonate-bearing rock.
- The list is computed from the loaded model and the geology (not hard-coded), so it adapts if a second site is added.
- No change to scoring.

## Pointers

- `src/ui/perceptionPanel.ts`
- `src/world/classes.ts` (`CLASS_INFO`)
- `public/data/detector_model.json` (the classes it contains)
- `src/world/geology.ts` (`Geology.classMap`)
