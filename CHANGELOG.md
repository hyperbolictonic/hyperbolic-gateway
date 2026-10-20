# Changelog

All notable changes to **Kuang Grade Mark Eleven** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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

[1.2.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/releases/tag/v1.1.0
