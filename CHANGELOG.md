# Changelog

All notable changes to **Kuang Grade Mark Eleven** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed

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
  (take_screenshot, snapshot_rendered_page, press_key), `[TIER 3 · last resort]` (evaluate_javascript).
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

[1.1.1]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/hyperbolictonic/kuang-grade-mark-eleven/releases/tag/v1.1.0
