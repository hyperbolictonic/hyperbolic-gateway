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
  chosen `{ id, action? }` (null on Escape/blur/outside click). The concise
  collab note list uses it for note navigation.
- The radial petal menu is data-driven markup (`#deck-menu`); petals reuse
  the same handlers as the toolbar via trusted event dispatch.
- Escape dismisses the radial or popup menu, cancels the picker/drawer, or
  leaves collab mode. The deck surface itself handles Escape too, because it
  owns keyboard focus right after a radial-menu click — otherwise "note" mode
  (started without entering collab mode) could not be escaped from there.
  Leaving collab mode hides thread highlights and removes the pinned element
  controls so the page visibly returns to ordinary browsing.

## Status

- [x] Phase 1 — orb chip + bounds choreography (`40f8ec4`): floating ⇆ collapsed
      verified live; minimise collapses to the orb, clicking it re-expands.
- [x] Pre-existing fix — content-size bounds (same commit).
- [x] Phase 2 — radial petal menu (`523732d`): Deck, Note, Collab, Harvest, Rec;
      staggered spring fan-out.
- [x] Phase 3 — status duty on the orb (`523732d`): collab count dot, amber
      human-takeover pulse, red recording pulse (all surfaces get broadcasts).
- [x] Phase 4 — orb drag with magnetic edge docking and persistence (`523732d`).
- [x] Compositing fix — `invalidate()` after bounds shrink (`523732d`).
- [x] State-sync hardening (`edf6fc6`): authoritative sidebar surface state,
      reload re-sync, chip padding, themed popup menus.
- [x] Collab-mode toolbar replacing panel-based notes (Oct 31 build):
      COLLAB petal turns the orb into the collab toolbar pill; the old threads
      panel no longer opens from any collab entry point. Petals remain: Deck
      expands the panel, Note starts the picker, Harvest opens CONSTRUCT
      (markdown view), Rec toggles the timelapse recorder.
- [x] Element toolbar after selection (same build): pinned bar with pen (note
      drawer) + CSS class editor; class-list deltas travel into the store as
      `class-edit` threads readable by agents.
- [x] WEB STATE tab (same build): URL/title/crumbs/cookies/local & session
      storage for the active page (formerly the dead MATRIX LOGS tab).


## Collab mode

Pressing the **COLLAB** petal or the header collaboration icon does not open a
panel — the orb itself turns into the collaborations toolbar (the old panel
component is retired; the only UIs left are this pill and themed popovers):

| Control | Action |
| --- | --- |
| ‹ / › | Cycle notes on the page (the focused thread keeps a persistent amber ring and flash, and stays on until you switch threads or leave collab mode). |
| List | Concise list of unresolved notes — click a row to cycle to it. |
| Pen | Arm the element picker: click an element → the element toolbar (below) attaches. |
| ✕ EXIT / Escape | Leave collab mode. The deck orb's icon slot becomes this prominent exit control while collab mode is active. |

The pill lives in the same collapsed native view family as the orb
(`TOOLBAR_BAR_WIDTH` + padding, same corner rules).

## Element toolbar & class edits

Selecting an element (picker pen) shows a small toolbar pinned to it
(`__hbCollabShowElementToolbar`, page-level): a persistent amber outline +
**✎ attach a note** (the existing anchored drawer) and **CSS** — the class
editor. The editor snapshots the element's classes; chips reactively add /
remove real `classList` membership (the page responds live, so the human can
compose the look), and **SEND TO AGENT** reports the delta
(`+added -removed`) over the `__KUANG_COLLAB_CLASS__:` console channel into
the thread store as a `class-edit` tagged thread — the same way the agent
consumes every other human signal, so "human meaning" is machine-visible
without clunky panel forms.

Each annotation card also has its own **✓ Resolve** control, visible only in
collab mode. Resolving removes the note from the active list and its page
highlight; Resolve is not a separate floating-menu action.

## WEB STATE tab

The deck's fourth tab (was MATRIX LOGS) became **WEB STATE**: current URL,
title, URL breadcrumbs, visible cookies (name@domain + httpOnly flag) and
localStorage / sessionStorage keys — refreshed on demand. This answers
"what does the page look like to the session" for humans and mirrors the
bridge's `get_page_info` surface.
