# 🔌 Kuang Grade Mark Eleven — Model Context Protocol Server (`src/mcp/`)

This directory contains the in-process TypeScript implementation of the Model Context Protocol (MCP) server using `@modelcontextprotocol/sdk`.

---

## 🏛️ Purpose & Architecture

The standalone stdio server executable ([`scripts/mcp-server.js`](../../scripts/README.md), bundled to [`bin/mcp-server.cjs`](../../bin/mcp-server.cjs)) communicates with the browser over the HTTP bridge (`:4111`).

---

## 🧰 Registered MCP Tool Domains (59 Advertised Tools)

Deprecated aliases are hidden from `tools/list` (they still work by name); the canonical name is listed here.

1. **Navigation & History (2 Tools):** `navigate_to`, `navigate_history`.
2. **Autonomous Shield & Consent (1 Tool):** `dismiss_consent`.
3. **Hardware-Level Input Simulation (3 Tools):** `fill_form`, `press_key`, `scroll_page`. (`act` is the single interaction entry point — see the primitives below — addressable by mark id, CSS selector, or coordinates; `click_element` / `type_text` / `click_mark` / `type_mark` are hidden aliases of `act`.)
4. **Multimodal Observation & Vision (6 Tools):** `take_screenshot` (plain viewport image, or Set-of-Marks via `marks:true` + `detail:"full"|"economy"|"markdown"`), `snapshot_rendered_page` (post-hydration AX tree, rendered markdown, or unrendered HTML), `prerender_links` (speculative 0ms pre-rendering & Cortex pre-harvest), `evaluate_javascript`, `get_console_logs`, `get_fingerprint_profile`.
5. **Multi-Tab Orchestration (4 Tools):** `new_tab`, `switch_tab`, `close_tab`, `list_tabs`.
6. **LanceDB Cortex Persistent Memory (6 Tools):** `recall_memory`, `browsing_history`, `browsing_history_clear`, `add_bookmark`, `list_bookmarks`, `delete_bookmark`.
7. **Download Manager & Harvester (2 Tools):** `list_downloads`, `read_download`.
8. **Context Profiles / Cookie Vault (4 Tools):** `context_save`, `context_open`, `context_list`, `context_delete`.
9. **Network Intelligence & Real-Time Streams (4 Tools):** `get_network_traffic` (with action-correlated `since`), `query_json_data` (token-efficient JSON navigator; also reads `network_payload` and `stream_messages`), `list_realtime_streams`, `clear_capture` (`scope: "network" | "streams" | "all"`; `clear_network_traffic` / `clear_stream_messages` are hidden aliases).
10. **Script Vault & Semantic Macro Engine (4 Tools):** `save_script`, `list_scripts` (`query?` for semantic search), `run_script`, `delete_script`. (`recall_script` is a hidden alias of `list_scripts`.)
11. **Desktop System Tray & HIL Intervention (6 Tools):** `set_window_visibility`, `configure_system_tray`, `request_human_intervention`, `resolve_human_intervention`, `get_human_intervention_status`, `send_notification`.
12. **Orthogonal Primitives & Abstraction (11 Tools):** `wait_for`, `observe`, `extract`, `collect_all`, `find`, `expect`, `act`, `page_state`, `diff`, `bridge_health`, `export_har`. (`focus_window` is a hidden alias of `set_window_visibility`.)
13. **Assistance & Discovery (1 Tool):** `help`.
14. **Discovery (5 Tools):** `llm_surface` (probes a site for `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, a `<link rel="alternate">`, or Markdown negotiation), `llm_fetch` (fetches that advertised representation; GATED on a confirmed surface), `search_web` (multi-engine web search in a detached view with automatic fallback), `deep_crawl` (autonomous BFS crawl that distills each page and indexes it into Cortex), `research_topic` (search → gather → distill → index; returns cited extractive evidence).

In addition to the 59 advertised tools, `bridge-server.ts` registers **7 MCP resources**: `mark-eleven://skills/guide` (the operational manual), `mark-eleven://tools/recommended` (the canonical "what to use when" order across the five common jobs), `mark-eleven://okf/manifest`, and four OKF partition playbooks (selector-and-som, captcha-and-anti-bot, browser-navigation, primitives-and-workflows).

---

## 📄 Key Source Files

- **[`tools-catalog.ts`](./tools-catalog.ts)**:
  Central repository of the tool definitions (**81 registered**, of which **23 deprecated aliases are hidden from `tools/list`** → **59 advertised** including the built-in `help`), Zod schemas, HTTP endpoints, argument coercion/aliasing, and markdown formatters. Because the `endpoint`/`method` here must match `src/main/http-bridge.ts` exactly, **run `npm run test:mcp:contract` after editing this file** — it fails if any entry maps to a route the bridge does not serve. `npm run test:mcp:surface` verifies the hidden/canonical split.
- **[`bridge-server.ts`](./bridge-server.ts)**:
  Factory `createBridgeMcpServer()` configuring `@modelcontextprotocol/sdk` to forward tool calls to the active browser chassis via `http://127.0.0.1:4111` and package dual text + native base64 PNG image blocks.
- **[`bin/mcp-server.cjs`](../../bin/mcp-server.cjs)** & **[`scripts/mcp-server.js`](../../scripts/mcp-server.js)**:
  Production bundled standalone stdio executable spawned by AI agents and IDEs.

---

## 🩺 Diagnostics & stdio Discipline

**stdout is the JSON-RPC lifeline; stderr is diagnostics only — never block on it.** A client that
pipes stderr but never drains it will fill the OS pipe buffer and wedge the process once the buffer
is full. Because the server used to write ~500 bytes to stderr per tool call, ~125 calls were
enough to kill the whole tool namespace. See
[`docs/HANDOFF_ORCHA_MCP_STDERR.md`](../../docs/HANDOFF_ORCHA_MCP_STDERR.md).

The rules enforced by `bridge-server.ts` (do not regress them):

- **Per-call logs go to the file only** (`data/logs/mcp-server.log`), written through a bounded
  asynchronous queue. Use `logMcp(msg, 'call' | 'boot' | 'error')`; never `console.error`.
- **stderr carries a short boot banner by default**; writes are dropped (not queued) when the
  consumer is not reading, and total stderr is hard-capped at 16 KiB.
- **Env switches:** `KUANG_MCP_LOG=0` (no file log), `KUANG_MCP_STDERR=0` (no stderr),
  `KUANG_MCP_STDERR=verbose` (per-call stderr for debugging only).
- **`KUANG_BRIDGE_TIMEOUT_MS`** (default 300 000) caps any single `:4111` round-trip so a wedged
  Cyberdeck returns an error instead of hanging a tool forever.
- **stdin `end`/`close` shuts the child down cleanly** (`exit(0)`) so it cannot linger as an orphan.
