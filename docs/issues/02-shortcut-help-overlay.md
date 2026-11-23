---
title: "Add a keyboard-shortcut help overlay"
labels: ["good first issue"]
---

## Context

The app has keyboard shortcuts (Space, 1-5, O/F, C, P, H, E) but they are only listed in a small hint line at the bottom of the screen, which is hidden on narrow windows.

## Task

Pressing `?` (or `Shift+/`) toggles a small overlay card listing every shortcut and what it does. Pressing `Escape` or `?` again closes it. Build it in the same glass style as the other cards.

## Acceptance

- The overlay lists all current shortcuts and is generated from one list so it cannot drift from the real key handlers.
- It does not steal key presses while a slider has focus.
- It is keyboard and screen-reader friendly (focus moves in and out, `role="dialog"`, labelled).
- The e2e smoke test still passes.

## Pointers

- `src/main.ts` (the `keydown` listener)
- `index.html` (`#hints`)
- `src/style.css` (`.card`, `.panel` styles)
- Other panels that register their own key handlers: `src/ui/perceptionPanel.ts`, `habitabilityPanel.ts`, `earthPanel.ts`
