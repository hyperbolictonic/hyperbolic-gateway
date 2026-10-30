# Deck orb redesign

The Cyberdeck panel's collapsed state used to be a small "◧" handle pinned to
the top-right of the page. The deck now collapses to a free-floating **orb**
chip, animated by real bounds choreography, with a radial petal menu planned
as the next stage.

## Architecture

The deck is one native `WebContentsView` whose bounds change shape with the
mode. The three states are three bound shapes plus DOM states inside the view:

| Mode | View bounds | DOM |
| --- | --- | --- |
| Floating/docked | full-height panel column, 420px | `#sidebar-panel` (reveal animation on expand) |
| Collapsed | 56x56 chip at the bottom-right, clear of the page scrollbar | `#sidebar-rail-toggle`, a circular glass chip |
| Hidden | 0x0 | - |

A collapsed native view must be *exactly* the chip's rectangle: a transparent
view would otherwise swallow clicks meant for the page.

Transitions are animated by the main process (`animateSidebarBounds`,
ease-out cubic, 240ms, `SIDEBAR_TRANSITION_MS`), in lockstep with the panel's
CSS reveal (`deck-panel-in`) and the chip entrance (`deck-orb-in`). Any snap
(window resize, visibility change) cancels a running animation.

Skips animation on repeated mode calls, initial layout and visibility changes;
animates only genuine mode transitions.

## Coordinate rules

Child-view bounds are relative to the window **content** area (excluding the
title bar and menu). Always compute from `getContentSize()`, not `getSize()`
— the outer size overshoots the page area by the chrome height, leaving the
bottom of views clipped (or the chip pushed almost fully offscreen).

## Status

- [x] Phase 1 — orb chip + bounds choreography (`40f8ec4`): floating ⇆ collapsed
      verified live; minimise collapses to the orb, clicking it re-expands.
- [x] Pre-existing fix — content-size bounds (same commit).
- [x] Phase 2 — radial petal menu (`523732d`): Deck, Note, Collab, Harvest, Rec;
      staggered spring fan-out, actions reuse the existing handlers.
- [x] Phase 3 — status duty on the orb (`523732d`): collab count dot, amber
      human-takeover pulse, red recording pulse (all surfaces get broadcasts).
- [x] Phase 4 — orb drag with magnetic edge docking and persistence (`523732d`).
- [x] Compositing fix — `invalidate()` after bounds shrink: a transparent view
      kept ghost pixels of its previous frame behind the chip (same commit).
