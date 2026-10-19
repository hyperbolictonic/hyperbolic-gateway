# Hidden Alias Removal — v1.2 Plan

**Status:** planning (not started) · **Target release:** v1.2
**Related:** [`TOOL_CATALOG_REVIEW.md`](./TOOL_CATALOG_REVIEW.md) §6 (decisions 3, 12–15)

## Context

Phases 2–7 of the tool-catalog consolidation retired **23 tools by *hiding* them** rather
than deleting them. Each retired name is:

- absent from `tools/list` (so agents never *see* it), but
- still **callable by name** via `tools/call`, returning a
  `⚠ deprecated tool name — use "X"` notice.

This is the one-release compatibility window agreed in
[`TOOL_CATALOG_REVIEW.md`](./TOOL_CATALOG_REVIEW.md) §6.3. **v1.2 closes it**: the 23
aliases are removed from the catalog entirely.

Advertised surface today: **54 tools** (76 registered; 23 hidden). After removal:
**53 registered, 0 hidden, 54 advertised** (the built-in `help` remains).

## Alias inventory (23)

Two mechanisms produce the aliases — both are removed.

### A. Standalone deprecated entries (19)

Entries in `TOOLS_CATALOG` marked `hidden: true` with `deprecatedInFavorOf`:

| Alias | Canonical | Retired in |
| :--- | :--- | :--- |
| `go_to_url` | `navigate_to` | Phase 2 |
| `harvest_markdown` | `observe` | Phase 2/3 |
| `send_desktop_notification` | `send_notification` | Phase 2 |
| `save_session` | `context_save` | Phase 2 |
| `restore_session` | `context_open` | Phase 2 |
| `list_sessions` | `context_list` | Phase 2 |
| `get_page_markdown` | `observe` | Phase 3 |
| `list_marks` | `observe` | Phase 3 |
| `take_annotated_screenshot` | `take_screenshot` | Phase 3 |
| `take_economy_screenshot` | `take_screenshot` | Phase 3 |
| `get_api_payload` | `query_json_data` | Phase 3 |
| `get_stream_messages` | `query_json_data` | Phase 3 |
| `get_page_info` | `bridge_health` | Phase 3 |
| `click_element` | `act` | Phase 5 |
| `click_mark` | `act` | Phase 5 |
| `type_text` | `act` | Phase 5 |
| `type_mark` | `act` | Phase 5 |
| `clear_network_traffic` | `clear_capture` | Phase 7 |
| `clear_stream_messages` | `clear_capture` | Phase 7 |

### B. Runtime clones via `LEGACY_ALIASES` (4)

Each is cloned from its canonical entry (so it can never drift):

| Alias | Canonical | Retired in |
| :--- | :--- | :--- |
| `get_history` | `browsing_history` | Phase 2 |
| `clear_history` | `browsing_history_clear` | Phase 2 |
| `recall_script` | `list_scripts` | Phase 7 |
| `focus_window` | `set_window_visibility` | Phase 7 |

## Removal steps

1. **Delete the 19 standalone entries** from `src/mcp/tools-catalog.ts` (whole objects,
   including their `hidden`/`deprecatedInFavorOf` fields). Their `endpoint`s are the
   canonical handlers plus a handful of bridge-only legacy paths — see “Bridge routes” below.
2. **Delete the `LEGACY_ALIASES` array and its clone loop** in `tools-catalog.ts`
   (removes the 4 runtime clones). Drop the `hidden`/`deprecatedInFavorOf` fields from the
   `ToolDefinition` interface if nothing else reads them.
3. **Remove the deprecation-notice machinery** in `src/mcp/bridge-server.ts`:
   - the `[DEPRECATED → use "…"]` description prefix (`~L231`),
   - the `hidden → deprecatedInFavorOf` map built for the runtime nudge (`~L570-573`),
   - the `⚠ deprecated tool name` injection on `tools/call` (`~L612-616`).
4. **Update tests:**
   - `scripts/test-mcp-surface.mjs` — delete the `HIDDEN` assertions and the “legacy … still
     executes / points at …” checks; keep the canonical checks.
   - `scripts/test-mcp-primitives.mjs` — already alias-free.
   - `scripts/test-all-mcp-tools.js` — replace its `recall_script` call with `list_scripts`.
5. **Update docs:** `README.md` (drop the `†` rows + the “23 deprecated aliases” note, badge
   already 54), `src/mcp/README.md` (registered/hidden counts → 53/0), `SKILL.md` (drop the
   “hidden aliases” parentheticals), `docs/TOOL_CATALOG_REVIEW.md` (§2/§6 mark aliases removed),
   `CHANGELOG.md`.
6. **Verify:** `npx tsc --noEmit`, `npm run test:mcp:contract` (expect 53 tools / 0 hidden),
   `test:mcp:surface`, `test:mcp:primitives`, `test:primitives`; rebuild `bin/mcp-server.cjs` +
   `scripts/mcp-server.js`.

## Bridge routes

Removing the catalog entries does **not** require removing bridge routes. Routes that were only
reachable through an alias — `/page-info`, `/session/*`, `/scripts/recall`, `/window/focus`,
`/network/clear`, `/streams/clear`, `/markdown` — can stay served:

- `/session/*` and `/context/*` are the **same chassis functions**; `/context/*` is canonical.
- `/scripts/recall`, `/window/focus`, `/network/clear`, `/streams/clear`, `/page-info` may be
  unused by the MCP surface after removal but are still reachable by direct HTTP callers and are
  covered by the contract test only while a catalog entry references them.

**Decision:** prune a bridge route only when a grep confirms nothing (renderer, tests, docs) still
references it; otherwise leave it. This keeps the change catalog-only and low-risk.

## Risk

- **Breaking change for anything still calling an old name.** That is the intent of the window;
  the v1.0/1.1 release notes and the `⚠ deprecated` notices were the warning. Agents that plan
  from `tools/list` were never exposed to these names.
- Aliases added in **Phase 7** (2026-10-19) are the newest; they should have aged at least one
  release before removal. If v1.2 ships soon, consider deferring the 4 Phase-7 aliases to v1.3 so
  every alias gets a full release of runway.
