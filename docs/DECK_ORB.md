# Command Deck orb

The panel used to be called "Cyberdeck Panel" — it now goes by **Command
Deck**: a floating HUD for agent operations (telemetry, decisions, construct,
logs), styled in the deck theme. Its collapsed state used to be a small "◧"
handle pinned to the top-right of the page; the deck now collapses to a
free-floating **orb** chip, animated by real bounds choreography, with a
radial petal menu (Deck, Note, Collab, Harvest, Rec) growing out of it.

## Architecture

The deck is one native `WebContentsView` whose bounds change shape with the
mode. The three states are three bound shapes plus DOM states inside the view:

| Mode | View bounds | DOM |
| --- | --- | --- |
| Floating/docked | full-height panel column, 420px | `#sidebar-panel` (reveal animation on expand) |
| Collapsed | 84x84 view centring a 56px chip at a bottom corner, clear of the page scrollbar | `#sidebar-rail-toggle` — frosted circle + petals stage |
| Hidden | 0x0 | - |

The collapsed view is deliberately larger than the visible chip: hover scale,
the pulse rings (recording / human hand-off) and the collab count badge must
never clip at the view edge. The radial stage (404x404) keeps the same chip
corner fixed.

A transparent native view swallows clicks meant for the page, so native bounds
and DOM classes are kept in lockstep by construction:

- **Single source of truth.** Main owns `{ mode, menuOpen, orbEdge }`
  (`getSidebarSurfaceState`), reasserts bounds and broadcasts the whole state
  to every surface (`chassis:sidebar-state`). Renderers apply it verbatim
  (`applySidebarState`) — they never hold local truth.
- **Reload safety.** `sidebarView` `did-finish-load` re-asserts bounds and
  broadcasts the state; a page reload (HMR, devtools, navigation) can no
  longer strand a stale shape (the "stuck open" / dead-zone class of bugs).
- **Animation.** Main steps the bounds (`animateSidebarBounds`, ease-out
  cubic, 240ms, `SIDEBAR_TRANSITION_MS`) in lockstep with the panel's CSS
  reveal (`deck-panel-in`) and chip entrance (`deck-orb-in`). Snaps (window
  resize, visibility change, drag) cancel a running animation; genuine mode
  transitions animate.
- **Dispose.** After bounds shrink, `webContents.invalidate()` clears the
  transparent view's stale pixels (Windows ghost rectangle).

## Coordinate rules

Child-view bounds are relative to the window **content** area (excluding the
title bar and menu). Always compute from `getContentSize()`, not `getSize()`
— the outer size overshoots the page area by the chrome height, leaving the
bottom of views clipped (or the chip pushed almost fully offscreen).

## Themed menu components

- `MenuPopup` (`src/main/ui/menu-popup.ts`) is one shared frameless,
  transparent child window that renders **any** themed dropdown: it is
  anchored below a trigger rect, pushes `PopupMenuItem[]` to the popup surface
  (`src/renderer/menu-popup.ts`, `#menu-popup-host`) and resolves with the
  chosen id (null on Escape/blur/outside click). The header COLLAB menu and
  future menus all reuse it — a ripped native `Menu.popup` looked off-theme.
- The radial petal menu is data-driven markup (`#deck-menu`); petals reuse
  the same handlers as the toolbar via trusted event dispatch.
- Escape is the intuitive exit everywhere: radial menu (host), popup menu
  (dismiss), note picker (cancel), note drawer (discard),collab panel (close,
  also stops the picker).

## Status

- [x] Phase 1 — orb chip + bounds choreography (`40f8ec4`): floating ⇆ collapsed
      verified live; minimise collapses to the orb, clicking it re-expands.
- [x] Pre-existing fix — content-size bounds (same commit).
- [x] Phase 2 — radial petal menu (`523732d`, `command-deck` build): Deck,
      Note, Collab, Harvest, Rec; staggered spring fan-out.
- [x] Phase 3 — status duty on the orb (`523732d`): collab count dot, amber
      human-takeover pulse, red recording pulse (all surfaces get broadcasts).
- [x] Phase 4 — orb drag with magnetic edge docking and persistence (`523732d`).
- [x] Compositing fix — `invalidate()` after bounds shrink (`523732d`).
- [x] State-sync hardening (`command-deck` build): authoritative sidebar
      surface state, reload re-sync, chip padding, 404 stage.

## Petal semantics

| Petal | Action |
| --- | --- |
| Deck | Expand the Command Deck panel. |
| Note | Start the element picker (note drawer opens on the page). |
| Collab | Expand the deck with the collaboration threads panel inside it. |
| Harvest | Harvest the page and open the deck's CONSTRUCT tab — the markdown view. |
| Rec | Toggle the timelapse screen recorder; the orb's red pulse is the indicator. |
