---
title: "Export the habitability evidence log as JSON"
labels: ["good first issue"]
---

## Context

The habitability card shows a verdict, findings and an evidence log, but there is no way to take the data out of the page for analysis.

## Task

Add an "Export" button to the habitability card that downloads a JSON file containing the verdict (headline, score, findings with precision and sightings), the negative factors, and the evidence log. Include the app version, the dust opacity and local time the verdict was computed at, and a note that mineral classes are assumed.

## Acceptance

- The file downloads with a clear name such as `habitability-sol-<n>.json`.
- It contains no ground-truth information (only what the agent detected).
- A unit test checks the exported object's shape (build it in a pure function next to `HabitabilityMap`).

## Pointers

- `src/habitability/model.ts` (`HabitabilityMap.verdict`, `log`)
- `src/ui/habitabilityPanel.ts`
- `index.html` (`#habCard`)
