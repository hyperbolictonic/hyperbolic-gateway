# MCP Tool Catalog Review — consolidation & discoverability

**Date:** 2026-10-19
**Scope:** `src/mcp/tools-catalog.ts` (81 registered entries: 58 advertised + 23 hidden deprecated aliases, plus the built-in `help` = **59 advertised**), `src/main/http-bridge.ts` (route table).
**Status:** Phases 1–8 implemented 2026-10-19 (see §5).

**Current:** the live surface is 68 advertised +2 optional, managed from Settings → Tools. The next consolidation proposal is in [`TOOL_SURFACE_CONSOLIDATION.md`](./TOOL_SURFACE_CONSOLIDATION.md).

---

## TL;DR

Three separate problems, in priority order:

1. **9 tools were dead (404).** **[FIXED 2026-10-19]** Their catalog `endpoint` no longer matched
   any bridge route, so agents saw them in `tools/list`, called them, and got
   `HTTP 404: Endpoint not found`. A new contract test now makes this class of drift impossible.
2. **~12 tools are duplicates or near-duplicates** of others (2 are literal aliases, one whole
   family is a second name for another, and several legacy verbs overlap the newer primitives).
3. **61 advertised tools with no tiering.** The OKF guide teaches "prefer TIER 1 / avoid TIER 3", but an
   agent that only reads `tools/list` never sees that guidance, so it guesses.

Recommendation: fix (1) immediately with a contract test that makes drift impossible, then
consolidate (2) behind deprecated aliases, and add tier hints to descriptions for (3).

---

## 1. Correctness: 9 tools pointed at endpoints the bridge does not serve  ✅ FIXED

Verified live against `http://127.0.0.1:4111` on 2026-10-19, and independently by the new
`scripts/test-mcp-contract.mjs` — which found **9**, one more than the 8 that were spotted by eye:

| Tool | Catalog called | Bridge actually serves | Probe |
| :--- | :--- | :--- | :--- |
| `navigate_history` | `POST /history/navigate` | `POST /history` `{action:"back"\|"forward"\|"reload"}` | **404** |
| `recall_memory` | `POST /memory/recall` | `POST /cortex/recall` | **404** |
| `get_history` | `POST /history/list` | `GET /cortex/history` | **404** |
| `clear_history` | `POST /history/clear` | `POST /cortex/history/clear` | **404** |
| `list_bookmarks` | `POST /bookmarks/list` | `GET /bookmarks` | **404** |
| `save_session` | `POST /sessions/save` | `POST /session/save` | **404** |
| `restore_session` | `POST /sessions/restore` | `POST /session/restore` | **404** |
| `list_sessions` | `POST /sessions/list` | `GET /session/list` | **404** |
| `get_console_logs` | `POST /console/logs` | `GET /console-logs` \| `GET /console/logs` | **404** (wrong method) |

Control probes on the real paths all returned `200`, so the bridge is fine — the catalog drifted.

One further gap, deferred: the bridge serves `POST /session/delete` but no MCP tool exposes it —
only `context_delete` does. Since the canonical family decision (§6.1) is `context_*`, that already
covers deletion, so no `session_delete` was added.

### Root cause

`tools-catalog.ts` hard-codes URL paths as string literals; `http-bridge.ts` declares its routes
independently. Nothing linked them, and there is **no CI and no contract test** — the one suite that
does call these (`scripts/test-all-mcp-tools.js` → `test:mcp:all`) reports them as FAILED, but it is
a live, stateful, manually-run script that nobody gates on.

### Fix — applied (2026-10-19)

1. Corrected all 9 endpoints/methods. `get_history` and `list_bookmarks` now send **`GET`
   `queryParams`** (built so only defined values are added — a bare `undefined` would have been
   serialized into the query string by `URLSearchParams`), and `list_bookmarks` sends `q`.
2. **Drift is now impossible:** `scripts/test-mcp-contract.mjs` statically parses the catalog and
   the bridge route table and fails on any `{method, endpoint}` with no route. It found the 9th
   broken tool (`get_console_logs`) on its first run. Exposed as `npm run test:mcp:contract`; it
   needs no running Cyberdeck, so it can run in CI.
3. `session_delete` was **not** added — see §2b and the deferred note above.

Verified: `73/73` catalog entries matched, `npx tsc --noEmit` clean, all 9 repaired tools respond
end-to-end through `bin/mcp-server.cjs`, and `npm run test:mcp:primitives` still passes 14/14.

---

## 2. Duplicates & overlaps

**Status (2026-10-19): de-duplication applied.** `go_to_url`, `harvest_markdown`,
`send_desktop_notification`, `save_session`, `restore_session`, `list_sessions` are now **hidden
from `tools/list` but still callable**; `get_history` / `clear_history` were renamed to
`browsing_history` / `browsing_history_clear` with the old names kept as hidden aliases. Advertised
surface: **74 → 68** (no capability removed). **Phase 3** then took it to **61**, **Phase 5** to **57**, and **Phase 7** to **54** — see §2c/§2e/§2f/§2g.

### 2a. Literal aliases (same handler, two names)

| Duplicate | Canonical | Note |
| :--- | :--- | :--- |
| `go_to_url` | `navigate_to` | Identical, catalog even says "Alias for navigate_to". |
| `harvest_markdown` | `get_page_markdown` | Identical, catalog says "Alias for get_page_markdown". |

### 2b. The `context_*` family is a second name for `session_*`

`/context/save|open|list|delete` call exactly `chassis.saveSession / restoreSession /
listSessions / deleteSession` — the same functions behind `/session/*`. So the catalog ships
**two families for one concept** (7 tools where 4 are needed), and they disagree: `context_*` has
a delete verb, `session_*` does not.

**Decision (2026-10-19):** **`context_*` is canonical.** `save_session` / `restore_session` /
`list_sessions` are retired in Phase 2 (kept callable by name, hidden from `tools/list`, for one
release). Do not ship both families.

### 2c. Overlap with the orthogonal primitives

The primitives layer (`observe` · `act` · `extract` · `find` · `wait_for`) was added *alongside* the
legacy verbs, so several capabilities now have two front doors:

| Legacy tool | Superseded by | Verdict |
| :--- | :--- | :--- |
| `get_page_markdown` / `harvest_markdown` | `observe(as:"markdown")` | ✅ hidden aliases (both), still callable |
| `list_marks` | `observe(as:"som")` | ✅ hidden alias |
| `snapshot_rendered_page(format:"ax_tree"/"markdown")` | `observe(as:"ax"/"markdown")` | kept visible — has `save_to_disk` + shadow-DOM specifics not in `observe` |
| `click_mark` / `type_mark` | `act(action:"click"/"type")` | ✅ hidden aliases (Phase 5) |
| `click_element` / `type_text` (selector/coordinate) | `act(selector:…)` / `act(x:…, y:…)` | ✅ hidden aliases (Phase 5) |
| `get_api_payload` | `query_json_data(source:"network_payload")` | ✅ hidden alias |
| `get_stream_messages` | `query_json_data(source:"stream_messages")` | ✅ hidden alias |
| `get_page_info` | `bridge_health` + `page_state` | ✅ hidden alias (→ `bridge_health`) |
| `send_desktop_notification` | `send_notification` | ✅ **pure duplicate** — both `POST /notify`; differs only in default `urgency`/title. Hidden alias. |

### 2d. Genuinely distinct, just confusingly named

- `navigate_history` (back/forward/reload) vs `get_history` (the Cortex browsing log) vs
  `clear_history`. Three tools, one word. Rename to **`history_navigate`** (or `page_back`/`page_forward`)
  and **`browsing_history`**.
- ~~`click_element` (CSS selector **or** x/y) vs `click_mark` (badge id) vs `act` (badge id, unified).~~
  **Resolved (Phase 5, §2f):** all three folded into `act`, which now accepts `mark_id | selector | x+y`.
- `take_screenshot` (`format` = image codec) vs `snapshot_rendered_page` (`format` = ax/markdown/html).
  Same parameter name, different meaning.

### 2e. Screenshot family — 4 tools → 1  ✅ DONE (Phase 3)

`take_screenshot`, `take_annotated_screenshot` (SoM + full PNG), `take_economy_screenshot`
(SoM + 640px JPEG), and `list_marks` (SoM text, no image) are all `GET /marks/screenshot` /
`GET /screenshot` with different query flags. Collapsed to a single
`take_screenshot({ marks?: boolean, detail?: "full"|"economy"|"markdown", format?, quality?, max_width? })`
— `marks:false` hits `GET /screenshot`; `marks:true` hits `GET /marks/screenshot` (selected per call
via the new `endpointFor` catalog field). `detail:"markdown"` returns the marks table and no image.
The bridge already supports every combination; only the catalog names differed. The three old names
are hidden aliases. The enum value is `markdown`, not `text`, because that level returns a Markdown
marks table — "text" was not semantically truthful.

### 2f. Interaction family — 4 tools → 1 (`act`)  ✅ DONE (Phase 5)

`click_element` (selector **or** x/y), `click_mark` (badge id), `type_text` (selector),
`type_mark` (badge id) were four front doors onto the same two chassis calls. `act` — already the
unified `click`/`focus`/`hover`/`type`/`press` verb — now accepts the union of their addressing
modes: **`mark_id` (preferred) | `selector` | `x`+`y`**. The four old names are hidden aliases of
`act` (still callable by name). `press_key` stays visible (a bare keypress is a real, distinct job
even though `act(action:"press")` also covers it).

- **Why `act`, not a narrower name.** A generic mutation verb + an `action` enum is the established
  computer-use shape (cf. Anthropic's `computer` tool). A name like `click_element` would *lie* once
  it also types/hovers; the description and the `action`/address schema carry the meaning.
- **Why the description leads with verbs.** `act` is the least self-describing name in the set, so
  the advertised description opens with "Click, focus, hover, type into, or press…" and names all
  three address modes, then adds an explicit negative ("NOT for navigation → `navigate_to`; not for
  scrolling → `scroll_page`") to stop catch-all drift.
- **Bonus fix.** `browser-chassis.ts#clickElement` fired a second, *untrusted* `el.click()` after
  the trusted CDP click — double-submitting forms and double-opening links. Removed; the trusted
  click alone actuates. A `focus()` nudge remains for non-link/button controls.

### 2g. Remaining overlaps — one sweep  ✅ DONE (Phase 7)

After Phases 2–5 the only shared-endpoint pairs left were already hidden; a re-parse of all catalog
entries found **no literal duplicates among visible tools**. Four semantic overlaps across
*different* endpoints remained:

| Overlap | Resolution |
| :--- | :--- |
| `recall_script` vs `list_scripts` | `ScriptVault.listScripts()` was literally `recallScripts(undefined, …)` — one call with an optional query. Unified to `list_scripts({ query?, tag?, limit? })`; `recall_script` → hidden alias. |
| `focus_window` vs `set_window_visibility` | The bridge's `/window/visibility` **already** runs `focusWindow()` on show, so showing *is* focusing. Folded to `set_window_visibility({ visible?, focus? })`; `focus_window` → hidden alias. |
| `clear_network_traffic` + `clear_stream_messages` | Both clear a capture ring buffer. Unified to `clear_capture({ scope: "network"\|"streams"\|"all" })`; the two old names stay as hidden aliases that default their own scope, so their semantics are preserved. |
| `observe(as:"list"\|"table"\|"app_data")` vs `extract` | `observe`'s structured modes were a **thin wrapper** that directly called `this.extract(...)`. The MCP enum narrowed to `markdown\|text\|ax\|som`; `extract` is the single structured reader. |

`navigate_history` (the §2d rename idea) was left as-is: now that
`browsing_history`/`browsing_history_clear` are canonical, the remaining name clash is no longer a
mis-selection risk, and a rename is pure churn. The per-buffer clear endpoints stay served for
direct HTTP callers.

---

## 3. Discoverability — helping agents pick the right tool

**Status (2026-10-19): applied (Phase 4).**

The guide already defines tiers, but only inside the `help` tool / `mark-eleven://skills/guide`
resource — an agent that plans from `tools/list` alone never saw it. Phase 4 moves the guidance
into the surface itself:

1. ✅ **Tier-prefix descriptions — where a real choice exists.** A `TOOL_TIERS` map
   (`src/mcp/tools-catalog.ts`) drives an auto-generated prefix on the advertised description:
   `[TIER 1 · prefer]` (9 tools: `observe`, `act`, `wait_for`, `expect`, `find`, `extract`,
   `collect_all`, `page_state`, `diff`), `[TIER 2 · fallback]` (3: `take_screenshot`,
   `snapshot_rendered_page`, `press_key` — the four click/type verbs left the map in Phase 5 when
   they became hidden aliases of `act`), `[TIER 3 · use deliberately]` (`evaluate_javascript`). Hidden aliases get
   `[DEPRECATED → use "X"]`. Tools that are the only way to do their job stay **unprefixed** — a
   forced tier on `list_tabs` would be noise, not guidance.
2. ✅ **One "what to use when" place.** New resource `mark-eleven://tools/recommended` (and the
   `help(category:"recommended")` text) gives the canonical order for the 5 common jobs (read →
   `observe`; find → `find`; act → `act`; wait → `wait_for`; harvest → `collect_all`).
3. ✅ **Alias noise killed** (§2a) — done in Phases 2–3.
4. ⏸ **Trim the payload alias soup** — *deferred* (2026-10-19). It does not help agents choose a
   tool and risks breaking argument handling existing prompts rely on.

---

## 4. Proposed target surface

Conservative (keep everything working, only fix + relabel + de-duplicate names):

- Fix the 8 endpoints; add `session_delete`.
- Delete 2 literal aliases + `send_desktop_notification`; retire one of `session_*`/`context_*`.
- Add tier prefixes and the recommended-order resource.
- Target: **~68 tools**, no behavior removed.

Aggressive (collapse onto the primitives):

- Merge the screenshot family (4 → 1).
- Fold `get_page_markdown`/`list_marks`/`get_api_payload`/`get_stream_messages` into
  `observe`/`query_json_data`, keeping names as deprecated aliases for one release.
- Target: **~58–60 tools**, smaller and more opinionated.

Either way the capability set is unchanged; only the front door shrinks.

---

## 5. Recommended execution order

| Phase | Work | Risk | Status |
| :--- | :--- | :--- | :--- |
| **1. Correctness** | Fix the 9 endpoints + `q`; add `test-mcp-contract.mjs`; expose as `npm run test:mcp:contract` | low | ✅ **done 2026-10-19** |
| **2. De-duplicate** | Remove 2 literal aliases + notification dup; canonicalize profile family; rename the `*history*` trio | low (alias names stay accepted) | ✅ **done 2026-10-19** |
| **3. Consolidate** | Merge screenshot family; fold legacy readers into `observe`/`query_json_data` behind aliases | medium (touch `help`, OKF guide, README) | ✅ **done 2026-10-19** |
| **4. Discoverability** | Tier prefixes on descriptions; `tools/recommended` resource; trim payload fallbacks | low | ✅ **done 2026-10-19** (payload trim deferred) |
| **5. Unify interaction** | Extend `act` to `mark_id \| selector \| x+y`; fold `click_element`/`click_mark`/`type_text`/`type_mark` to hidden aliases; fix the double-`el.click()` | medium (touch primitives, bridge, `help`, OKF guide, READMEs) | ✅ **done 2026-10-19** |
| **6. Cortex truthfulness** | Make `list_bookmarks(query)` actually filter (lexical filter + relevance rank); fix Arrow `Vector` tag reads; pluggable embedding providers (`embedText`); `test-bookmarks-search.mjs` | medium (`cortex-db.ts`, `embedder.ts`; touches `help`, README, SKILL) | ✅ **done 2026-10-19** |
| **7. Overlap sweep** | Merge `recall_script`→`list_scripts`, `focus_window`→`set_window_visibility`; add `clear_capture` for the two buffer clears; narrow `observe` to `markdown\|text\|ax\|som` (structured reads → `extract`) | medium (touch `tools-catalog`, `http-bridge`, `help`, OKF guide, READMEs) | ✅ **done 2026-10-19** |
| **8. Dead-code removal** | Delete orphaned `scripts/mcp-server.cjs` and the dead `src/mcp/server.ts` (+ its unused import in `src/main/index.ts`); drop its README entry | low | ✅ **done 2026-10-19** |

Docs to update if 2–4 run: `src/mcp/bridge-server.ts` (the `OKF_SKILL_GUIDE` + `help`
categories), `src/mcp/README.md` (tool count), `README.md` badges/tables, `kuang_docs/` OKF
partitions, `docs/TODO.md`, and `CHANGELOG.md`.

> **Post-sweep additions:** Feature 6 (LLM-friendly discovery) added `llm_surface` + `llm_fetch`,
> Feature 5 added `search_web`, Feature 1 added `deep_crawl`, and Feature 3 added `research_topic`.
> All four are opt-in and not TIER-1; `observe(as:"markdown")` stays the default page read.
>
> **2026-10-24:** the discovery layer gained the composite **`read_url`**, and issue #1 removed
> `"rendered"` from `LlmSurfaceKind` — `llm_surface.recommended` is now **`null`** when nothing is
> advertised, with a machine-readable **`next`** (`llm_fetch(as)` \| `observe(as:"markdown")`) and
> **`scope`** (`origin`\|`page`) on both `llm_surface` and `llm_fetch`. Advertised surface: **63**
> (83 registered). See [CHANGELOG.md](../CHANGELOG.md) 1.4.6.

---

## 6. Decisions

Agreed 2026-10-19:

1. **Canonical profile family** — **`context_*`** (all 4 verbs; retire `session_*` in Phase 2).
2. **Scope now** — Phases 1–4 complete (2026-10-19).
3. **Alias policy** — renamed/removed tools stay **callable by name, hidden from `tools/list`**
   for one release.
4. **Contract test** — **static source parse** of both files (chosen; no `/__routes` endpoint or
   bridge change needed).
5. **Screenshot merge** — one `take_screenshot({ marks, detail:"full"|"economy"|"markdown" })`; the
   three old names are hidden aliases. The enum value is `markdown` (not `text`) because that level
   returns a Markdown marks table — semantically truthful.
6. **Tier scope** — tier **only tools that have a preferred alternative** (17 tools → 13 after
   Phase 5); tools that are the only way to do their job stay unprefixed. Payload-fallback trimming deferred.
7. **Unified interaction (Phase 5)** — one `act` tool, addressed by `mark_id | selector | x+y`;
   `click_element` / `click_mark` / `type_text` / `type_mark` hidden aliases. Name stays `act`
   (generic verb + `action` enum, à la the computer-use tool); the description carries the concrete
   verbs and the address modes. The extra `el.click()` in `clickElement` was removed.
8. **Marks table stays id-only** — the markdown/SoM projections already stamp each interactive
   element with its `[#ID]` **address**; they do **not** emit a ready-made per-element command.
   A per-row command would (a) repeat across every element, (b) be re-sent on every scan, and
   (c) be *wrong* — the verb depends on the agent's goal (a button may be clicked *or* hovered;
   an input clicked-to-focus *or* typed into). The verb mapping is taught **once** (the `act`
   description + the marks-table legend).
9. **`list_bookmarks.query` is a filter, not a ranker** — a bookmark matches when **every** query
   term appears (case-insensitively) in its title, notes, URL, or tags; matches are then ordered by
   embedding similarity. Previously a threshold-less vector search returned the *whole* library
   whenever it held fewer rows than `limit`, i.e. `query` did nothing observable.
10. **Cortex list columns are Arrow `Vector`s** — LanceDB does not return JS arrays, so the old
    `Array.isArray(r.tags)` was always false and both tag display and `tag` filtering silently
    no-op'd. Reads now go through a `toStringArray` coercer.
11. **Embedding is pluggable** — an `EmbeddingProvider` (`id` + `dim` + async `embed`); `hash-128`
    stays the zero-dependency default and a real model (EmbeddingGemma-2 via ONNX, 768-d) is a
    drop-in selected with `KUANG_EMBEDDING_PROVIDER`. CortexDB persists the active provider and warns
    on change; re-embedding existing vectors is a separate migration. See `docs/EMBEDDING_PROVIDERS.md`.
12. **Script Vault list = search (Phase 7)** — `ScriptVault.listScripts()` was literally
    `recallScripts(undefined, …)`, so `recall_script` and `list_scripts` were one call. Canonical is
    `list_scripts({ query?, tag?, limit? })` (mirrors `list_bookmarks`); `recall_script` is a hidden
    alias. `GET /scripts/list` gained `q`/`tag`/`limit`.
13. **Window show = focus (Phase 7)** — `/window/visibility` already focused on show, so
    `focus_window` was redundant. Folded to `set_window_visibility({ visible?, focus? })`; the hidden
    `focus_window` alias still calls show-with-focus.
14. **One capture-clear verb (Phase 7)** — `clear_capture({ scope: "network"|"streams"|"all" })`
    replaces `clear_network_traffic` / `clear_stream_messages`, which stay as hidden aliases whose
    own defaults keep their per-buffer behavior (a generic clone would have made either clear both).
15. **`observe` observes; `extract` extracts (Phase 7)** — `observe`'s `list|table|app_data` modes
    were a thin wrapper over `extract`, so the MCP enum narrowed to `markdown|text|ax|som`. The
    implementation still accepts the old values for direct HTTP callers (no silent fallback);
    only the advertised surface changed.
16. **Alias removal is scheduled, not open-ended** — the hidden aliases are a **one-release
    compatibility window**; the concrete v1.2 removal plan for all 23 aliases (inventory, steps,
    bridge-route decision, risk) lives in
    [`docs/HIDDEN_ALIAS_REMOVAL_V1.2.md`](./HIDDEN_ALIAS_REMOVAL_V1.2.md). Aliases introduced in
    Phase 7 are the newest and may roll to v1.3 so each gets a full release of runway.
