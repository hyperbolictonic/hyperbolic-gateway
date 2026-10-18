# Field Notes — Kuang / Mark Eleven MCP

**Run:** Skyscanner round-trip fares, London → Malé, first week of November 2026
**Date:** 2026-10-18
**Tooling:** `kuang` MCP (Cyberdeck Electron browser at `http://127.0.0.1:4111`)

These are friction points hit during a real travel-site scrape, plus concrete fixes. Ordered by severity.

---

## P0 — Reliability

### 1. MCP server dies on a broken stdout pipe (no error handler) → whole tool namespace vanishes
- **Observed:** a `query_json_data` call completed, then the client closed the pipe. The server's
  `stdout` write raised `EPIPE`, which is emitted as an unhandled `'error'` event on the socket →
  `process.exit(1)`. OpenCode then dropped `kuang` entirely (search returned 0 tools) with no auto-reconnect.
- **Root cause:** `src/mcp/bridge-server.ts` writes to stdio with no `process.stdout.on('error', …)`
  guard, and the `start().catch(…)` at the bottom only covers promise rejections — not stream errors.
- **Fix:**
  - Add `process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); … })`.
  - Wrap the `transport.send` interceptor in try/catch.
  - Hard-cap tool text payload size (see #2) so a single response can't blow the client buffer.

### 2. Unbounded tool response size (`query_json_data` / network payloads)
- A single `query_json_data` slice from a real SPA payload can be megabytes. That is the most likely
  trigger for the client closing the pipe in #1.
- **Fix:** clamp every tool's text output to a safe ceiling (e.g. 40–80 KB) with a clear
  `… [truncated N bytes]` marker, and expose an explicit `path`/`limit` for deeper reads.

### 3. No fast-fail when Cyberdeck is down
- When the Electron bridge was not listening on `:4111`, tool calls only surfaced a generic
  `Ensure Cyberdeck is running at …` error *after* attempting the HTTP forward.
- **Fix:** a cheap `/health` probe with a clear message, ideally a `get_bridge_health()` tool.

---

## P1 — Abstracted tooling gaps (the SoM / markdown path failed on the target content)

The OKF guide mandates **TIER 1 = `get_page_markdown()` → `click_mark`/`type_mark`**. On Skyscanner this
path could not see the thing we actually needed (the fares), which pushed the agent to TIER 3 JS.

### 4. `get_page_markdown()` omits virtualized result cards
- Returned nav/tabs/date-pickers and the "1001 results sorted by Best" header, but **none** of the
  ten fare cards. The cards live in a virtualized list of `div`s (`data-testid="ticket"`,
  `price-main-container`, `leg-info-row`) with no anchors/buttons, so the converter skipped them.
- **Fix:** harvest non-anchor result containers too — e.g. `[data-testid]` blocks and
  `[role="listitem"]`/card-like nodes — and include their condensed text as list rows.
- **What was actually wrong (measured on a fresh capture):** the captured HTML is *not* the problem —
  `document.documentElement.outerHTML` (~859 KB) contains 10 `data-testid="ticket"` cards and
  "Total cost £…" strings. Three latent bugs were found, two in `src/main/harvester/markdown.ts`
  and one in the MCP formatter:
  1. `Readability.parse()` mutates the JSDOM document in place — measured on the real page: fares
     present in `body.innerHTML` before parse (4/4) and **gone** after (0/4). The "aggregator"
     fallback read `doc.body.innerHTML` *after* the mutation, so on any page that took that branch
     the harvest came back gutted. Fixed by snapshotting the body **before** Readability runs.
  2. `bodyTextLen` was likewise measured *after* Readability (→ 0), which silently disabled the
     aggregator heuristic (`bodyTextLen > 600` never fired). Now measured before.
  3. `get_page_markdown`'s formatter read `construct.markdown` — a field that does not exist (the
     construct exposes `content`) — so it fell back to `JSON.stringify(...)`: the "clean markdown"
     was being returned wrapped in JSON. Fixed to read `content`.
- **Honest caveat:** an old-vs-new replay of the harvester on a *settled* Skyscanner capture
  returned the fares in **both** versions (8,766 vs 8,965 bytes), so the mutation bug was **not**
  the cause of the fares missing in the earlier session. The likeliest cause there was harvesting
  before the virtualized rows had rendered (the same timing gap as the `isLoading` note above). On
  a settled page the fares are present — the live `get_page_markdown` now returns 10 fare lines
  (verified). The three fixes above are correct hardening and were each proven independently.
- **Also:** added an `aria-label`/`title` text fallback to the link rule so card anchors whose only
  label lives in `aria-label` (Skyscanner's ticket rows) still contribute text.

### 5. `list_marks()` / SoM missed the result cards entirely
- Only ~23 interactive elements detected (nav, tabs, travellers, date spinners). The 10 fare cards
  were absent, so there was no badge to `click_mark`.
- Likely causes: cards are clickable `div`s (not `a`/`button`/`[role=button]`) and/or off-screen in
  a virtualized scroller.
- **Fix:**
  - Expand the interactive selector to `[data-testid*="ticket"|"card"|"result"]`, `[onclick]`,
    computed `cursor:pointer`, `[tabindex="0"]`.
  - Optionally **scroll-and-annotate** so virtualized rows get badged as they enter the viewport.
- **Implemented instead:** an opt-in `include_offscreen` flag (popups → on-screen → off-screen
  ordering, so the 99-cap still favours what is visible) plus `click_mark` scrolling an off-screen
  target into view before the humanised click.
- **Extra bug found while testing:** when a window/tab reports `innerHeight`/`innerWidth` of **0**
  (minimized to tray, or a freshly-created tab before layout) the viewport filter rejected *every*
  element, so `list_marks` returned **zero** marks with no error. Now falls back to the document box
  and skips the `elementFromPoint` hit-test when there is no real viewport.

### 6. No `wait_for` / idle primitive
- `get_page_info().isLoading` stayed `true` indefinitely on an ad-heavy SPA (beacons/ads keep
  streaming). There is no "wait for selector/text" or "wait for network quiet", so agents must blind-sleep.
- **Fix:** `wait_for({ selector | text | idleMs })` returning when the condition is met or a timeout elapses.

### 7. `list_marks` reported a bogus size
- Header said "Set-of-Marks Screenshot captured (0x0px)" while the image was fine. Cosmetic but erodes trust.
- **Fix:** report real viewport dimensions for the text-only path.

---

## P2 — Network interception / JSON navigator

### 8. Streamed/chunked responses aren't captured
- The key `web-unified-search` responses repeatedly showed `hasBody: false` (streamed), so the JSON
  Navigator had nothing to chew on for these fares.
- **Fix:** capture chunked/`Network.dataReceived` bodies, or at minimum flag "body not captured
  (streamed)" so the agent stops retrying that route.

### 9. `get_network_traffic` is verbose and its filter is ignored
- Despite the "compact 1-line HTTP summaries" description, each row carried full request/response
  headers. Passing `url_pattern` did **not** filter (unrelated ad/beacon rows came back).
- Suspect a payload key mismatch (`url_pattern` vs `urlPattern`) between MCP tool and bridge.
- **Fix:** compact by default; make the pattern filter actually apply end-to-end.

### 10. Doc/tool naming drift
- The OKF guide references `get_api_payload(request_id)`; the shipped tool is `query_json_data`.
- **Fix:** align docs and catalog.

---

## Notes on anti-bot / humanlike behaviour

- The intended markdown → marks → `click_mark` flow keeps everything inside the humanlike telemetry
  layer (Bézier cursor, `isTrusted` events). Because #4/#5 hid the fares, the only way to *read* them
  was TIER 3 read-only JS — which the guide discourages but does not forbid.
- The direct local-bridge HTTP fallback used here bypasses the browser UX entirely; fine as a rescue,
  but it should never be the path of least resistance. Fixing #4/#5 restores the humanlike path.
- A documented, read-only **"extract structured content"** tool (returning `data-testid`-keyed rows)
  would remove the incentive to hand-roll DOM JS on retail/travel SPAs.

---

## Rerun confirmation (clean MCP path, 2026-10-18)

After the server was reconnected, the same search was repeated purely with the abstracted tools:

- `navigate_to` → OK. `list_marks` at top-of-page: only **23** elements, **0 tickets** (same as before).
- `scroll_page(down)` → then `list_marks`: tickets now badged (`#3 <A> "Qatar Airways Flight option 5: Total cost £612…"`,
  `#5 <BUTTON> "Select Flight Option 5"`). **SoM only sees the cards once they scroll into the viewport.**
- `take_economy_screenshot` → readable fare cards; vision was the only way to read prices.
- `get_page_markdown` **after** scrolling → still **zero** `£` lines.

**Conclusion:** the fix for #4/#5 is "scroll-then-annotate" plus a markdown harvester that includes
`[data-testid="ticket"]` containers. Without it, TIER 1 is a dead end on this class of page and agents
are pushed to TIER 2 vision (or TIER 3 JS) on every travel/retail SPA.

## Task workarounds used this run
- ~~`scripts/sky-sweep.mjs`~~ (deleted): drove `/navigate` + read-only `/evaluate` with
  Skyscanner-specific selectors — a stopgap, and an example of the TIER-3 shape we want to avoid.
  Replaced by `examples/bridge-await-results.mjs`: a site-agnostic example of the recommended flow
  (navigate → wait for marks to settle → `include_offscreen` marks → `click_mark`).

---

## Follow-up: two P0s found while stabilising the automated suites (later on 2026-10-18)

Both only reproduce on a real desktop, where the human's editor/terminal owns the foreground. They
are the true cause of the "the click landed but nothing typed" flake seen earlier, and of harvests
that came back thin.

### 11. Synthetic input silently dies when another window is focused
- **Observed:** `act(type)`/`act(click)` intermittently waited out their whole timeout, with
  `document.activeElement === BODY` and an empty input — then *every* subsequent action failed until
  the Cyberdeck window was manually re-focused. Once it started, it never recovered.
- **Root cause:** Electron's `webContents.sendInputEvent` is dropped by the OS while another window
  owns the foreground (documented Electron behaviour). A probe confirmed the OS foreground was the
  IDE, not the Cyberdeck window, while the app still reported `isFocused() === true` — so Electron's
  own focus flag is *not* a reliable guard.
- **Fix:** deliver input over the tab's already-attached CDP debugger
  (`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `mouseWheel`), which is focus-independent,
  with `Emulation.setFocusEmulationEnabled` so focus-gated page JS still responds. `sendInputEvent`
  stays as a fallback for when no debugger is attached (that path — and only that path — brings the
  window forward). The live transport is reported at `/health` → `input.transport`.

### 12. An occluded window stops rendering, so scroll-driven lazy loading never fires
- **Observed:** `collect_all` over a scroll-driven infinite feed stalled at `5 rows after 3 scrolls`
  in every run, while `scrollTop` had clearly reached its maximum.
- **Root cause (from the new collect diagnostics):** `document.visibilityState === "hidden"`.
  Chromium occludes the window, reports the page hidden, throttles timers to ≥1s and stops producing
  frames — so the `scroll` event never fires and `IntersectionObserver`/rAF hydration never runs.
  The earlier "passing" runs only worked because input actions were stealing the foreground.
- **Fix:** `backgroundThrottling: false` on browsing tabs (plus `webContents.setBackgroundThrottling(false)`
  so reused/prerendered views are covered) and the Chromium switches
  `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`,
  `--disable-background-timer-throttling`. This is not just a test fix: a backgrounded Cyberdeck
  would silently harvest half-loaded SPAs.
- **Diagnostics added:** `collect_all` now returns `diag` (`scrollTop`, `scrollHeight`, `clientHeight`,
  `children`, `visibility`, `hasFocus`); `act` failures report viewport `0x0`, an unfocused window, and
  the element that actually holds focus.

### 13. Test coverage for the above
- `npm run test:focus` (`scripts/test-input-focus-independence.mjs`) gives the OS foreground to
  Notepad, then asserts typing/clicks/wheel still land *and* that `input.transport === 'cdp'`.
- Repeated-run stability with another application foregrounded: harvest 4/4, primitives 25/25,
  MCP primitives 14/14, focus 4/4.

