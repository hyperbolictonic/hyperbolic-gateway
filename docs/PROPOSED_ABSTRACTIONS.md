# Hyperbolic Gateway — Abstractions & Additions (build todo)

Created 2026-10-18 alongside `FIELD_NOTES_2026-10-18.md` / `FIX_PLAN_2026-10-18.md`.

Goal: move the ~58 flat procedural verbs toward **a few orthogonal primitives** — one
observe model, one action model, one wait model — with the existing tools becoming
projections. Everything below is implemented on the **TIER-1 humanlike path** (real
input events, no DOM mutation except our own `data-mark-id` stamp) unless marked.

Status legend: `[x]` done + tested · `[~]` done, lightly tested · `[ ]` deferred.

---

## A. Core abstractions

- [x] **A1. Element refs = marks, with semantic lookup.** `find` resolves a
      role/name/text query to mark ids (refs); `act` consumes them and re-resolves
      live coordinates. Positional ids stay the wire format, so nothing breaks.
- [x] **A2. One observation model with projections.** `observe(as: markdown|text|ax|som|list|table|app_data)`
      with `region`, `budget`, `cursor` (paged, never truncated mid-list).
- [x] **A3. Declarative wait engine + implicit awaits.** `wait_for(conditions[], require)` +
      `act(..., await: [...])`. Conditions: `selector`, `gone`, `text`, `url`,
      `role_name`, `count`, `network_idle`, `stable(marks|height|text|nodes)`, `revision`.
- [x] **A4. Actions return a delta.** `act` -> `{urlChanged, marksBefore/After, revisionBefore/After, awaited}`.
- [x] **A5. Cursor protocol for long reads.** `observe` returns `{text, total, offset, next_cursor, truncated}`.
- [~] **A6. Network as a correlated resource.** `since` filter on traffic
      (action-correlated), `export_har`. Auto XHR↔action binding via revision is
      partially covered by `since: 'last_action'`.

## B. New tools

P0
- [x] `wait_for` — declarative condition polling.
- [x] `extract_list` / `extract_table` / `extract_app_data` — structured reads (via `extract`).
- [x] `observe` — budgeted, cursor-paged observation with projections.

P1
- [x] `collect_all` — scroll a virtualized container, dedupe rows into a list.
- [x] `find` — semantic (role/name/text/selector) search -> mark refs.
- [x] `expect` — immediate condition assertion with evidence (no retry).
- [x] `act` — unified click/type/hover/press with `await`, `dry_run`, `secret`.
- [x] `bridge_health` — app + bridge version, revision, capabilities.

P2
- [x] `page_state` + `diff` — cheap change detection for loops.
- [x] `context_*` (open/list/save/delete) — named cookie/storage profiles (sessions).
- [x] `export_har` — HAR 1.2 export of captured traffic.

## C. Polish

- [x] Structured error codes on the new endpoints: `STALE_REF`, `TIMEOUT`, `NO_TARGET`, `BAD_REQUEST`.
- [x] `dry_run` on `act`; `secret` redaction for typed text (chassis log + primitives log).
- [~] Consolidation: `observe(as: list|table)` + `extract` supersede nothing yet (old tools kept for compat).
- [x] Capability discovery: `/health` returns `version`, `capabilities[]`, `revision`.
- [~] Explicit `tab_id` on primitives (switch-then-act).
- [ ] Permission tiers / read-only mode (deferred — needs a policy surface in the client).
- [ ] `download` wait condition (deferred — downloads have no correlation id yet).

## D. Input delivery & background rendering (added later 2026-10-18)

Two P0 defects surfaced while stabilising the suite — both only appear on a real desktop where
another application owns the foreground:

- [x] **D1. Synthetic input must not depend on OS focus.** `webContents.sendInputEvent` is dropped by
      the OS whenever another window is foreground, so clicks/typing "landed" into the void (~50%
      flake, and *always* once the window was occluded). `HumanizedInputSimulator` now dispatches
      mouse/keys/wheel over the tab's already-attached CDP debugger (`Input.dispatchMouseEvent`,
      `Input.dispatchKeyEvent`, `mouseWheel`), which is focus-independent, and enables
      `Emulation.setFocusEmulationEnabled` so focus-gated page JS still responds. `sendInputEvent`
      remains as a fallback (and only that path steals the foreground). The active transport is
      reported as `/health` → `input.transport` (`cdp` | `native`).
- [x] **D2. An occluded window stops rendering — which breaks lazy loading.** Chromium reports the
      page as `hidden` and throttles timers to ≥1s when the window is occluded, and stops producing
      frames, so **scroll events never fire** and `IntersectionObserver`/rAF-driven hydration stalls.
      Fixes: `backgroundThrottling: false` on browsing tabs (also covers reused/prerendered views via
      `webContents.setBackgroundThrottling(false)`) and the Chromium switches
      `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`,
      `--disable-background-timer-throttling`. `collect_all` over a scroll-driven infinite feed went
      from a hard stall (`5 rows after 3 scrolls`) back to `25 rows after 7 scrolls`.
- [x] **D3. Actionable failure hints.** `act` failures now report viewport `0x0`, an unfocused window,
      and *which* element actually holds focus ("the click may have been occluded"). `collect_all`
      returns scroll diagnostics (`scrollTop`/`scrollHeight`/`clientHeight`/`visibility`) so a stalled
      harvest explains itself.
- [x] `focus_window` tool + `GET /window/visibility` (returns `{visible, focused}`) exposed for agents.

## Verification

- [x] `scripts/test-primitives.mjs` (`npm run test:primitives`) — offline fixture covering
      wait_for (selector/text/delayed), extract list/table/app_data, observe budget+cursor+text,
      collect_all over a virtualized list, find + act (type/click) + delta, expect,
      page_state/diff, bridge_health capabilities.
- [x] `scripts/test-mcp-primitives.mjs` (`npm run test:mcp:primitives`) — same primitives through a
      real MCP stdio client (tool schemas, viewport gating, `find`→`act`, contexts, `focus_window`).
- [x] `scripts/test-input-focus-independence.mjs` (`npm run test:focus`) — hands the OS foreground to
      another application (Notepad) and asserts typing/clicks/wheel still land **and** that the
      transport is `cdp`.
- [x] Existing `npm run test:harvest` still green.
- [x] Repeated-run stability (3× each suite, another app holding the foreground): harvest 4/4,
      primitives 25/25, MCP 14/14, focus 4/4.
- [x] `npx tsc --noEmit`, `npm run build`, `npm run build:mcp`.
