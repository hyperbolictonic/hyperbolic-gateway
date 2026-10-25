# Changelog

All notable changes to **Kuang Grade Mark Eleven** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Versioning during the 1.4 line:** changes ship as **`1.4.x` patches — including new features** — and the
> minor number is reserved for milestones worth naming. For small increments (documentation, a one-line fix)
> the **git tag and release title take a fourth number** — `v1.4.2.1`, `v1.4.2.2`, … — so a docs-only release
> does not consume a patch number. For an ordinary follow-up that should not consume the next patch either,
> **append a sub-counter to the patch** instead of moving to `1.4.7`: `1.4.6` → `1.4.71`, `1.4.72`, … (still
> three-part and valid semver, and still ordered after `1.4.6`). Once a sub-counter is in use, the next
> *numbered* patch is `1.5.0`, never `1.4.7` — `1.4.7` sorts before `1.4.71`. `package.json` and `APP_VERSION`
> stay **three-part**, because npm and electron-builder require valid semver; a release tagged `v1.4.2.1`
> therefore reports `1.4.2` in `/health`. This is a deliberate, temporary deviation from strict semver; each
> increment still gets its own Added/Fixed/Changed section here.

## [1.5.1] - 2026-10-25

### Fixed

- **Settings → Shadow Walk failed to load** with
  `Cannot set properties of null (setting 'checked')`. The `Part outlines` control was missing from
  `index.html` while the renderer still looked it up. Restored the toggle.
- Added `scripts/test-settings-dom.mjs` (`npm run test:settings:dom`) and the same step in the guard
  workflow: every static Settings/Shadow Walk `getElementById` target must exist in `index.html`.

## [1.5.0] - 2026-10-25

The Shadow Walk milestone. The 1.4.9x series built the subsystem; this release calls the plan
complete and makes iframe content first-class end to end. No breaking API changes.

### Highlights

- **Closed roots**: AX discovery, coordinate acts, trusted Tab entry, offscreen sealed tokens,
  cache/rate limits, no value leakage.
- **Iframes**: same-site and OOPIF discovery, geometry, controls, screenshots, 100+ frame mark ids,
  and frame-aware `observe`/`extract`.
- **Components**: stable host signatures on main, sealed and frame results; recipe anchors with
  `SIGNATURE_MISMATCH` retirement.
- **Settings**: Shadow Walk panel with enforced tiers, structured refusals, and
  `bridge_health.shadowWalk`.
- **Force-open**: the one detectably risky lever, off by default, confirmed, chipped, and
  detectable by design.
- **Polish**: `partHighlight`, `cdpStyleMatch`, and target-text resolution on hidden windows.

### Verification

- All live suites green: `test:dom`, `test:sealed`, `test:framemarks`, `test:component`,
  `test:tabwalk`, `test:forceopen`, `test:shadow`, `test:primitives`, `test:recipes`.
- Unit suites green: component signatures, settings, part-highlight, recipe compile.
- `tsc --noEmit`, `test:mcp:contract`, and `check:no-local-paths` pass.
- Real-world smoke: Mobalytics (SPA/controls), Polymer Shop and lit.dev (signatures), lit.dev
  sealed scan (no false positives).

The only remaining Shadow Walk item is the **Clone Lab proposal** (`docs/TODO.md` item 18),
parked by decision — design-only, no code planned.

## [1.4.103] - 2026-10-25

### Added

- **Frame-aware `extract`.** `extract(include_frames:true)` runs the same extraction script in each
  child frame. The main result is unchanged; `frames[]` carries per-frame
  `{frameId,url,oopif,ok,value|error}`. For `table`/`tables`, `frameRecords[]` merges records with
  `frameId`/`frameUrl` while leaving the main rows intact.
- Same-site and OOPIF frames both work through `evaluateInFrames`; each frame keeps its own
  timeout/row limit. Main-frame mark refs are not used inside frames — the selector (or best
  container) is.
- HTTP/MCP `extract` expose `include_frames`, `max_frames`, `timeout_ms`; MCP text appends a
  per-frame summary.
- `test:framemarks` now 13 checks (tables and JSON-LD in both frame types).

## [1.4.102] - 2026-10-25

### Added

- **Frame-aware `observe`.** `observe(as:"som"|"components", include_frames:true)` merges child-frame
  controls into the main results. Frame rows carry their 100+ mark ids, frame identity and host
  signature, so the decision loop can see and act on iframe affordances with the same model.
- `POST /observe` and MCP `observe` accept `include_frames`; `find` without it and `extract`
  remain main-frame only.
- `test:framemarks` now proves both projections (10 checks).

## [1.4.101] - 2026-10-25

### Added

- **`partHighlight`** (VISIBLE, off). Before each capture, collect the exported parts of open
  custom-element hosts, inject `tag::part(name){outline:…}`, take the screenshot, then remove the
  style. Closed roots are not page-enumerable; force-open is the separate path. A pure rule builder
  is unit-tested; a live shot verifies the capture path.
- **`cdpStyleMatch`** (COST, off). Captures `CSS.styleSheetAdded` headers and runs
  `CSS.getMatchedStylesForNode` for sealed controls. Sealed results may carry
  `style: {sourceUrl, constructed}`. Best-effort: bundled apps often expose no URL.
- Settings → Shadow Walk exposes both levers with `VISIBLE`/`COST` badges; `/health.shadowWalk`
  reports them.
- Tests: `npm run test:parthighlight` (2), `test:sealed` now 21 (constructed stylesheet provenance),
  `test:component` 12 (part-highlight capture path).

## [1.4.100] - 2026-10-25

### Fixed

- **`deepOpenRoots` now matches its label.** The lever previously blocked `/dom/facts?deep` and
  frame deep scans, but the marks scanner still traversed every open shadow root. The marks overlay
  now takes `deepOpenRoots` from Settings; when off, `find`/`observe` marks stay in the light DOM,
  while sealed discovery (a separate lever) is unaffected. `test:component` asserts both directions
  (open-root control found with the lever on, absent with it off).

### Real-world smoke (read-only)

- **Mobalytics** (`https://mobalytics.gg/`): 80 controls, **0** custom-element signatures (React
  app), 5 blank same-site frames, consent dialog in the main document. Good SPA/control smoke; not a
  closed-root or component-surface target.
- **Polymer Shop** (`https://shop.polymer-project.org/`): 16 controls, **16/16** with signatures,
  2 distinct hosts.
- **lit.dev**: 66 controls, 6/16 with signatures, 5 distinct hosts.
- **lit.dev sealed scan**: 0 closed controls, 439 ms, 7 CDP commands; no false positives.
- Force-open remained off in every smoke run.

## [1.4.99] - 2026-10-25

### Added

- **Offscreen sealed controls are actionable.** `find(sealed:true)` now issues a short-lived
  `token` (`st_…`, 2 minutes) for each result, included in JSON and the text output. Pass it as
  `act(sealed_token)` (HTTP `sealed_token`, MCP `sealed_token`): the browser resolves the backend
  node in its frame, calls `DOM.scrollIntoViewIfNeeded`, re-measures the box model, composes the
  frame offset, and only then clicks/types. No stale coordinate is clicked.
- Tokens are per tab, cleared by a fresh full sealed scan, and fail with `STALE_REF` after
  navigation/expiry. `sealed.tokens` is counted in metrics.
- `test:sealed` now includes a far-down closed-root button: `inViewport:false`, token issued,
  `act(sealed_token)` scrolls and clicks it (20 checks).

## [1.4.98] - 2026-10-25

### Added

- **Component signatures on sealed and frame results.** The host surface is now attached to closed
  shadow-root controls (read from the light-DOM host through the pierced tree + `CSS.getComputedStyleForNode`)
  and to `frames` / `find(include_frames:true)` controls (read in the frame). Recipes can therefore
  anchor on components regardless of whether the control is in the main document, a closed root, or
  an iframe.
- The page-side signature helper uses `:defined` instead of `customElements.get`, so it works in the
  isolated world used by frame evaluation; a defined custom element reports `defined:true` there too.

### Tests

- `test:sealed` now asserts the host signature (`host-one`, `part`, `exportparts`, `--brand`) and is
  18 checks.
- `test:framemarks` now asserts the frame host signature and is 8 checks.
- `test:component` / unit remain 9/9 and 3/3.

## [1.4.97] - 2026-10-25

### Added

- **Frame control mark ids.** `find {include_frames:true}` now stamps child-frame controls with
  100+ ids (`100 + child_index * 100`, 99 per frame) and returns them alongside main-frame marks.
  `act(mark_id)` / `type_mark` resolve a frame mark live: find the element in its frame, scroll it
  into view, measure, add the frame's top-level rect, then click/type.
  - Same-site and cross-site (OOPIF) frames both work through `evaluateInFrames`.
  - `frames` exposes the same `id` on each control.
  - Main marks stay 1–99; the blocks never collide.
  - `find` without `include_frames` is unchanged.
- `scripts/test-frame-marks.mjs` (`npm run test:framemarks`, 7 checks): default main-only, both
  frame types with 100+ ids, frame identity, mark clicks in each, typing in an OOPIF, and `frames`
  exposing the same ids.

### Notes

- The test target question: Mobalytics is useful as a read-only real-world SPA smoke, but it is
  not a reliable closed-root fixture. Keep correctness on the local closed/OOPIF fixtures; use a
  controlled page for closed roots and an open-component site for signature smoke tests.

## [1.4.96] - 2026-10-25

### Fixed

- **Force-open panel no longer overflows the Settings viewport.** The daisyUI `.fieldset` grid
  track used `1fr`, whose automatic minimum is min-content; the long force-open copy pushed it to
  ~1100px inside a 768px panel. The Shadow Walk fieldsets now use `minmax(0,1fr)` with `min-w-0`,
  and the explanatory paragraph is a normal block with `whitespace-normal` (daisyUI's `.label` sets
  `nowrap`). The text wraps in place and the red box stays within the panel.

## [1.4.95] - 2026-10-25

### Added

- **Force-open (RISKY, off by default).** A Settings → Shadow Walk lever that patches
  `Element.prototype.attachShadow` at document start so `{mode:"closed"}` becomes `{mode:"open"}`.
  Injected with `Page.addScriptToEvaluateOnNewDocument`; applies on the next navigation, never to
  the document already running.
  - Deliberately detectable: no `toString` forgery. The page can see `host.shadowRoot !== null` and
    the non-native function source. A **RUN DETECTION TEST** button reports armed/applied/detectable
    with evidence; a red `SHADOW PATCH` chip shows while armed.
  - Enabling requires a confirm in the panel. Disabling removes the script for future documents;
    the current document stays patched until it reloads (stated in the UI).
  - `KUANG_FORCE_OPEN_SHADOW=1` arms it for a one-off run; `KUANG_SHADOW_WALK=off` still wins.
  - New tabs created while armed are patched before their first document (or reloaded once if the
    CDP arm lands late). Existing tabs are armed immediately; their next navigation is patched.
- `scripts/test-force-open.mjs` (`npm run test:forceopen`, 10 checks): closed by default, marks
  cannot see the inner button, force-open after reload, page-side detection, marks reach the button,
  disarm restores the boundary, and master-off disarms.

### Notes

- `partHighlight` and `cdpStyleMatch` remain off/unbuilt.
- Sealed and iframe results still do not carry component signatures.
- The Shadow Walk plan is complete through P5; frame-control mark ids and Clone Lab remain future
  work.

## [1.4.94] - 2026-10-25

### Added

- **Component signatures.** `find` marks and `observe(as:"components")` now carry the nearest
  custom-element host's exported surface:
  `{tag, defined, part[], exportparts[], cssVars[], signature}`. Attributes are normalised and
  sorted before a short djb2 hash, so attribute order and re-renders do not change the identity;
  a renamed part or changed export mapping does. Read from the host only — page-visible by design.
  Controlled by `componentSurface` in Settings → Shadow Walk; off removes the field.
- **Recipe anchors.** `DriveStep` and `RecipeStep` carry an optional `signature`; `drive →
  save_recipe` preserves it and replay verifies it before acting.
  - Matching surface: the step proceeds as before.
  - Changed surface: `409 SIGNATURE_MISMATCH` and immediate retirement (not three silent retries).
  - `componentSurface` off: `409 SIGNATURE_UNAVAILABLE`, no click and no retirement.
- `scripts/test-component-signature-live.mjs` (`npm run test:component`, 9 checks) covers observe/
  find attachment, replay, structural mismatch/retirement and the disabled-surface case;
  `npm run test:component:unit` covers normalisation and hash stability (3 checks).
- The recipe compiler test now asserts a signature is carried into the recipe and omitted when the
  target has no host.

### Fixed

- **Target-text resolves on a hidden/occluded window.** `textTargetExpression` clipped candidate
  rects to `window.innerWidth/innerHeight`; a hidden tab reports `0`, so `act(target_text)` returned
  `NO_TARGET` even though marks resolved. It now falls back to the document box, like the mark
  scanner. This was caught by the recipe replay suite after a restart.

### Not built yet

- `partHighlight` and `cdpStyleMatch` remain off. Force-open is the last phase (`1.4.95`).
- Sealed and iframe results do not carry component signatures yet; the host surface is available
  only for page-visible targets.

## [1.4.93] - 2026-10-25

### Added

- **`Settings → SHADOW WALK`.** A master switch, the implemented Shadow DOM levers (sealed
  discovery, deep open roots, Tab walk with max steps and focus restore), and the iframe levers
  (geometry, controls, screenshots, max frames, max controls, screenshot side). Tier badges are
  explicit: `SAFE` for read-only paths, `VISIBLE` for the Tab walk, `RISKY` reserved for the
  not-yet-built force-open.
  - Stored in `data/shadow-walk.json`, read on every guarded call, written atomically **over IPC
    only**. `RESET DEFAULTS` restores the shipped policy. No HTTP write route exists.
  - Numeric levers are clamped at the store boundary; a corrupt file falls back to safe defaults.
- **Structured refusals before work starts.** `SHADOW_WALK_DISABLED` (master),
  `SEALED_DISABLED`, `TAB_WALK_DISABLED`, `FRAMES_DISABLED`, `DEEP_OPEN_ROOTS_DISABLED` — `400`
  with a code instead of a silent no-op. The sealed guard now runs **before** marks are injected, so
  a refused call does not mutate the page.
- **`bridge_health.shadowWalk`** mirrors the active policy (enabled, sealed, Tab walk + limits, deep
  open roots, frame limits, `forceOpen` reported but not built).
- Enforced caps: `tabWalkMaxSteps`, `frames.maxFrames`, `frames.maxControls`,
  `screenshots.maxSide`. Turning frame controls or screenshots off returns frames without those
  fields plus a `notes` line.
- `scripts/test-shadow-settings.mjs` (`npm run test:shadow`, 11 checks) and
  `scripts/test-shadow-settings-unit.mjs` (`npm run test:shadow:unit`, 7 checks) cover defaults,
  clamping, corrupt files, the environment kill switch, every structured refusal, the master
  switch, output suppression and cap enforcement.

## [1.4.92] - 2026-10-25

### Added

- **`focus_walk` — enter a closed shadow root like a keyboard user.** `POST /focus_walk` (MCP
  `focus_walk`) focuses a light-DOM host, sends trusted `Tab`/`Shift+Tab` steps, and reads the
  accessibility tree after each step to confirm which inner control actually has focus.
  - Stops on `left-host`, `max-steps`, `no-focus`, or `not-focusable`; reports `landed`, `restored`
    and `medianStepGapMs`.
  - One real key event per step with a 90-140 ms dwell; no bursts, no page-side focus injection in
    the normal path. A `delegatesFocus` host appears as the initial (`index: 0`) step.
  - `DOM.focus` with a page-side `focus()` fallback for hosts that reject the CDP command; focus
    returns to the host when the walk fails.
  - `RootWebArea` also claims `focused:true`; it is filtered so the result names the control the
    user is actually on.
  - Works with the existing `act(action:"press", text:"Enter")` to activate the landed control.
- `scripts/test-tabwalk.mjs` (`npm run test:tabwalk`): closed root entry, stop conditions, Enter
  activation, Shift+Tab failure + restore, `delegatesFocus`, and human cadence.

### Fixed

- **`pressKey` now carries Shift and text.** `Shift+Tab` sends the Shift modifier; without it
  Chromium performs a forward Tab. Enter/Space include their text payload so a focused button is
  actually activated.
- **`collect_all` no longer throws `Assignment to constant variable`.** The injected collector
  declared `rows` as `const` and reassigned it after each scroll (introduced in 1.4.78); it is a
  `let` again. `test:primitives` is back to 37/37.

## [1.4.91] - 2026-10-25

### Added

- **`find {sealed:true}` — closed shadow roots become nameable.** The result gains a `sealed` array
  alongside the normal marks. Each entry has a role, accessible name, viewport rect and action list,
  so `act(x, y)` can click it or type into it. Closed-root controls were previously addressable only
  if you already knew their pixels.
  - Discovery is `Accessibility.getFullAXTree` for names + `DOM.getDocument({pierce:true})` /
    `DOM.describeNode` (frame owner `contentDocument`) to prove the node lives under a
    `shadowRootType:"closed"` root. `DOM.getBoxModel` supplies the rect. The page's own
    `shadowRoot` probe still returns `null`.
  - Per frame: same-process children use `getFullAXTree({frameId})`; cross-site children use their
    OOPIF session and the target root's top-level rect composes the coordinates.
  - Hidden semantics come from AX: `display:none`, `visibility:hidden` and `aria-hidden` are
    absent. Zero-size controls are dropped; offscreen ones are returned with `inViewport:false`.
  - **Input values are never returned.** AX exposes them; the sealed result omits them.
  - Quiet by default: no AX or pierce work on navigation, observe, plain `find`, screenshot or idle.
    Identities are cached by document revision for 5 seconds, repeat calls re-measure only the
    matches, and six full scans per minute per tab return `429 SEALED_RATE_LIMITED` with
    `retry_after`. The AX domain is enabled for the scan and disabled immediately after.
  - `POST /find {sealed:true}` and MCP `find(sealed:true)` expose `sealed_total`, `sealed_cached`
    and `sealed_notes`; `refresh:true` forces a fresh scan.
- `scripts/test-sealed.mjs` (`npm run test:sealed`): closed root, nested closed root, same-site
  closed frame, cross-site (OOPIF) closed frame, hidden/aria-hidden absence, page JS still blind,
  coordinate click, `clear_first` typing, cache hit, quiet-by-default metrics and a real 429.

### Fixed

- **Typing into a closed-root field no longer duplicates the text.** The input probe could not read
  the value behind a closed root, so a successful keystroke attempt looked like a no-op and the
  insertText/paste fallback appended the text again. The probe now reports `observable:false`, the
  verdict is `landed:null` with `unobservable:true`, and no fallback runs.

## [1.4.90] - 2026-10-25

### Fixed

- **Cross-site iframes are visible.** Chromium omits an out-of-process (OOPIF) iframe from the
  tab's `Page.getFrameTree`. 1.4.89 derived the frame list from that tree only, so `frames`, frame
  evaluation, in-frame controls and frame screenshots silently skipped cross-site children. The
  1.4.89 suite did not catch it because its "cross-origin" fixture used two ports on `127.0.0.1` —
  cross-origin, but same-site, so Chromium kept it in-process.
- `src/main/browser/frame-tree.ts` now merges the parent tree with detached `iframe` targets:
  attach with `Target.attachToTarget({flatten:true})`, read the target's frame tree, keep only
  targets whose parent is a frame in this tab, and resolve nested OOPIFs to a fixpoint. Sessions are
  detached in `finally`; the page is never paused and sees nothing.
- Geometry still comes from the parent: `DOM.getFrameOwner` on the parent session, then a
  `getBoundingClientRect` measurement of the `<iframe>` owner. Offsets compose for nested frames,
  and the result is unchanged for same-site frames.
- `FrameInfo` gains `oopif` and `targetId`; `FrameEvalResult` gains `oopif` so a caller can tell
  which path produced the value.

### Changed

- Frame evaluation creates its isolated world and runs `Runtime.evaluate` on the frame's own
  session. OOPIF context ids are not cached across scans because the session is per call; same-site
  frames keep the existing document-scoped cache.
- The live DOM suite now serves the child on `127.0.0.2` while the page stays on `127.0.0.1`, so
  every frame check exercises a real OOPIF: frame eval, in-frame controls, consent, the offset click
  and the cropped screenshot (25 checks).

## [1.4.89] - 2026-10-25

### Added

- **`frames` — iframes as first-class content.** `POST /frames` (MCP `frames`) returns the frame
  tree with each frame's **content-box rect in top-level viewport pixels**, the controls inside it
  with rects already offset into the page, and — with `screenshots: true` — one cropped image per
  visible frame. A cross-origin checkout, widget or consent wall stops being a blank box: the agent
  can see it, read its controls, and click them with `act(x, y)`.
  - Geometry comes from `DOM.getFrameOwner` + a measurement in the **parent** document, so a
    cross-origin child is measurable even though it is unreadable; parents precede children in the
    frame tree, so nested frames compose.
  - Offset correctness is asserted live: the fixture clicks the reported centre of a control inside a
    cross-origin child and the child document confirms the click.
  - Screenshots are one viewport capture cropped per frame, with the device-pixel ratio derived from
    the image rather than assumed (400×200 frame → 600×300 crop at 1.5×).
  - The MCP tool returns multiple image content blocks, one per visible frame, each labelled.
  - `GET /frames` is the cheaper inventory (geometry only, no content scan).
- **Deep control facts.** `POST /dom/facts {deep:true}` walks open shadow roots like the marks
  scanner, and fixes the two things that silently break inside a root: the hit-test descends via
  `shadowRoot.elementFromPoint`, and containment uses a composed walk instead of `el.contains()`.

### Docs

- `docs/SHADOW_DOM_AND_FRAMES.md` now carries a capability matrix that includes `frames`, a worked
  geometry/screenshot example, the transform and `clear_first` limits, and an explicit design note for
  the two cells that are still ❌ (frame-scoped mark ids; closed roots via `DOM.getDocument` with
  `pierce:true`).
- `src/main/browser/README.md` documents `listFrames()`; `docs/CONTROL_LAYER.md` links frames from the
  evaluation section.

## [1.4.88] - 2026-10-24

### Added

- **Ops metrics.** Small counters — `cdp.input`, `cdp.frame`, `action.click`, `action.type`,
  `action.scroll`, `nav` — exposed at `GET /metrics` (full map) and summarised in `bridge_health` as
  `metrics: {cdp, actions, navigations}`. `POST /metrics/reset` clears them. The point is the metric
  jev-ultrafast reports: **CDP commands per task**, the honest measure of whether a change actually
  reduced round trips.
- **Stale MCP server guard.** The MCP server process is spawned once per client session, so rebuilding
  the app leaves yesterday's tool schemas running against today's bridge — which is exactly how
  `target_text` and `recipe` looked broken during development. On the first tool result the server
  now compares its bundled `APP_VERSION` with the live app version and, on a mismatch, prefixes one
  result with `⚠ STALE MCP SERVER — this server is vX, the running app is vY … restart the MCP client
  session`.
- **Live verification backlog** in [`docs/TODO.md`](../../docs/TODO.md) item 17, scheduled 2026-10-25:
  `drive → save → replay` end-to-end, a real CMP iframe, takeover mid-action, and recipe retirement.



### Added

- **Recipe learning from `drive`.** `drive {save_recipe: true}` compiles a successful run into a
  replayable recipe (`recipe_name` optional). Only verified steps are compiled — failed steps,
  dry-run plans and non-replayable operations (`scroll`/`wait`/`done`) are dropped, and a
  `type_text` step is only kept when its value can be recovered from the `values` passed to `drive`.
  A step with no target name is skipped rather than guessed.
- `compileDriveSteps` is a pure function (`src/main/recipes/compile.ts`) with an offline suite:
  **`npm run test:recipe:compile` → 9 checks**.
- Recipes README documents the learning rules and their rationale.

### Notes

- End-to-end (`drive` → save → replay) is **not** verified live: on the test fixture `drive`
  returned `needs_agent` (the guard rejected every option), so the run never reached `done`. The
  compiler and the replay engine are each covered by their own suites; the wiring between them is
  the untested seam.



### Added

- **Navigation recipes (Phase 5).** A page path is compiled into descriptor steps and replayed with
  **zero model calls**: `recipe {action:"save"|"replay"|"list"|"delete"}`.
  - a step names a control by visible text (or a form field's aria-label / placeholder / name), with
    an optional `expect` — never a mark id or a selector
  - scope is `origin` + `path` (trailing `*` = prefix); stored locally in `data/recipes.json`
  - metrics (`attempts`, `successes`, `consecutiveFailures`, `lastVerified`); a recipe retires after
    **3 consecutive failed replays** instead of being retried forever
  - a replay stops at the first step whose control cannot be resolved or whose expectation fails and
    reports the index — a half-applied recipe is worse than a refusal
  - measured on the fixture: **3 steps in ~2 s, 0 model calls** (`click → type → click + expect`)
- **`act(target_text)` now also matches form fields** by aria-label / placeholder / name, so a typed
  step can be anchored the same way a click is.
- **Documentation**: new [docs/CONTROL_LAYER.md](../../docs/CONTROL_LAYER.md) (targeting, consent,
  takeover, pacing) plus subsystem pages for `src/main/input`, `src/main/browser` and
  `src/main/recipes`, and rewrites of the shield and primitives pages. Linked from `docs/README.md`
  and the root README index.
- **`npm run test:recipes`** — 11 checks: save, validation, replay, real end-state, metrics, stale
  step, delete.

### Fixed

- Text targeting threw when the candidate selector string was built (`querySelectorAll(NodeList +
  ',input,…')`), so `target_text` silently found nothing. Found by the recipe replay test.



### Added

- **Human takeover detection and arbitration.** The page reports trusted pointer/key/wheel/touch
  activity over a console channel; the agent's own CDP input is bracketed by a synthetic marker so
  the two can be told apart. While a person is active, synthetic input is **refused** with
  `HUMAN_IN_PROGRESS` instead of fighting them for the cursor.
  - window: every human event extends a 2 s quiet period; the agent may act again after it lapses
  - `GET /human/status` → `{active, activeForMs, last:{kind,at,url,target}}`
  - `POST /human/resume` clears it explicitly (HUD/manual hand-back)
  - `bridge_health` gains `human.paused` + the same status
  - `AgentStatus` gains `HUMAN_INPUT`, shown as a pulsing info badge in the HUD with the takeover
    description in the action line
- **`npm run test:human`** — 7 offline checks of the predicate (untrusted events, grace window
  boundary, no-dispatch case).
- `/dom/facts`, `/evaluate{frames}` tests extended: **`npm run test:dom` → 20 checks**, including
  "synthetic input never counts as human" and "untrusted page events never count as human".

### Verified live (real OS input, not synthetic)

- a physical click at (400, 400) → `active: true`, `last: {kind:"pointer", url:"https://example.com/", target:"body \"This domain is for use in documentation \""}`
- an `act` attempt during that window → `500 HUMAN_IN_PROGRESS: the human is using the browser — synthetic input is paused…`

### Notes

- Detection is timing-based by necessity: CDP and human input are both trusted in the DOM. A human
  event arriving inside the 180 ms synthetic grace window is indistinguishable and is treated as
  the agent's — the alternative (blocking our own clicks) is worse.
- The listener re-arms on every document load; it is idempotent per page.



### Added

- **Consent walls inside child frames are now answerable.** When the top document offers no
  control and the page embeds any `<iframe>`, the same scan runs in every frame's isolated world
  (the 1.4.82 helper). The chosen control is clicked at its top-level coordinates — the iframe's
  rect plus the control's local centre — so it is still a **trusted CDP click**, not a synthetic
  `element.click()`.
  - the result reports `frame: "main" | "child"` and `delivery: "cdp" | "in-frame"`
  - if the offset cannot be derived (nested frame, dynamic `src`), the fallback activates the
    marked control in-frame and says so, rather than silently pretending it clicked
  - frame traversal only runs when the top document embeds something, so pages without iframes pay
    nothing extra

### Verified

- `npm run test:dom` → **17 checks**, including a cross-origin consent iframe: answered with
  `reject`, `frame=child`, `delivery=cdp`, and the child's DOM confirms the click landed.

### Notes

- Isolated worlds share the DOM but **not** page globals: `window.__x` set by the page is invisible
  to frame evaluation, while attributes and DOM state are readable. Tests and any future frame work
  should assert on DOM, not on page variables.
- The 1.4.81 limitation ("CMPs inside a cross-origin iframe are left for a human") no longer holds
  for the common single-level embed.



### Added

- **`act(target_text: "…")` — anchor by visible text.** Some of the most-clickable things on the
  web have no semantics: React cards are a `<div>` with a handler three levels up, no role, no
  href, no `onclick` attribute. The resolver picks the **deepest** visible element whose own text
  matches, clicks the centre of its visible box, and lets the event bubble to whatever handler the
  framework attached. Ambiguous matches are refused with `AMBIGUOUS` plus the candidate list
  instead of clicking something arbitrary. Verified live on Mobalytics: clicking
  `"Harp Crossbow Ranged Build"` navigated to the build guide (`urlChanged: true`).
- **`find` reports live control facts.** Each match gets `facts: {visible, occluded, disabled,
  region}` from one injected expression for the whole match set, and the text projection appends
  `{occluded}` / `{hidden}` when the marks table alone would look identical to a clickable match.

### Fixed

- **Tall elements were being discarded as "occluded".** The hit-test used the rect's geometric
  centre clamped to the viewport edge; for a card taller than the viewport (872 px card in a 600 px
  viewport) that point landed on a sticky element, so the element was dropped from Set-of-Marks.
  Marks, control facts and `kqSafePoint` now hit-test the centre of the **visible portion**. This is
  why the Mobalytics build cards never received a mark.
- **Disabled controls vanished from `/dom/facts`.** They were filtered out because they accept no
  action — exactly the ones the guard needs to see. They are now described with `actions: []` and
  `disabled: true`.



### Added

- **Control facts — one description of an element, shared.** `src/main/primitives/control-facts.ts`
  builds a single injected expression that answers the questions marks, `find`, the decision guard
  and recipes all need: role, accessible name, value, state, accepted actions, visibility,
  occlusion (real hit-test), disabled, landmark region and rect. Exposed read-only at
  `POST /dom/facts`. Deliberately not wired into any hot path yet — that is Phase 2, and it lands
  once, in one place, instead of four slightly different copies.
- **Frame-scoped evaluation.** `src/main/browser/frame-eval.ts` walks the CDP frame tree and
  evaluates an expression in each frame's own isolated world, so cross-origin children (Sourcepoint
  consent, embedded checkouts) become reachable. `POST /evaluate` with `{frames:true}` returns
  `{frameId,url,ok,value,error}` per frame.
  - opt-in only; two CDP commands per frame
  - frame budget defaults to 8 (max 32), per-command timeout 1500 ms
  - isolated-world context ids cached per frame and invalidated on `did-start-loading`
  - blank frames skipped unless asked for; failures reported per frame, never thrown
- **`npm run test:dom`** — 10 live checks against a local fixture: onclick-only card, covered
  button (occlusion), hidden input, typed input, main-frame read, cross-origin child read,
  per-frame failure reporting, blank-frame skipping.



### Changed

- **Consent walls are answered like a person would, not stripped.** The automatic path now clicks
  the least-invasive real control the banner offers — "Reject all" / "Only necessary" before
  "Accept all" — with the visible cursor, once. Policy is `KUANG_CONSENT_POLICY=essential|accept|reject`
  (default `essential`). Auto-removal (`force_remove`) is reachable only through an explicit
  `dismiss_consent` call, never from the background sweep.
- **One answer per origin per session.** After a wall is answered — or deliberately left — the
  origin is remembered, so later navigations do not re-click it.
- **`dismiss_consent` reports what happened**: which intent won (`reject`/`accept`), the control
  text, coordinates, and whether the wall was left for a human.

### Fixed

- **The consent form flickering on/off.** The old sweep ran three timed attempts and passed any
  "Accept"-looking button to a click, so a CMP that re-rendered got clicked again (and the second
  click could land on whatever replaced it). Now there is one attempt, it is verified by the origin
  guard, and a wall that comes back is left alone.

### Known limitation

- CMPs rendered inside a **cross-origin iframe** (Sourcepoint on the Guardian, some Quantcast
  setups) cannot be reached by the main-frame DOM scan. Those are now reported as
  `blocked: "consent wall detected, no usable control — left for a human"` instead of being
  force-removed or clicked blind. Answering them needs frame-scoped CDP evaluation, which is not
  wired up yet.



### Added

- **A decision that needs a human now raises HIL.** When a guarded `decide` returns
  `accepted:false` — confidence under the threshold, or every option eliminated — Kuang raises the
  human-intervention request itself (banner, notification, window to front) listing the candidate
  options and why the guard rejected them, and answers the caller with `409
  HUMAN_DECISION_REQUIRED` plus `hil_id`, `options` and `reasons`. The agent is told not to guess
  and not to lower the threshold; it waits for the human, then re-observes. Previously this path
  returned `fallback: "agent"`, which is exactly an invitation to answer with a coin flip.

### Fixed

- **`scroll_page` silently did nothing when the wheel was swallowed.** On pages with a fixed
  header, a consent layer or a custom inner scroller, the wheel lands on something that does not
  scroll while the call still reported success (Mobalytics: document 2 783 px tall, `scrollY` stuck
  at 0). The scroll is now verified, and if the position did not change it scrolls the real
  container under the viewport centre and says so in the result. On the page that exposed it:
  `scrollY 0 → 700`, with `(wheel was swallowed — scrolled the active scroll container instead)`.



### Added

- **Settings → INPUT: human pacing knobs.** Pointer speed (px/s), typing speed (wpm) and click dwell
  (ms), persisted to `data/input-profile.json` and applied live over IPC — no restart. Env
  overrides exist for one-off runs: `KUANG_MOUSE_SPEED_PX_S`, `KUANG_TYPING_WPM`,
  `KUANG_CLICK_DWELL_MS` (plus the existing absolute `KUANG_CURSOR_BUDGET_MS`).
- **Speculative fan-out guidance for `decide`.** The OKF guide and the `decide` description now say
  to ask the operation head and every plausible target head (`click_target`, `type_text_target`,
  `select_target`, `done`) in the same call, then execute only the head matching the chosen
  operation — one round trip per step instead of operation-then-target. This mirrors the
  jev-ultrafast/TypeSafe loop, using the same `jev-1.13` backend we already call.

### Changed

- **Mouse pacing is distance-based.** The glide budget is now `distance / pointer speed`
  (default 1400 px/s, clamped 70–800 ms) instead of the previous fixed budget, and the path is
  sampled at most 12 times with the in-page trail drawn every third sample. A fast human crosses
  500 px in ~350 ms; a gaming mouse quicker. Measured on Skyscanner: click **4 094 ms → 1 700–2 000 ms**
  (originally 40 000–49 000 ms before the budget existed).
- **Typing cadence follows the WPM setting** (`12000 / wpm` ms per character, with extra pauses on
  spaces and punctuation) instead of a fixed 60–140 ms per key. Default 220 wpm ≈ 55 ms/char.
- **`wait_for` polls every 120 ms by default** (was 250 ms). Sites settle in tens of milliseconds,
  so the old interval added up to a quarter second of dead time per wait.



### Added

- **Browser history controls.** `←` / `→` / `⟳` in the header, wired to the same methods the
  MCP `navigate_history` tool and the right-click menu use; Alt+←/→ and F5 work when the shell
  has focus. `ChassisState` now carries `canGoBack` / `canGoForward`, read at broadcast time
  because SPAs navigate with `pushState` and tab switches swap the history stack, so the buttons
  disable at either end instead of silently no-oping.
- **Icon-only toolbar.** CORTEX, HARVEST, SETTINGS, ABOUT and REC became square icon buttons with
  daisyUI tooltips; the URL field lost its `max-w-2xl` cap and now takes the reclaimed width.
  REC's elapsed time moved into its tooltip, and the harvest spinner replaces the icon in place.
- **`observe(as:"components")` returns the machine table.** The MCP tool now emits a second text
  block with `{components:[{id,role,name,actions}]}` so it can be fed straight to
  `decide(state, guard:{components})` instead of being re-typed out of the prose projection.
- **When to use the decision model.** The OKF guide, the recommended-order resource and the `act`
  description now state the trade-off explicitly: ask `decide` when two or more controls
  plausibly match, the page is unfamiliar, or the question is a judgement ("is it done?"); use
  `find`/`act`/`navigate` when exactly one control matches. Every decision must be verified —
  `decide` chooses, it does not act or prove.

### Fixed

- **The floating Cyberdeck panel covered the page's scrollbar.** The browsing view spans the full
  window width, so a panel flush to the right edge sat on the scrollbar track. The panel (and the
  collapsed rail) is now inset by `PAGE_SCROLLBAR_GUTTER = 16` px, leaving the track draggable.
- **Tooltips rendered under the tab bar.** `#app-header` and `#tab-bar-container` were both
  `z-30`; the header is now `z-40` and every tooltip wrapper `z-50`, with `tooltip-end` on the two
  rightmost buttons so they do not run off the window edge.
- **`extract(kind:"list")` returned JavaScript source.** The container heuristic scored exact
  sibling-signature repeats, so a wall of inline `<script>` tags won on script-heavy pages
  (Skyscanner). Rows are now scored by content density, non-content subtrees (`script`, `style`,
  `template`, `svg`, `iframe`, …) are never scored or descended into, and the deepest winning
  container is preferred so one sponsored card cannot break the match. `collect_all` shares the
  fix.
- **`act(mark_id)` reported `<ELEMENT> ""`.** When a mark outlived the cached table the resolver
  fabricated an anonymous element. It now reads the live tag, accessible name and rect, so logs
  and deltas name what was actually clicked.
- **Clicks took 40–50 s on heavy pages.** `moveMouseTo` awaited one CDP `dispatchMouseEvent` per
  trajectory sample — up to 140 round trips to a busy renderer. The organic path is now sampled
  (max 28 points) with a hard `KUANG_CURSOR_BUDGET_MS` budget (default 900 ms) that jumps to the
  target when exceeded. Measured on Skyscanner: 4 094 ms → 1 010 ms for a near click,
  40 000–49 000 ms → 3 188 ms for the first far click (the remainder is one-time ghost-cursor
  injection).



### Added

- **`KUANG_WRAP_MAX_TOOLS`** now controls the generated-tool cap (default 40, max 200,
  `0` disables generated tools). It is a model-context budget, not an MCP limit — the
  protocol has no tool cap.
- **The cap is visible.** `wrap_list` reports `generated X/cap` and marks an exposed wrapper
  that is not registered (`tool (over cap: call wrap_run)` or
  `tool (disabled: KUANG_WRAP_MAX_TOOLS=0)`), and `wrap_create`/`wrap_update` append a warning
  naming the variable when a wrapper asks to be a tool but does not fit.

### Tests

- `npm run test:wrap:mcp` → 15: a second server with `KUANG_WRAP_MAX_TOOLS=1` registers the
  first exposed wrapper, warns about the second, exposes only one generated tool, and marks
  the over-cap wrapper in `wrap_list`.

## [1.4.76] - 2026-10-24

### Release scope since v1.4.5

This is the first release since **v1.4.5**. It carries the LLM-surface fix and the entire
Kuang Wrap server.

- **`llm_surface` / `llm_fetch` + `read_url`** — `"rendered"` is no longer a representation
  (`recommended` is `null` with a machine-readable `next`), results carry `scope` /
  `scope_mismatch`, and `read_url` reads any URL as Markdown (site-provided or a detached
  render, paged). Page-level Markdown alternates are also discovered from real
  `<a href="….md">` links. Fixes #1.
- **`kuang-wrap`** — a second, separate MCP server (slices S0–S5): wrapper store/executor/
  recipes, host-bound `safeStorage` credentials (static **and OAuth2 client credentials**),
  pagination (offset/cursor/link), `wrap_derive`, opt-in Cortex indexing, generated `wrap_<id>`
  tools with `tools/list_changed`, `AUTH_REQUIRED` handling, and `lastVerified`.
- **Settings** — lowercase hints on credential names, and an OAuth2 credential type.
- Docs — `docs/KUANG_WRAP.md`, including its blunt honest-limits section, plus a README section
  for the wrapper server.

### Fixed

- **`read_url` exposes its paging cursor machine-readably.** The formatted result only
  mentioned the next offset in prose ("continue with 36000"), so a caller had to regex the
  presentation text. It now reports a `next_cursor=<offset>` fact when truncated (matching
  `observe`), plus a copy-ready `continue:` line. Follow-up papercut from #1.

### Tests

- `npm run test:mcp:surface` gained two checks: `read_url` reports `next_cursor=N`, and
  passing that cursor advances the offset by the requested budget.

## [1.4.75] - 2026-10-24

### Added

- **OAuth2 client credentials (S5).** A credential can now be a static value or an OAuth2
  `client_credentials` client (`tokenUrl`, `clientId`, write-only client secret, optional
  scope/audience). Main mints a token with a policy-checked form-encoded POST, caches it
  encrypted until 60 s before `expires_in`, and re-mints on demand.
- **Expiry handling.** A call rejected with 401/403 triggers exactly one forced re-mint and a
  single retry. If it still fails the result is `AUTH_REQUIRED` (non-retryable) with a hint to
  update the credential or raise `request_human_intervention` — no silent 401 loop.
- **`lastVerified`.** A successful live run writes an ISO timestamp into the wrapper;
  `wrap_list` shows `verified YYYY-MM-DD` or `never verified`.
- Settings → Credentials gains a credential-type selector with the OAuth2 fields.
- `wrap_list` also marks generated tools (`· tool`), and `wrap_secret_list` marks OAuth2
  credentials.
- A blunt **"Honest status: what works, what doesn't, what is untested, what is risky"**
  section in `docs/KUANG_WRAP.md`, plus a new README section for the wrapper server that
  points at it.

### Changed

- `SecretStore.resolve()` is async and accepts `{ forceRefresh }`.

### Not implemented (documented)

- Human approval for mutating calls; OAuth2 grants beyond client credentials; wrap-side HIL
  notification; per-wrapper secret scope; retries/backoff; a Settings control for
  `exposeAsTool`.

### Tests

- `npm run test:wrap` → 50 (OAuth2 mint/cache/expiry/failure/validation, 401 refresh+retry,
  `AUTH_REQUIRED`, static-no-retry, `lastVerified`).
- The existing 11 MCP lifecycle and 46 live checks still pass.

Slices S0–S5 are complete.

## [1.4.74] - 2026-10-24

### Added

- **Generated tools (S4).** A wrapper with `exposeAsTool: true` now appears as its own
  `wrap_<id>` tool in the `kuang-wrap` server, taking the wrapper's declared arguments as a
  typed Zod schema converted from its JSON Schema (strings, numbers/integers, booleans,
  arrays, nested objects, enums, bounds, patterns, defaults, nullable, required/optional).
  Names are MCP-safe (`dummyjson.auth.me` → `wrap_dummyjson_auth_me`) and collision-free.
  Capped at 40 (first by id); the rest stay callable through `wrap_run`.
- Create/update/delete (and `wrap_reload`) reconcile the generated set; the MCP SDK emits
  `tools/list_changed`, so a connected client sees the change without a restart.
- Generated tools live only in `kuang-wrap`; the browser server's tool list is untouched.

### Tests

- New `npm run test:wrap:mcp` (11 checks): the generated tool appears after `wrap_create`,
  advertises the typed schema, executes the wrapper, rejects an out-of-range argument,
  disappears after `wrap_delete`, and emits `tools/list_changed` on both changes.
- `npm run test:wrap` extended to 41 (7 schema-conversion and tool-naming cases).

## [1.4.73] - 2026-10-24

### Added

- **Opt-in Cortex indexing for wrap recipes (S3 complete).** A recipe with `index: "cortex"`
  stores its rendered output in the local Cortex after a successful, non-dry run, so
  `recall_memory` can find it later. Documents mode indexes one page per rendered document;
  any other mode indexes one page for the whole result, so a 50-row table does not become 50
  embeddings. Capped at 50 documents per run.
- Indexing is **best-effort**: if Cortex is unavailable the call still succeeds and
  `indexed.error` is reported (the footer says `index failed: …` instead of `indexed N docs`).
  A dry run, an HTTP error, or a recipe without `index` writes nothing.
- `WrapRunResult.indexed { documents, chunks, error? }`; the executor's `indexDocuments`
  dependency is wired in main to `CortexDB.indexPage`, so chunks share the chunker/embedder
  used for browsed pages.

### Docs and tests

- KUANG_WRAP.md: S3 marked complete, a "Cortex indexing (opt-in)" section, open question 4
  resolved, and the test counts updated.
- `npm run test:wrap` gained 5 cases (per-document indexing, single-page table indexing, no
  opt-in, no indexing on dry run or an upstream error, and a non-fatal indexer failure) →
  34/34.

S3 is complete: derived recipes, documents mode, pagination, and Cortex indexing.

## [1.4.72] - 2026-10-24

### Added

- **`wrap_derive` (S3)** — infer a first-draft response recipe from a JSON sample or a live
  URL. It picks the first array it recognises (`items`, `results`, `data`, …), takes up to
  `max_fields` primitive fields from the first item, and returns `{ source, recipe }`; pass
  the recipe to `wrap_create` as `response`. The URL form is fetched through the executor, so
  it obeys the same outbound policy and never attaches a secret. The `kuang-wrap` surface is
  now ten meta-tools, with bridge route `POST /wrap/derive`.
- The executor's `test()` accepts `includeRaw`, so the derive route reuses the fetched JSON
  instead of issuing a second request.

### Tests

- `npm run test:wrap:live` extended to 46 checks: inline-sample derive, URL derive, and a
  non-JSON sample rejection.

## [1.4.71] - 2026-10-24

### Added

- **Recipe pagination (S3).** A wrapper whose recipe declares `pagination` now follows pages
  and merges them into one render. `offset` (limit/skip), `cursor` (a `next` token) and `link`
  (a next URL) are supported; `none` stays a single request. `maxPages` defaults to 10 (hard
  max 25) and `wrap_run { max_pages }` overrides it per call; `limits.maxItems` (default 50)
  bounds the merged result and stops paging once reached. Pages are concatenated and rendered
  once, so a 25-row result is one table, not three. One audit row per page, and `link` pages
  must stay on the wrapper's origin — every page URL still passes `assertSafeUrl`, so a
  hostile `next` cannot move the credential to another host.
- **`npm run test:wrap:live`** — a live integration suite (43 checks) against DummyJSON,
  covering request building, the outbound policy, argument validation, reads, documents mode,
  pagination, upstream errors, timeouts and writes. It runs inline wrappers through
  `POST /wrap/test`, so it never writes to the saved store; credential-dependent checks skip
  when no secret is bound to `dummyjson.com`.

### Changed

- `wrap_run` accepts `max_pages`; its footer now reports `pages n/cap (+more)`.

### Fixed

- The "credential-shaped query key" validation error claimed *"secrets are not enabled in
  this build"*, which stopped being true in S2. It now says query strings end up in logs and
  proxies and points at `request.auth`.

### Tests

- `npm run test:wrap` 29/29 (8 new pagination cases: offset/cursor/link, item cap, page cap,
  `hasMore:false`, non-list selections, and a failing second page).
- `npm run test:wrap:live` 43/43.

## [1.4.6] - 2026-10-24

### Added

- **`read_url` — read any URL as Markdown in one call.** It probes the site's own LLM-friendly
  surface and reads it when one is advertised, otherwise it renders the URL in a **detached view**
  (your active tab is never hijacked) and distils it to Markdown. It always returns Markdown text,
  so a caller never has to branch on `llm_surface.recommended`, and it reports `via`
  (`llm_fetch`|`render`), `scope` (`origin`|`page`), `scope_mismatch` and — when it rendered —
  `reason`. Paged with `max_chars` + `next_cursor`, because a ToS-style page exceeds one call.
- **Page-level Markdown alternates are also discovered from real anchors.** `llm_surface` now reads
  not only a declared `<link rel="alternate">` but any real `<a href="….md|.txt">` on the page
  (a "View as Markdown" link, or the page's own `.md` sibling that a site links to itself), ranked so
  a declared link or a same-page sibling wins. Anchors are **read from the page, never guessed**, and
  each alternate carries `source` (`link`|`anchor`) and `page_level`.

### Changed

- **`llm_surface` no longer reports `"rendered"` as a representation.** `"rendered"` sat in the same
  union as the fetchable kinds, so callers read it as "fetch the rendered variant" and got an HTTP 400
  from `llm_fetch`. `recommended` is now `null` when the site advertises nothing — a *representation*
  is fetchable, a *strategy* is not — and `llm_surface` returns a machine-readable **`next`**
  (`{tool:"llm_fetch", as}` or `{tool:"observe", as:"markdown"}`), so any caller that plans from
  `tools/list` can act without trial and error. Fixes issue #1.
- **`scope` + `scope_mismatch`.** `llm_surface` and `llm_fetch` now say whether a representation
  covers the whole site (`origin`) or the requested page (`page`), prefer a page-level alternate when
  one exists, and flag `scope_mismatch: true` when a page request can only be answered with a
  site-wide `/llms.txt` index — so a caller never silently summarises the wrong document.
- `llm_fetch` error classes are unchanged (`NO_LLM_SURFACE`, `FETCH_BLOCKED`); the gate message now
  names the render path explicitly.

### Fixed

- **A page URL could be answered with the site-wide index without saying so.** With both an
  `/llms.txt` and a page-level alternate present, `recommended` returned `llms_txt` first; a page now
  resolves to its own `markdown` alternate, and the origin index is returned (flagged) only when it is
  the only option.
- **`read_url` never answers a page with a site-wide index.** When the only surface for a page URL is
  an origin index (the issue's `core.telegram.org` case), it renders the page and reports
  `reason: "only the site-wide llms_txt index is available for this page"`, rather than handing back
  a different document. An explicit `as` still wins.

### Docs

- Descriptions, the OKF guide and the `mark-eleven://tools/recommended` resource, the default-tab
  Manual (regenerated), `README.md`, `docs/TOOL_CATALOG_REVIEW.md`, `docs/DECISION_MODELS.md`,
  `TODO_RESEARCH_CRAWL.md` §5, `src/mcp/README.md` and the plugin skill updated for the new shape.
  **63 advertised tools.**

### Tests

- `npm run test:llm` extended: `recommended: null` + `next`, `scope`/`scope_mismatch`, anchor
  discovery, and `read_url` fetch + render + paging. `npm run test:mcp:surface` now lists `read_url`.

## [1.4.5] - 2026-10-22

### Added

- **Timelapse recorder.** The REC button records the Cyberdeck window itself; **Settings → Recording** holds
  enable/disable, an output directory (with BROWSE), capture interval, playback fps, max width and bitrate. A
  frame is captured every `intervalMs` but stamped as if it were `1000/fps` apart, so a 10-minute session
  becomes a ~20-second video at the defaults — `MediaRecorder` cannot re-time frames, so this uses WebCodecs
  `VideoEncoder` + `webm-muxer` (VP9/WebM, no ffmpeg dependency).
- **`record_start`, `record_stop`, `list_recordings`.** `record_stop` returns the absolute `.webm` path (plus
  bytes, frames, video seconds and speed-up), and `list_recordings` lists recent files newest-first. The path
  is an ordinary string, so an agent can type it into a file-upload field that accepts a value — or hand it to
  a human when the field only opens a native picker.
- **Settings is now a full-viewport, tabbed view** — Decision Model, Recording and MCP Clients — instead of a
  small modal. The REC button shows the elapsed time while recording and opens the Recording tab when the
  feature is off; it sits where the static **STATEFUL** badge used to (that badge was a label for session
  persistence, not a control).
- **Human-only switch for the recording tools.** *"Let agents use the recording tools"* is stored in the
  recording config but has no tool or HTTP writer: only the Settings panel can flip it. While off, the three
  recording tools are not registered in `tools/list` (the MCP server probes `/recording/status` at startup), and
  the bridge refuses them with `RECORDING_TOOLS_DISABLED` — so an already-connected agent loses access too.
- **Settings → MCP Clients**, a copy-ready config generator for OpenCode, Claude Desktop, Claude Code, Cursor,
  VS Code, Windsurf, Google Antigravity, Gemini CLI, Atomic Chat, Zed and a generic `mcpServers` block. It fills
  in the absolute server path and bridge port, and can emit either the **bundled** runtime
  (`ELECTRON_RUN_AS_NODE=1`, no Node install required) or **system Node**.

### Fixed

- **Installed builds could not run `bin/mcp-server.cjs` from the asar.** `electron-builder` now unpacks
  `bin/**/*`, and the app copies the server to `userData/bin/mcp-server.cjs` (refreshed on update) so the path
  generated by the MCP Clients tab stays valid for portable and AppImage builds, whose `resources/` is temporary.
- **The update feed did not match the uploaded asset names.** electron-builder writes hyphens where the file
  name has spaces (`Kuang-Grade-Mark-Eleven-Setup-1.4.5.exe`), but GitHub stores those spaces as dots
  (`Kuang.Grade.Mark.Eleven.Setup.1.4.5.exe`), so every updater download would have 404'd. The 1.4.5
  `latest*.yml` files now name the real assets, and the CI publish job renames spaced files to hyphens before
  upload so future releases match by construction. Verified with HTTP 200 on the Windows, Linux and macOS
  feed URLs.

### Changed

- The tool surface is now **62 always-advertised tools** (+2 optional decision tools); 82 registered entries.
  The README table, the generated Manual list and the counts in both were regenerated with `npm run manual:tools`.

### Notes

- `webm-muxer@5.1.4` is deprecated upstream in favour of Mediabunny (≈11 MB unpacked). It is kept because it is
  ~147 kB unpacked and the API is contained to `src/renderer/recording.ts`, making a later swap mechanical.
- Capture rate is best-effort: software VP9 encoding of a 1280px window can take a few hundred milliseconds per
  frame, so the interval is a floor rather than a guarantee.

## [1.4.4] - 2026-10-22

### Added

- **Auto-update from GitHub Releases** (Windows and Linux). `electron-updater` checks 30 s after startup and
  every 6 h, downloads in the background (sha512-verified against the published `latest.yml`), installs on
  quit, and the HUD shows *"Update v… found — downloading…"* followed by a **RESTART** action. Deliberately
  conservative: **off in dev builds** (`app.isPackaged` false) and **off on unsigned macOS**, where Squirrel.Mac
  refuses to apply updates — it comes back on when the Developer ID arrives. `electron-builder` now declares a
  GitHub `publish` provider so the feed metadata points at this repository.
- **`KUANG_BRIDGE_PORT`** — the HTTP bridge port is configurable (still 4111 by default), so a dev build and an
  installed build can run side by side. Point the second MCP server at it with `KUANG_BRIDGE_URL`.

### Fixed

- **A port collision used to fail silently.** Dev and installed builds shared 4111 and have separate
  single-instance locks, so both could run: the second bridge logged `EADDRINUSE` and kept going **without a
  bridge**, while the MCP tools drove the other window. The log now names the cause and the fix, and the
  README documents running two instances.

## [1.4.3] - 2026-10-21

First release with **downloadable installers**, built by CI on GitHub runners.

### Added

- **Windows** — `…-Setup-1.4.3.exe` (NSIS, choose install directory), `…-Portable-1.4.3.exe`, `…-1.4.3-win.zip`.
- **macOS** — `…-1.4.3.dmg` and `.zip`, **x64 and arm64**. **Unsigned**: Gatekeeper blocks the first launch;
  right-click → **Open**, or `xattr -dr com.apple.quarantine "/Applications/Kuang Grade Mark Eleven.app"`.
  No macOS auto-update until a Developer ID is borrowed (Squirrel.Mac refuses unsigned bundles).
- **Linux** — `…-1.4.3.AppImage` (the only self-updating format), `.deb`, `.tar.gz`.

### Fixed

- **`electron-builder` needs `author.email`** for the `.deb` maintainer field — that was the only Linux build
  failure; `package.json` now carries a proper author.
- **The host-pinned `electronDist` is gone.** It pointed at `node_modules/electron/dist`, which does not exist
  on a pnpm checkout, and broke packaging on **every** platform including Windows.

### Notes

- Windows is unsigned for now (SmartScreen warning, install works). macOS is unsigned as decided — see above.
- `portable` never self-updates; `deb`/`tar.gz` are manual upgrades.
- Builds are artefacts of `.github/workflows/build.yml`; publishing them to a release is a deliberate step
  (see `docs/BUILDING.md` §4).

## [1.4.2.4] - 2026-10-21

### Added

- **Cross-platform build pipeline (scoped + phase 1).** [`docs/BUILDING.md`](./docs/BUILDING.md) covers installers
  for all three platforms, signing (macOS ships **unsigned first**), GitHub Releases, and `electron-updater` — with
  the key interaction that **four-part tags are documentation-only**: the updater compares the three-part app
  version, so anything shipping binaries must bump `package.json` and tag exactly.
  `.github/workflows/build.yml` builds on `windows-latest` / `ubuntu-latest` / `macos-latest` (artefacts only,
  unsigned), dropping the host-pinned `electronDist` on non-Windows so the correct Electron is packaged.
  `scripts/check-release-tag.mjs` fails a release build when a tag is four-part or does not match `package.json`.
- **The manual now documents the decision layer.** A new section in the default-tab manual covers the optional
  `decide` / `drive` tools, the split (model picks the component, the agent supplies text, Kuang verifies), guard +
  elimination, gate hand-offs, the screenshot limitation on the OpenCode gateway, and the measured bench numbers.
  The manual's tool heading and paragraph state **59 advertised · +2 optional**, matching the shaded rows.

### Fixed

- **UTF-8 BOMs removed** from `package.json`, `kuang_docs/okf.json` and three TypeScript files (left by earlier
  PowerShell writes). Strict JSON parsers — including the new release-tag check — rejected `package.json` until
  this was fixed.

## [1.4.2.3] - 2026-10-21

Small increment: the optional tools are rows in the tool table, not a footnote.

### Changed

- **`drive` and `decide` now appear in the README tool table** — marked `⌥`, listed first, with a one-line
  description saying they are the primary tools when a decision model is configured and absent otherwise. The
  separate "+2 optional" blurb is down to a single sentence.
- **The manual generator understands the `⌥` marker:** optional rows are excluded from the advertised count
  (still 59, so the guard holds), rendered first, and shaded amber with a legend ("rows shaded amber are
  optional: they appear only when a decision model is configured, and are then listed first").

## [1.4.2.2] - 2026-10-21

Small increment: the optional decision tools are advertised **first** when active, and the docs say so.

### Changed

- **`drive` and `decide` are registered at the top of `tools/list`** when a decision model is configured —
  the goal-driven loop is the most interesting thing on the surface when it is available, and it was buried
  among 59 browser tools. When no model is configured they are still absent entirely. Verified through the
  real stdio server: `tools: 61`, `first 5: drive, decide, navigate_to, press_key, scroll_page`.
- **README states the surface honestly:** badge is `59 +2 optional`, the tools section heading is
  `59 advertised · +2 optional`, and a note explains that the two appear only when configured and are
  listed first. The `**59 advertised tools**` claim is unchanged for the default surface, so the manual
  generator's guard still holds.

## [1.4.2.1] - 2026-10-21

Documentation-only increment: the README navigation index, and the versioning rule for four-part tags.

### Changed

- **README index moved to the top.** It now sits directly under the logo/badge block instead of after the
  intro, the release notes and the architecture principles — i.e. where you actually start reading. All 24
  links resolve (explicit `<a id>` anchors, not GitHub heading slugs).
- **Versioning:** small increments take a fourth number in the tag/release (`v1.4.2.1`); `package.json` and
  `APP_VERSION` stay three-part because npm and electron-builder require semver.

## [1.4.2] - 2026-10-21

### Added

- **`drive` — the observe → decide → act loop, in code.** Optional (like `decide`): with a decision model
  configured, `drive({ goal, values })` repeats `observe(as:"components")` → guarded `decide` → verified
  `act` until the goal is reached or it must stop, with **one decision call per step** instead of an agent
  turn per step. Plumbing, not policy: fixed questions, no goal interpretation, and **no text generation** —
  a `type_text` step without a supplied value returns `status:"needs_input"` naming the field. Typed stops:
  `done` · `blocked` (no deterministic gate matched → the agent decides) · `human_required` (age/CAPTCHA,
  hand-off raised) · `needs_agent` (guard rejected everything / contradiction) · `failed` · `max_steps`, with a
  per-step transcript and `dry_run`. Measured on the Skyscanner London→Maldives form: **4 steps in 18 s**
  (destination, autocomplete commit, both dates), then an honest `needs_agent`.
- **`scripts/drive-example.mjs`** — the same loop in ~80 lines against the plain HTTP API, for runners that
  want their own retries, logging or policy. Both paths share the guard, verification and the ledger.
  `npm run drive -- --url … --goal … --values '{…}'` runs it.

- **`decide(include_screenshot: true)` — the model can see the page.** The viewport is captured, scaled into
  TypeSafe's image limits (longest side ≤ 1568, shortest ≥ 280) and attached as an image asset referenced
  from the state, with the `TypeSafe-Danger-Zone-Images` header. Useful where text and the component table
  are not enough: a CAPTCHA, an age gate, or a modal that looks like a form. **The OpenCode gateway does not
  forward headers** (verified with a direct request: identical 400 with and without it), so images are
  **disabled up front** when the configured endpoint is `opencode.ai` — the result says
  `screenshot: "disabled: the OpenCode gateway does not forward TypeSafe headers — images only work against
  api.typesafe.ai"` and no call is wasted. Screenshots work against `api.typesafe.ai` with a TypeSafe key; the
  local ONNX models are text-only and say so. (A 400 mentioning "Images are experimental" from any other
  gateway is still retried once without the image, as a safety net.)
- **`act` warns when a click target sits behind a gate.** It does not refuse — a human may have resolved the
  hand-off and asked for exactly that click — but the result carries `warning` naming the wall, so an agent
  cannot claim it was not told.

### Changed

- **A sensitive gate now raises the human hand-off itself.** `decide` returning `409 HUMAN_REQUIRED` used
  to end with advice ("call `request_human_intervention`") and nothing else — nothing was actually asked.
  Kuang now opens a HIL request for the page (reason + the matched lines) as part of the gate, skipped while
  another request is already open, and **without blocking the 409** (the intervention's promise resolves when
  the human acts, which can take minutes). On `/r/petite` the banner appears with *"Verify your birthday to
  continue"* attached; the decision still spends no model call.
- **An *undetermined* wall goes to the agent, not the human.** If the model answers `blocked` but no gate copy
  matches, the result is a normal decision carrying a hint ("if this is a compliance boundary — age, CAPTCHA,
  payment, identity — call `request_human_intervention`; otherwise choose the next step yourself"). Human
  attention is spent only on a boundary Kuang can name and quote.

### Fixed

- **The HUD could not select text.** The shell's `<html>` carried Tailwind's `select-none`, so nothing could
  be highlighted and right-click Copy had nothing to copy. Removed for the shell (the tab strip keeps it).
  Page content was never affected — the Set-of-Marks overlay and the phosphor cursor canvas are both
  `pointer-events: none`, and agent input goes over CDP.

## [1.4.1] - 2026-10-21

### Fixed

- **`dismiss_consent` never worked.** Its injected scan script contained a TypeScript cast
  (`(el as HTMLInputElement).value`) inside the string that is evaluated **in the page** — a syntax error,
  so every call failed with *"Script failed to execute"* and no consent wall was ever dismissed by the
  dedicated tool. Replaced with plain `el.value`.
- **Consent walls that appear after the page loads were missed.** Navigation armed a single dismissal at
  1.8 s; walls that mount later (hydration, redirect, or post-login — Reddit's cookie dialog arrives after
  sign-in) were never seen. `navigate_to` and `new_tab` now arm a **sweep at 0.9 s / 2.6 s / 6 s**, each
  attempt gated by a consent-only DOM check so an automatic sweep can never close an ordinary dialog.
- **The HIL banner covered the tab strip.** It was anchored top-right, exactly where the panel tabs and
  their COPY buttons live, so clicks and right-clicks there hit the banner. It now sits at the bottom-right,
  above the footer, still clear of the browsing viewport.

### Added

- **Right-click menu on the shell itself.** The context menu was only attached to browsing tabs, so
  copy/paste/select-all/inspect did nothing anywhere in the HUD. The Cyberdeck window now has the same menu
  (copy, paste, cut, select all, inspect element, DevTools), acting on the shell's own renderer.
- **`npm run test:consent`** — local fixture proving a consent wall injected 1.5 s after load is dismissed,
  and that an ordinary "session expiring" dialog is left alone (2 checks).

## [1.4.0] - 2026-10-21

### Added

- **Age verification and CAPTCHA are hard human hand-offs.** Before any model call, `decide` scans the state
  — and, for guarded calls, the **live page text** (`include_page_text`, on by default with
  `guard`/`eliminate`) — for age-gate copy ("verify your age/birthday", "birthday to continue", "18 or
  older", "adult content", "mature content", …) and for CAPTCHA / "verify you are human" copy. It returns
  **HTTP 409 `HUMAN_REQUIRED`** with the `gate` kind and the matched lines — **no model call, no elimination,
  no retry**. A confident answer cannot out-vote it, because the rule is "do not decide at all", and a
  `Date of birth` signup field does not match (tested both ways). New: `src/main/decide/sensitive-gate.ts`.
  The `/r/petite` run is the worked example: the component table exposed only "Not Now" / "Verify", the page
  said *"Verify your birthday to continue. This page may contain mature content."*, and the gate now stops
  there in 1 ms without asking the model — after an earlier run had wavered at `click` 0.44.
- **DECISIONS is the first tab whenever a decision model is active**, and is selected on reveal, so the
  live view of what the model is choosing is the default panel instead of something to hunt for.
- **The HIL banner no longer covers the page.** It was centred across the app with `alert-warning`; it is now
  anchored to the side panel (top-right, max 420 px), so a human being asked to act can still see the
  browser. It is also built with `textContent` instead of `innerHTML` — the reason can quote page copy (the
  sensitive-gate rule puts matched lines in it), and page copy is attacker-controlled.
- **Input-method ladder for typing — fixes the field that ignored keystrokes.** When real keystrokes
  provably reached the page and changed nothing, `act(type)` now retries the same text through **CDP
  `Input.insertText`** (no key events, but `beforeinput`/`input` fire — accepted by components that filter
  `keydown`), then through a **real clipboard paste** (restoring the previous clipboard afterwards), and
  re-verifies each rung. The outcome reports `typing.channel` (`keys` / `insertText` / `paste`) and
  `typing.attempted`; the ledger records them. A field that swallows keydown is now filled (verified in
  `test:act`: `channel=insertText`, value `740106`); a control that rejects every channel still returns
  `TYPE_NO_EFFECT`, but the hint now says *"rejected every input channel — keystrokes, CDP text insertion
  and clipboard paste… call request_human_intervention"* instead of blaming focus.
- **Docs: who writes the typed text, and HIL as a decision.** Jev never generates text — it decides that an
  operation is `type_text` and which field; **the agent** supplies the string. Kuang ships no generation
  model (jev-ultrafast embeds one because it owns the loop; ours is the caller). Human-in-the-loop is
  documented as a pair of questions (`handoff` noul + `handoff_for` choice) that the runner turns into
  `request_human_intervention`, with a roadmap note for an optional small text helper behind the same
  off-by-default config.
- **`decide` guard + elimination — the fallback ladder.** A decision is now checked before it is trusted:
  confidence below `guard.threshold`, a target that was not in the offered `guard.components`, a target whose
  `actions` do not include the operation, or a `done` answer contradicting the operation are all **rejected**.
  With `eliminate:{max_attempts}`, the rejected option is removed from that question and the model is asked
  again with what's left (capped at 5). When everything is eliminated the call returns
  `accepted:false, exhausted:true, fallback:"agent"` with `reasons`, `rejections` and `removed` — **no action
  is taken and the agent decides**. Ladder: model → eliminate + retry → agent. Covered by six new checks in
  `npm run test:decide` (17 total), including "the retry no longer offers the eliminated option".
- **DECISIONS tab in the HUD — shown only when a decision model is configured.** Mirrors every call to the
  decision model as it happens: backend + model, latency, each question with its type, the answers (choice +
  confidence, `noul` as yes/no with probability, score + level) or the typed failure, and a truncated state
  preview. It appears when a backend is saved in Settings and disappears when the backend is set to Off, so
  the panel never advertises something that isn't there. Backed by a ring buffer (last 50 calls) in the main
  process, exposed as `GET /decisions` so an agent can inspect what the model decided without scraping the UI.
- **Native right-click menu in browsing tabs.** A `WebContentsView` has no default context menu, so
  copy/paste/select-all, link and image actions, reload and **inspect element** were unreachable by hand
  even though the API had them. Each right-click now builds a menu from the click's own context: Undo/Redo/
  Cut/Copy/Paste/Paste-as-plain-text/Select-all in editable fields, Copy + "Search the web for …" over a
  selection, Open-in-new-tab / Open-in-system-browser / Copy-link-address over a link, Copy image / Copy
  image address / Save image as… over an image, plus Back/Forward/Reload, Copy page URL, Copy as Markdown
  link, Inspect element (opens DevTools at that pixel) and Open DevTools. Actions are issued against the
  tab's own `webContents`, because Electron menu roles target the focused window — which here is the shell,
  not the tab. Spellcheck suggestions are included when Chromium has them.
- **Settings tab (HUD) for the decision model.** A `⚙️ SETTINGS` button opens a dialog with the
  backend (`off` / `typesafe` / `d1-onnx`), model, endpoint, key, revision and device, a status badge
  showing what the app will actually use, and **Test connection** — which runs a real one-question
  `decide` and shows either the answer with its latency or the typed failure (`NOT_CONFIGURED`,
  `UPSTREAM_ERROR`, `TIMEOUT`). Saving writes `data/decision.json`, the same file the bridge and the
  MCP server read, so there is one source of truth; the key is stored locally and never logged.
  IPC: `settings:get-decision` / `settings:save-decision` / `settings:test-decision`.
- **`decide` — an optional decision-model surface, off unless configured.** One tool (and `POST /decide`
  on the bridge) that forwards `state` + typed `questions` to a decision model and returns the answers
  **verbatim**: no prompt assembly, no rewritten retries, no synthesis, and `UPSTREAM_ERROR`/`TIMEOUT`
  with **no answers** when the upstream fails. When nothing is configured the tool is **not registered**
  at all (`POST /decide` still answers `NOT_CONFIGURED` with setup instructions, and `/health.decision`
  reports the state). The MCP tool list is built when the stdio server starts, so a newly saved backend
  appears after the MCP server reconnects; the bridge picks it up on the next call.
  Two backends, chosen by config rather than code: **hosted Jev** (`protocol:"typesafe"`, e.g.
  `jev-1.13`) and **in-process ONNX** (`protocol:"local-onnx"`, via `open-jev`). Config lives in env vars
  or `data/decision.json` (gitignored). See [`docs/DECISION_MODELS.md`](./docs/DECISION_MODELS.md).
- **`npm run bench:decision`** — measures a local model on four page states (goal + component table,
  targets restricted by `actions`) and prints field accuracy + latency. Measured: `kev-0.6b` **5/12**
  (p50 1,118 ms), `open-jev` **7/12** (p50 750 ms) — both mechanically sound, both out of domain. That
  is why the local path is labelled experimental rather than recommended. (LiquidAI's d1-3B is **not**
  loadable by `open-jev`: its `detectFamily()` only understands `open_jev`/`kev` configs and d1 is
  `lfm2_vl`; the model card's snippet does not work against the published library.)
- **`npm run test:decide`** — offline contract test with a mock upstream (11 checks): unconfigured is
  loud, state/questions reach the model byte-for-byte, the bearer key is sent, answers and latency come
  back untouched, and an upstream 500 surfaces as `UPSTREAM_ERROR` with no fabricated answers.
- **`observe(as:"components")` — a decision-ready component table.** Instead of a flat mark list, each
  component carries its **role**, accessible **name**, current **value**, **state**, **region** (the
  nearest landmark: `form`, `dialog`, `nav`, `main`, …) and the **actions it actually accepts**
  (`click` / `type` / `select`; empty when disabled). Components are grouped by landmark in the text
  rendering, collected through open shadow roots like the rest of Set-of-Marks, and their ids **are
  mark ids**, so a decision ("click [8]") executes through `act(mark_id)` with no translation layer.
  ```
  ## form · Signup
  [7] input    "Email"       {type}
  [8] input    "Password"    {type}
  [9] button   "Create account" {click}
  ```
  The affordance partition is the point: a target head for `click` is only ever offered clickable
  components, so the model cannot pick a textbox for a click. Inspired by the dynamic action space in
  [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) — with one difference: their
  element table explicitly excludes shadow roots, ours includes them.

### Fixed

- **The age-gate rule fired on pages that merely *mentioned* a gate.** The patterns included bare
  `captcha`, `18+`, `18 or older`, `adult content` and `mature content`, and guarded calls scan the page
  text — so documentation, forum posts and our own manual (which documents reCAPTCHA) tripped it. The rule
  is now **verb-anchored gate copy only** ("verify your age/birthday", "birthday to continue", "are you 18",
  "must be 18", "adults only", "age-restricted", "18+ only/required/content", "reCAPTCHA/hCaptcha/Turnstile",
  "verify you are human", "I'm not a robot", "human verification"), scans only the **first 1200 characters**,
  and **ignores app-internal pages** (`mark-eleven:`, `about:`, …). Verified: `github.com/login` answers 200
  with no gate; `/r/petite` still stops at 409 in 1 ms.
- **Copying out of the HUD was unreliable.** The right-click Copy used `wc.copy()`, which acts on whatever
  has focus in the tab — and opening a native menu can move focus to the shell, so the clipboard stayed
  empty. It now writes the click's own `selectionText` when there is one, and focuses the tab before
  Cut/Paste/Undo/Redo/Select-all. **MATRIX LOGS** and **DECISIONS** also gained a **COPY** button that writes
  their content through the main process (`app:copy-text`), so copying never depends on selection or focus.

- **Submit inputs were labelled with their `name` attribute instead of their visible label.** GitHub's
  `<input type="submit" name="commit" value="Sign in">` appeared in marks and the component table as
  `"commit"` — a meaningless identifier to any reader, human or model. Accessible-name computation now
  prefers `value` for `submit`/`button`/`reset` inputs before falling back to `name`.

### Changed

- **Decision-model docs corrected: TypeSafe `choice` takes `criteria`, not `options`.** The docs and the
  `decide` parameter example used `options: [...]`, which the OpenCode gateway rejects with
  `422 "Upstream request failed: Endpoint is unavailable."` — an error that reads like an auth failure or an
  outage and cost an afternoon of credential hunting. `criteria` is an option → description map; `noul` and
  `score` are unaffected. open-jev (the local path) still takes `options`.
- **Measured on the four-case page bench** (`npm run bench:decision -- --bridge`), with real criteria
  descriptions and the same information given to each model: **Jev 1.13 10/10 at 376 ms p50**, versus
  `kev-0.6b` 7/10 at 830 ms and `open-jev` 6/10 at 1,252 ms. The descriptions matter — `kev-0.6b` scored
  5/10 with bare option keys, and Jev's only earlier miss (CAPTCHA → `click`) disappeared once the `blocked`
  criterion described a wall. Jev is now the recommended backend; the local ONNX path stays experimental.

## [1.3.0] - 2026-10-20

### Fixed

- **Punctuation was silently swallowed while typing — `.` and `'` especially.** `keyDescriptor()` in
  `input-simulator.ts` used the character's **ASCII code as its Windows virtual-key code**, and ASCII
  collides with real VKs: `'.'` is 46 = `VK_DELETE`, `"'"` is 39 = `VK_RIGHT`. Chromium honours those as
  editing/navigation commands rather than inserting the character, so `act(action:"type")` typed
  `gmail.com` as `gmailcom` and corrupted any password containing `'` — with **no error, no failed
  post-condition and no delta** to give it away (the same silent-no-op shape as the `clear_first` bug
  below). Punctuation now maps to its real US-layout VK (`Period` 190, `Quote` 222, `Semicolon` 186,
  `Digit1`–`Digit0` for the shifted symbols, …). Covered by a new `npm run test:primitives` check that
  types all 32 printable punctuation characters and asserts an exact round-trip (37 checks total).

- **`clear_first` was a dead parameter — typing silently appended.** `act(action:"type")` had no way to
  replace an existing value, and the older `type_mark(clear_first)` flag was advertised but dropped by
  the bridge before it ever reached the chassis. Typing into a pre-filled field (e.g. an origin/airport
  box already reading `Exeter (EXT)`) therefore **appended**, corrupting the value and making the form
  look broken — which in turn masqueraded as "dropped clicks" when the invalid form refused to submit.
  `act` now takes **`clear_first: true`**, wired end-to-end (catalog → bridge → primitives → chassis →
  simulator) and implemented as a trusted **Ctrl+A + Backspace** (so React/Vue controlled inputs still
  update and `isTrusted` stays true — no synthetic `el.value` writes).
- **Guidance for the failure mode.** The `act` description, the OKF guide and `SKILL.md` now state that
  typing appends by default; a new OKF recipe **R6 — pre-filled fields & autocompletes (comboboxes)**
  covers committing an autocomplete by clicking the option mark, and warns against blindly re-clicking:
  a form silently rejected by validation looks exactly like a dropped click, and input is CDP-delivered
  (focus-independent), so a "lost focus" window is rarely the real cause.
- Covered by a new `npm run test:primitives` check: append by default, replace with `clear_first`.

- **`observe(as:"markdown")` was blind to shadow DOM, so web-component pages harvested as empty.** The
  harvester was fed `document.documentElement.outerHTML`, which **stops at the shadow boundary**: a
  `<faceplate-text-input>`-style control serialised as an empty host tag, and a live signup form (the exact
  flow in [`docs/FIELD_NOTES_2026-10-20_SIGNUP.md`](./docs/FIELD_NOTES_2026-10-20_SIGNUP.md)) came back as a
  skip-link, a heading and `chars=460/460` while the page held 331 KB of DOM. Serialisation now walks the
  **composed** tree (`src/main/harvester/dom-serializer.ts`): light children plus every open shadow root,
  recursively, with live form state baked in as attributes (`value`, `checked`, `selected` are properties,
  so `outerHTML` never showed them) and **password values reduced to a length**. Unrendered controls are
  dropped rather than harvested: a hidden CSRF input or a `display:none` recaptcha response textarea used to
  arrive as multi-kilobyte token text — on `reddit.com/register` the construct is 391 characters of real
  content instead of 2,752 characters of which ~2,300 were one Google token. `shadow_roots` in the envelope
  reports what was pierced.
- **The markdown cut at 25,000 characters was unreachable — `budget`/`next_cursor` paging was a dead end.**
  The truncation happened inside the harvester, so the remainder was already gone before `observe` could
  page it. Truncation now happens in `pageText`: the construct is whole, `total` is honest, and paging walks
  to the true end (a 167,000-character fixture pages in 18 calls). Markdown gets a 25,000-character default
  *view*; `budget: 0` returns everything.
- **`<select>` lost its current value, and every control rendered as a stray quoted string.** A `<select>`
  showed no selection (the `selected` attribute was stripped during serialisation and never rebaked), and
  inputs rendered as `<input type="text" "Email">`. Controls now render with stable labels —
  `<input type="text" label="Email" value="a@b.com">`, `<select label="Day" value="2" options="1,2,3">`,
  `<textarea label="Notes">…</textarea>` — read from attributes rather than DOM properties, because Turndown
  parses with **domino**, which does not implement `select.value` or `selectedOptions`. Relative links and
  image sources are resolved to absolute URLs so they can be followed without knowing the page URL.

- **`act` could not reach a control inside a web component — and reported success anyway.** A CSS
  selector cannot cross a shadow boundary, so `act({selector:"faceplate-text-input"})` resolved the
  *host*, clicked its centre (often a label), then applied `el.focus()` to the host — which either did
  nothing or moved focus off the inner `<input>`. The value never changed and the call returned a
  cheerful success (the exact failure in
  [`docs/FIELD_NOTES_2026-10-20_SIGNUP.md`](./docs/FIELD_NOTES_2026-10-20_SIGNUP.md) §2.2). Targeting
  now lives in `src/main/primitives/dom-targeting.ts`: selectors are searched through open shadow roots,
  a custom-element host resolves to **the control a mouse would actually hit** (deepest control at the
  host's centre, else the first control inside), and the focus nudge is applied to *that* control and its
  result reported, not assumed. A selector may also now name an element *inside* a shadow root
  (`#email`), which previously could only be reached by coordinates.
- **Typing is verified — a silent no-op is now a structured failure.** `act(action:"type")` used to
  return `Typed text (N chars) with variable human cadence` whether or not a character landed. It now
  installs a one-shot in-page probe (the control's value plus counters for trusted `keydown` /
  `beforeinput` / `input` events), reads it back after typing, and returns **`ok:false` with
  `error.code: "TYPE_NO_EFFECT"`**, a `typing` evidence object (`beforeLength`, `afterLength`, `changed`,
  `keydowns`, `beforeinputs`, `inputs`, `landed`) and a hint. The counters separate the two causes that
  used to look identical: `keydowns: 0` means the input never arrived (occluded click, unfocused window,
  0×0 viewport), while events-with-an-unchanged-value means the control **rejects** synthetic input —
  one-time-code/OTP fields, which is what happened in §2.3 of the field notes. The hint names
  `request_human_intervention` for that case. Only lengths and counters leave the page, so `secret`
  typing stays secret.
- **Field facts now resolve through shadow roots.** `act`'s `target.field` returned `null` for any
  web-component control (the host is not input-like), so the typed-facts feature was silent exactly
  where forms are most common. It now reports the inner control, its real value length, and
  `inShadowRoot: true`.
- **A 0×0 viewport no longer produces a confident click at the wrong place.** A freshly-created tab can
  report a 0×0 viewport before layout settles; geometry resolved then is meaningless — during testing
  this clicked `(31, 0)` on a fixture whose button sat at `(231, 90)` and still returned success. Both
  `act` and the chassis now refuse to act on a 0×0 viewport and say why (`NO_TARGET` / an explicit
  error), rather than clicking a point derived from nothing.
- **The failure diagnostic reads the deepest focused element.** The `act` triage hint compared
  `document.activeElement` (the host) against the target tag, which false-positived on shadow controls;
  it now descends `shadowRoot.activeElement` chains, so "focus is on <x>, not the target" is true when
  it is said.
- **Set-of-Marks and `find` were blind to shadow DOM.** Candidate collection used
  `document.querySelectorAll(SEMANTIC)`, so a web-component form produced **0 marks** while its buttons were
  plainly visible; even when a shadow control was reached, the occlusion check (`document.elementFromPoint`
  returns the *host* for shadow content) would have discarded it as covered, `closest()` stopped at the
  shadow boundary for popup/visibility classification, and stamped ids were resolved with
  `document.querySelector('[data-mark-id]')`, which cannot see inside a shadow root. Marks now walk **every
  open shadow root**, hit-test the deepest element, use composed containment for occlusion, composed
  ancestor walks for `aria-hidden`/popup/static classification, and resolve marked elements through shadow
  roots — so `find`, `act(mark_id)` and the inline `[#id]` badges in `observe(as:"markdown")` all work on
  shadow controls. On the field-notes signup fixture the mark list went from empty to
  `#1 <INPUT> "Email"` plus the shadow button, and `act(mark_id=#1, type)` lands in the inner input.

### Added

- **`npm run test:act`** — live fixture for the interaction path (19 checks): typing through a
  custom-element host lands in the inner input, a selector inside a shadow root actuates a shadow
  button, a reverting one-time-code field returns `TYPE_NO_EFFECT` with the right hint, the ledger
  records `landed:false`, `clear_first` works inside a shadow control, an identical retype is not
  mistaken for a no-op, Set-of-Marks badges the shadow controls and `find` returns them, `act(mark_id)`
  types through a mark into a shadow input, `observe(as:"markdown")` carries the `[#id]` badge, and an
  unresolvable selector fails loudly.
- **OKF recipes R7 (web components: the host is not the control) and R8 (read it back)** in
  [`kuang_docs/partitions/primitives_and_workflows.md`](./kuang_docs/partitions/primitives_and_workflows.md).
- **`npm run test:markdown`** — live fixture covering the composed-DOM harvest (shadow text, shadow controls,
  value baking, password redaction, select state, absolute links), envelope minimalism, harvest stability
  across two calls, paging to the end of a 167 KB construct, and the text-free-page message (20 checks).
- **Action ledger — a local dataset for a decision layer** (`src/main/telemetry/action-ledger.ts`). Every
  **executed** action now appends one JSON line to `data/transitions.jsonl` (gitignored, local-only): the
  page-state signature before/after (`url`, `revision`, mark count), the resolved target, the delta, the
  `await_conditions` result, the rule-based triage hints, and the duration. **Typed text is recorded as a
  character count only** — never the string, plus the `secret` flag. Writes are queued and non-blocking and
  errors are swallowed, so a ledger failure can never break an action; the file rotates to
  `transitions.1.jsonl` past 5 MB. Rationale and usage: [`docs/DECISION_MODELS.md`](./docs/DECISION_MODELS.md).
- **Typed field facts on `act`.** The `act` result's `target.field` now reports `{ tag, type, role, name,
  valueLength, isEmpty, prefilled, editable, required, disabled }` for the addressed form control — **including
  on `dry_run`**, so a decision layer (or an agent) can pre-flight *"is this field already filled? should I
  pass `clear_first`?"* from data instead of guessing. `act` also returns `durationMs`.
- **`docs/DECISION_MODELS.md`** — where a Jev-style ("System One") decision model fits: Kuang surfaces typed
  facts and evidence; the decision maker belongs in the runner, not inside the browser server.

### Changed

- **The construct envelope is minimal, stable and honest.** The old front-matter spent nine lines on
  constants and vanity: `designation` (a fixed string), `raw_bytes`, `construct_bytes`, `estimated_tokens`
  and a `compression_ratio` computed against raw HTML bytes — which read `0.0%` on exactly the pages where
  markdown was empty, i.e. it was worst where it mattered most — plus a `harvested_at` timestamp that made
  **two harvests of one unchanged page differ**, which quietly broke diffing and paging across calls. It is
  now `url` / `title` / `reader` / `extracted_chars` / `page_chars` / `shadow_roots`. `reader` names the
  extraction path that produced the body (`readability` or `full-body`), and `extracted_chars` is measured on
  the same unit as `page_chars` (characters of page text) so the coverage claim is checkable rather than
  decorative. A partly-visible page now says so — *"the extracted region holds 3,200 of the page's 41,000
  characters…"* — and names the alternates (`observe(as:"text")`, `observe(as:"ax")`) instead of looking
  short; a page with no text explains why instead of returning an empty body. Token counts and byte sizes
  still reach the caller through the response object and the MCP header line, which now reads
  `chars=25034 of 167063 · ~41766 tokens · next_cursor=25034` instead of the ambiguous `chars=460/460`.

- **`mouse_move` telemetry fires once per glide, not once per step.** The humanlike cursor reports
  position/velocity from `moveMouseTo`, which loops over a 38–140-step Bézier trajectory — and it was
  emitting a `mouse_move` telemetry event *per step*, so a single click flooded the Cyberdeck telemetry
  feed with up to 140 rows and inflated the pulse counter. Events are now emitted once per glide (final
  position + velocity); the **in-page** phosphor trail is unaffected, because it is drawn per step by
  `window.__kuangMoveCursor`. (The HUD panel's own fading polyline is correspondingly coarser — a one-line
  revert if that denser look is preferred.) Note this is display-only telemetry: it never reached the
  agent, and it doubles as a signal that `act` (rather than synthetic JS input) was used, since synthetic
  clicks emit no `mouse_move` at all.

## [1.2.0] - 2026-10-19

### Fixed

- **9 MCP tools returned `HTTP 404: Endpoint not found`** because their catalog `endpoint`/`method`
  had drifted from the HTTP bridge's routes: `navigate_history`, `recall_memory`, `get_history`,
  `clear_history`, `list_bookmarks`, `save_session`, `restore_session`, `list_sessions`, and
  `get_console_logs` (wrong HTTP method).
  - `get_history` and `list_bookmarks` now use `GET` with query parameters, and `list_bookmarks`
    sends `q` (the bridge's parameter name) — previously the filter parameters were silently
    dropped, and the tools themselves 404'd.
- **Selector clicks could actuate twice.** `browser-chassis.ts#clickElement` ran a second,
  *untrusted* `el.click()` in page JS after the trusted CDP click, which double-submitted forms and
  double-opened links. The synthetic click was removed; the trusted CDP click alone actuates (the
  `focus()` nudge for non-link/button controls remains).
- **`list_bookmarks` didn't actually filter.** Its `query` parameter ran a vector search with no
  threshold, so with fewer bookmarks than `limit` it returned *every* bookmark (ranked) — identical
  output to no query at all. `query` is now a real filter: a bookmark matches when every query term
  appears (case-insensitively) in its title, notes, URL, or tags, and matches are then ranked by
  embedding similarity. Covered by `npm run test:cortex:bookmarks`.
- **Detached `WebContentsView` reads were flaky.** Off-screen reads (`llm_fetch` per-page alternates,
  `search_web` SERPs, `deep_crawl` page renders) created and destroyed a view per call and trusted
  `did-finish-load` — which the view's *initial about:blank document* also fires — so reads would
  intermittently return an empty DOM (missed search results, missing crawl links). All detached
  operations now share **one reusable off-screen view** (serialized), await the `loadURL()` promise
  for the navigation they started, and poll the live DOM before reading.

### Added

- **`npm run test:mcp:contract`** (`scripts/test-mcp-contract.mjs`) — parses `src/mcp/tools-catalog.ts`
  and `src/main/http-bridge.ts` and fails if any catalog entry maps to a `{method, path}` the bridge
  does not serve. No running Cyberdeck required, so it can run in CI. It caught a ninth broken tool
  (`get_console_logs`) on its first run.
- **`npm run test:mcp:surface`** (`scripts/test-mcp-surface.mjs`) — asserts deprecated names are
  absent from `tools/list` yet still callable, canonical names are present, a deprecated call returns
  its notice, and the merged `take_screenshot` modes behave.
- **`docs/TOOL_CATALOG_REVIEW.md`** — catalog duplication/overlap analysis with a phased
  consolidation plan (correctness → de-duplicate → consolidate → tier).
- **`docs/HIDDEN_ALIAS_REMOVAL_V1.2.md`** — the concrete plan to remove all 23 hidden aliases in
  v1.2 (inventory, removal steps, bridge-route decision, risk).
- **`mark-eleven://tools/recommended`** — a new MCP resource (also `help(category:"recommended")`)
  giving the canonical order for the five common jobs: read → `observe`, find → `find`, act → `act`,
  wait → `wait_for`, harvest → `collect_all`.
- **Pluggable Cortex embedding providers** (`src/main/cortex/embedder.ts`). Embedding now sits behind
  an `EmbeddingProvider` interface (`id` + `dim` + async `embed`). The deterministic `hash-128`
  embedder stays as the zero-dependency default; a real model (e.g. EmbeddingGemma-2 via ONNX) can be
  registered and selected via `KUANG_EMBEDDING_PROVIDER`. CortexDB records the active provider in
  `embedding-provider.json` and warns when it changes, so vectors from different models are never
  silently compared. See `docs/EMBEDDING_PROVIDERS.md`.
- **`npm run test:cortex:bookmarks`** (`scripts/test-bookmarks-search.mjs`) — adds tagged bookmarks,
  asserts `query` filters (exact hit, empty on no match, AND across terms, composition with `tag`),
  and cleans up. SKIPs when the bridge is down.
- **Phase 7 surface checks** in `npm run test:mcp:surface` — the new hidden aliases (`recall_script`,
  `focus_window`, `clear_network_traffic`, `clear_stream_messages`) still execute and return a notice
  pointing at their canonical tool; `list_scripts(query)` searches; `clear_capture` clears; and
  `observe` no longer advertises the structured `list|table|app_data` modes (which now live on
  `extract`).
- **`llm_surface` + `llm_fetch` — LLM-friendly site discovery (Feature 6).** Many sites publish a
  Markdown/Text representation (`/llms.txt`, `/llms-full.txt`, a `<link rel="alternate">`, or content
  negotiation). `llm_surface({ url? })` probes for those; `llm_fetch({ url?, as? })` reads the
  advertised one (~5–10× cheaper than a render). **Gated:** `llm_fetch` refuses (`NO_LLM_SURFACE`)
  unless the site advertises a surface, and never fetches arbitrary URLs or guesses paths.
  Well-known paths (`/llms.txt`, `/llms-full.txt`, `/sitemap.xml`) are `net.fetch`ed on Chromium's
  network stack and cached per origin; a page's advertised alternate is loaded via a **real document
  navigation**, not a synthetic fetch. A `text/html` response is never mislabelled as Markdown.
  New: `src/main/llm/llm-surface.ts`, routes `POST /llm/surface` + `POST /llm/fetch`, and
  `npm run test:llm` (local-fixture regression).
- **`search_web` — configurable multi-engine search (Feature 5).** Runs each query in a **detached
  WebContentsView** (real Chromium; the active tab is never hijacked) and falls back across engines
  when one returns a bot-check/consent wall: `google | duckduckgo | bing | brave | startpage |
  custom` (default chain `google → duckduckgo → brave`). The `custom` engine takes a `{query}` URL
  template (e.g. SearXNG, or `KUANG_SEARCH_URL`). Returns ranked `{rank, title, url, snippet}` —
  plain URLs to feed `navigate_to` / `collect_all`. Unwraps Google `/url?q=`, DDG `/l/?uddg=` and
  Bing `/ck/a` redirects. New: `src/main/search/search-engine.ts`, route `POST /search/web`, and
  `npm run test:search`.
- **`deep_crawl` — autonomous multi-page crawl (Feature 1).** Breadth-first crawl from a seed URL,
  bounded by `max_depth` / `max_pages`, same-origin by default and scoped by `match_patterns`
  (glob or `/regex/`). Each page takes the **cheap path first** — content-negotiated Markdown/Text
  when the site advertises it (see `llm_surface`), otherwise a detached render — and is distilled
  to Markdown and **indexed into LanceDB Cortex**. Returns a per-page summary (`depth`, `via`,
  `bytes`, `links`, `indexed`). New: `src/main/crawl/crawler.ts`, route `POST /crawl/deep`, and
  `npm run test:crawl`.
- **`research_topic` — autonomous research mode (Feature 3).** Runs `search_web` → gathers the top
  sources (cheap Markdown path first, else a detached render) → distills them to Markdown → indexes
  them into LanceDB Cortex. Returns **extractive, cited evidence**: every per-source highlight is a
  real paragraph that mentions the query terms, plus the ranked source list. It deliberately does
  **not** synthesize prose (Kuang has no LLM) — the calling agent writes the answer, and can follow up
  with `recall_memory` over the indexed pages. New: `src/main/research/researcher.ts`, route
  `POST /research/topic`, and `npm run test:research`.

### Changed

- **`extract` gained two kinds (Feature 2 — structured data).** `kind:"schema_org"` parses
  `<script type="application/ld+json">` into **typed** items (flattens `@graph`; `type` filters to e.g.
  `"Recipe"` / `"Product"` / `"FAQPage"` / `"HowTo"`), and `kind:"tables"` returns **every** table on the
  page (the existing `table` kind reads only one). The rest of Feature 2 already existed and is unchanged:
  the clean article body is `observe(as:"markdown")` (Mozilla Readability, with an aggregator fallback), and
  `kind:"app_data"` already returned parsed JSON-LD / `__NEXT_DATA__`. No new tool was added.
- **Advertised tool surface trimmed from 74 to 54** with no capability removed. Deprecated names
  are hidden from `tools/list` but still callable by name; calling one returns a
  `⚠ deprecated tool name — use "…"` notice.
  - **Phase 2 (de-duplicate):** `go_to_url` → `navigate_to`; `harvest_markdown` →
    `get_page_markdown`/`observe`; `send_desktop_notification` → `send_notification`;
    `save_session` / `restore_session` / `list_sessions` → `context_save` / `context_open` / `context_list`.
  - **Phase 3 (consolidate):** merged `take_annotated_screenshot` / `take_economy_screenshot` /
    `list_marks` into **one** `take_screenshot({ marks, detail: "full"|"economy"|"markdown" })`; folded
    `get_page_markdown` → `observe(as:"markdown")`, `list_marks` → `observe(as:"som")`,
    `get_api_payload` / `get_stream_messages` → `query_json_data`, `get_page_info` → `bridge_health`.
  - **Phase 5 (unify interaction):** `click_element` / `click_mark` / `type_text` / `type_mark` folded
    into **`act`**, which now accepts `mark_id | selector | x+y`. See below.
  - **Phase 7 (overlap sweep):** `recall_script` → `list_scripts({ query?, tag?, limit? })` (the vault
    list/search were one call); `focus_window` → `set_window_visibility({ visible?, focus? })` (the
    bridge already focused on show); `clear_network_traffic` / `clear_stream_messages` →
    `clear_capture({ scope })`; `observe`'s enum narrowed to `markdown|text|ax|som` with the structured
    `list|table|app_data` reads living on `extract` (the implementation was already a thin wrapper).
- **`take_screenshot` is now the single screenshot tool.** `marks=false` (default) returns a plain
  viewport image; `marks=true` returns Set-of-Marks with `detail:"full"` (PNG), `"economy"` (640px
  JPEG), or `"markdown"` (marks table, no image). It fronts both `/screenshot` and `/marks/screenshot`
  per call via the new `endpointFor` catalog field, and the image-return path is unified.
- **Renamed the ambiguous Cortex history pair:** `get_history` → `browsing_history` and
  `clear_history` → `browsing_history_clear` (old names kept as hidden aliases). `navigate_history`
  keeps its name — it really is page-navigation history.
- **`act` is now the single interaction entry point.** It addresses one target three ways —
  `mark_id` (preferred: a Set-of-Marks badge, re-resolved against the live DOM), `selector`, or
  `x`+`y` viewport coordinates — and performs `action: "click" | "focus" | "hover" | "type" | "press"`
  with the same delta report, `await_conditions`, `dry_run`, and `secret` as before. The four old
  front doors (`click_element`, `click_mark`, `type_text`, `type_mark`) are hidden aliases. `press_key`
  remains a visible tool. The tool name stays generic on purpose (a `click_*` name would lie once it
  also types/hovers); the advertised description leads with the concrete verbs, enumerates the three
  address modes, and says explicitly what it is *not* for (navigation, scrolling).
- The `help` categories and the `mark-eleven://skills/guide` OKF guide now reference canonical names
  only.
- **Descriptions now carry discoverability guidance.** A `TOOL_TIERS` map drives an auto-generated
  prefix on the 13 tools that have a preferred alternative — `[TIER 1 · prefer]` (observe, act,
  wait_for, expect, find, extract, collect_all, page_state, diff), `[TIER 2 · fallback]`
  (take_screenshot, snapshot_rendered_page, press_key), `[TIER 3 · use deliberately]` (evaluate_javascript).
  Hidden aliases show `[DEPRECATED → use "X"]`; tools that are the only way to do their job stay
  unprefixed.

### Removed

- **Dead MCP code.** Deleted `src/mcp/server.ts` — a 45-tool in-process server that
  `src/main/index.ts` imported but never invoked (superseded by `bridge-server.ts`) — and its
  now-unused import. Deleted the orphaned `scripts/mcp-server.cjs` bundle, which `npm run build:mcp`
  no longer produces (it emits `bin/mcp-server.cjs` + `scripts/mcp-server.js`) and which still
  carried pre-Phase-7 tool names.

## [1.1.1] — 2026-10-19

### Fixed

- **MCP stdio server could vanish mid-session ("kuang goes away").** The server wrote ~500 bytes
  of diagnostics to `stderr` on every tool call. A client that pipes stderr but never drains it
  fills the OS pipe buffer (~64 KiB ≈ ~125 calls) and the child stops answering JSON-RPC while the
  Cyberdeck stays healthy — so the whole `kuang` tool namespace disappeared.
  - Per-call diagnostics now go to the file log only (`data/logs/mcp-server.log`), written through
    a bounded asynchronous queue (no `appendFileSync` in the hot path).
  - `stderr` carries a short boot banner by default. Writes are backpressure-aware: if a write
    returns `false` the channel goes quiet until `drain`, lines are **dropped rather than queued**,
    and total stderr is hard-capped at 16 KiB.
  - The verbose `tools/call` dump was moved off `console.error`.
- **A wedged Cyberdeck could hang a tool call forever.** Every `http://127.0.0.1:4111` round-trip
  now has a timeout ceiling (`KUANG_BRIDGE_TIMEOUT_MS`, default `300000` ms — above any legitimate
  HIL / navigation wait) and returns a clear error instead of blocking indefinitely.
- **Orphaned stdio children.** Closing `stdin` (`end` / `close`) now triggers a logged, clean
  `exit(0)` with a synchronous log flush, so the child can no longer linger and compete for the
  single browser session.

### Added

- **Diagnostics controls:** `KUANG_MCP_LOG=0` (disable the file log), `KUANG_MCP_STDERR=0`
  (disable stderr), `KUANG_MCP_STDERR=verbose` (per-call stderr, debugging only).
- **`KUANG_BRIDGE_TIMEOUT_MS`** to tune the per-round-trip bridge ceiling.
- **[docs/HANDOFF_ORCHA_MCP_STDERR.md](./docs/HANDOFF_ORCHA_MCP_STDERR.md)** — full root-cause
  write-up, the live reproduction, and the conformance checklist for MCP clients.

### Changed

- `npm run build:mcp` now emits **both** `bin/mcp-server.cjs` (canonical) and `scripts/mcp-server.js`
  (used by the test harnesses) so the two bundles can no longer drift out of sync.

### Verification

Live Cyberdeck, `bridge_health` driven 600× through the bundled stdio server:

| Scenario | Before | After |
| :--- | :--- | :--- |
| stderr piped, **never read** | 158 responses, 4 timeouts, stall @ call 157 | **601 responses, 0 timeouts** |
| stderr drained (control) | 601 responses, 0 timeouts | 601 responses, 0 timeouts |
| stderr bytes for 25 calls | ~13 000 B | **0 B** |
| boot banner | logged per call | **199 B, 2 lines** |
| `stdin.end()` | unmanaged | **exit code 0 + shutdown log line** |
| `npm run test:mcp:primitives` | — | **ALL CHECKS PASSED (14)** |

`npx tsc --noEmit` clean.

## [1.1.0] — 2026-10-18

### Added

- **Orthogonal primitive layer:** `observe`, `act`, `wait_for`, `expect`, `find`, `extract`,
  `collect_all`, `page_state`/`diff`, `export_har`, and `context_save`/`open`/`list`/`delete`
  (replace blind sleeps and guessy selectors). 16 new tools, 1 new OKF playbook partition.
- **Focus-independent CDP input:** clicks, typing, and wheel scrolling are delivered over the
  tab's attached debugger (`Input.dispatchMouseEvent` / `dispatchKeyEvent` / `mouseWheel`) with
  focus emulation, so input lands even when another application owns the OS foreground.
  `bridge_health` reports `input.transport` (`cdp` | `native`).
- **Background-render hardening:** `backgroundThrottling: false` plus
  `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` /
  `--disable-background-timer-throttling`, so occluded windows still hydrate, scroll, and fire
  `IntersectionObserver` callbacks.

See [docs/PROPOSED_ABSTRACTIONS.md](./docs/PROPOSED_ABSTRACTIONS.md) for the design and status.

[1.4.2.4]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.4.2...v1.4.2.4
[1.4.2]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/releases/tag/v1.1.0
