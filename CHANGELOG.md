# Changelog

All notable changes to **Kuang Grade Mark Eleven** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
  with **no answers** when the upstream fails. When nothing is configured the tool is **not advertised**
  (`GET /decide` and `/health.decision` say so) and calls return `NOT_CONFIGURED` with setup instructions.
  Two backends, chosen by config rather than code: **hosted Jev** (`protocol:"typesafe"`, e.g.
  `jev-1.13`) and **local LiquidAI d1-3B** (`protocol:"d1-onnx"`, one forward pass, images accepted,
  optional `open-jev` dependency + pinned ONNX revision, nothing bundled). Config lives in env vars or
  `data/decision.json` (gitignored). See [`docs/DECISION_MODELS.md`](./docs/DECISION_MODELS.md).
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

- **Submit inputs were labelled with their `name` attribute instead of their visible label.** GitHub's
  `<input type="submit" name="commit" value="Sign in">` appeared in marks and the component table as
  `"commit"` — a meaningless identifier to any reader, human or model. Accessible-name computation now
  prefers `value` for `submit`/`button`/`reset` inputs before falling back to `name`.

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

[1.3.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/releases/tag/v1.1.0
