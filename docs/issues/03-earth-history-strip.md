---
title: "Show images received per sol in Mission Control"
labels: ["good first issue"]
---

## Context

The Mission Control timeline shows only the current sol. After several sols there is no way to see how much data reached Earth on earlier sols.

## Task

Add a compact strip under the timeline: one bar per sol for the last 10 sols, with the height showing images received that sol (and a different shade for notes). Hovering a bar shows the exact counts.

## Acceptance

- The strip updates as items arrive and shows correct counts across a sol boundary.
- Counting uses `LinkItem.createdSol` or the arrival time, and the choice is stated in a comment.
- A unit test covers the counting function (extract it from the panel so it can be tested without the DOM).

## Pointers

- `src/ui/earthPanel.ts` (`timeline`, where the canvases are drawn)
- `src/earth/link.ts` (`EarthLink.received`, `LinkItem`)
- `index.html` (the `#earthCard` section)
