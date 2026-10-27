---
type: API Reference
title: Browser MCP API
description: The hb-browser server, its tool groups, MCP resources, call shape, and recovery rules.
tags: [api, mcp, hb-browser, tools]
status: stable
---

# Browser MCP API

`hb-browser` is the MCP server that drives the visible Chromium session. It
exposes 63 advertised tools and a small set of MCP resources. It is configured
and started by the agent client; the app must already be running.

- Binary: `bin/mcp-server.cjs`
- Transport: stdio JSON-RPC
- Bridge: `HB_BRIDGE_URL`, default `http://127.0.0.1:4111`
- Legacy server label: `kuang`
- Legacy environment prefix: `KUANG_*`

## Call shape

Every call is a standard MCP tool call:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "observe",
    "arguments": { "as": "markdown", "budget": 12000 }
  }
}
```

Tool schemas are authoritative in `tools/list`; the source of truth is
`src/mcp/tools-catalog.ts`. Deprecated names remain callable but are hidden
from `tools/list`.

## Tool groups

The group names below are a reading aid. Some advanced primitives overlap with
older tools; use the canonical name from `tools/list`.

### Navigation and history

| Tool | Purpose |
| --- | --- |
| `navigate_to` | Navigate the visible browser; dismiss common consent overlays by default. |
| `navigate_history` | Go back, forward, or reload. |

### Consent and input

| Tool | Purpose |
| --- | --- |
| `dismiss_consent` | Detect and dismiss cookie/GDPR modals. |
| `act` | Unified click, focus, hover, type, or key press on a mark, selector, or coordinate. |
| `fill_form` | Fill several fields in one turn. |
| `press_key` | Dispatch a single hardware key. |
| `scroll_page` | Organic inertial wheel scrolling. |

`act` is the preferred interaction entry point. It accepts `mark_id`,
`selector`, or `x` + `y`, plus `await_conditions`, `timeout_ms`, `dry_run`,
and `secret` for typed values.

### Observation and inspection

| Tool | Purpose |
| --- | --- |
| `observe` | Budgeted, cursor-paged page projection. |
| `take_screenshot` | Viewport image or Set-of-Marks image. |
| `snapshot_rendered_page` | Post-hydration AX tree, Markdown, or HTML. |
| `prerender_links` | Pre-fetch and hydrate likely next pages. |
| `evaluate_javascript` | Evaluate JavaScript in the active tab. Powerful and detectable; use deliberately. |
| `get_console_logs` | Read browser console output. |
| `get_fingerprint_profile` | Inspect the current browser fingerprint profile. |

`observe` projections: `markdown`, `text`, `ax`, `som`, `components`, `list`,
`table`, and `app_data`. `budget` and `next_cursor` page a large result;
`budget: 0` returns the whole construct.

### Tabs

| Tool | Purpose |
| --- | --- |
| `new_tab` | Create an isolated tab. |
| `switch_tab` | Focus another tab. |
| `close_tab` | Close a tab. |
| `list_tabs` | List open tabs. |

### Cortex memory and bookmarks

| Tool | Purpose |
| --- | --- |
| `recall_memory` | Semantic recall from LanceDB Cortex. |
| `browsing_history` | Read browsing history. |
| `browsing_history_clear` | Clear browsing history. |
| `add_bookmark` | Add a bookmark. |
| `list_bookmarks` | List bookmarks. |
| `delete_bookmark` | Remove a bookmark. |

### Downloads

| Tool | Purpose |
| --- | --- |
| `list_downloads` | List downloaded files. |
| `read_download` | Read a downloaded file. |

### Context profiles

| Tool | Purpose |
| --- | --- |
| `context_save` | Snapshot cookies and storage. |
| `context_open` | Restore a saved context. |
| `context_list` | List context profiles. |
| `context_delete` | Delete a context profile. |

### Network and streams

| Tool | Purpose |
| --- | --- |
| `get_network_traffic` | Compact HTTP request/response summaries. |
| `query_json_data` | Query captured network, stream, download, or inline JSON. |
| `list_realtime_streams` | List WebSocket and SSE streams. |
| `clear_capture` | Clear network traffic, stream frames, or both. |

### Script vault

| Tool | Purpose |
| --- | --- |
| `save_script` | Save a reusable script/macro. |
| `list_scripts` | List or semantically search scripts. |
| `run_script` | Run a saved script. |
| `delete_script` | Delete a saved script. |

### Window, tray, and human intervention

| Tool | Purpose |
| --- | --- |
| `set_window_visibility` | Show/hide and focus the app window. |
| `configure_system_tray` | Configure close-to-tray behaviour. |
| `request_human_intervention` | Pause for login, CAPTCHA, 2FA, payment, or another human step. |
| `resolve_human_intervention` | Mark a human request resolved. |
| `get_human_intervention_status` | Read the active request. |
| `send_notification` | Native OS notification. |

### Primitives and abstraction

| Tool | Purpose |
| --- | --- |
| `wait_for` | Declarative readiness gate; replaces sleeps. |
| `observe` | The primary page read. |
| `extract` | Structured list, table, embedded app data, or JSON-LD. |
| `collect_all` | Scroll and deduplicate a lazy or virtualized list. |
| `find` | Semantic element search returning mark ids. |
| `expect` | Immediate assertion over the same conditions as `wait_for`. |
| `act` | Unified humanlike action with optional post-conditions. |
| `page_state` | Cheap monotonic page signature. |
| `diff` | Field-by-field change since a revision. |
| `bridge_health` | Liveness, version, capabilities, window, and input transport. |
| `export_har` | HAR 1.2 export of captured traffic. |

Condition types for `wait_for` and `expect` include `selector`, `gone`, `text`,
`regex`, `url`, `role_name`, `count`, `network_idle`, `stable`, and `revision`.
Prefer `stable` or `count` over a naive selector when a page renders lazily.

### Discovery

| Tool | Purpose |
| --- | --- |
| `llm_surface` | Probe `/llms.txt`, alternates, sitemap, or Markdown negotiation. |
| `llm_fetch` | Fetch an advertised representation. Gated by `llm_surface`. |
| `read_url` | Read a URL as Markdown, using the site representation or a detached render. |
| `search_web` | Multi-engine search in a detached view. |
| `deep_crawl` | Bounded breadth-first crawl with optional Cortex indexing. |
| `research_topic` | Search, gather, distill, and return cited extractive highlights. |

### Recording

| Tool | Purpose |
| --- | --- |
| `record_start` | Start a timelapse recording. |
| `record_stop` | Stop and save a WebM recording. |
| `list_recordings` | List saved recordings. |

Recording tools can be removed by a human-only switch in Settings. When
disabled, `tools/list` omits them and the bridge refuses direct calls.

### Help and optional decisions

| Tool | Purpose |
| --- | --- |
| `help` | Tool guidance and recommended workflows. |
| `decide` | Optional typed decision, only when a decision backend is configured. |
| `drive` | Optional observe-decide-act loop, only when configured. |

`decide` and `drive` are absent unless Settings has a decision model
configured. They are not a replacement for deterministic `find` + `act`.

## MCP resources

The browser server also exposes:

- `mark-eleven://skills/guide` - the operational manual.
- `mark-eleven://tools/recommended` - recommended tool order for common jobs.
- `mark-eleven://okf/manifest` - the legacy bundle manifest.
- Four OKF partition resources for selectors, CAPTCHA handling, navigation,
  and primitives.

The partitions are readable Markdown and are useful when a client does not
want to fetch the repository.

## Errors

Tools return an MCP error result with a machine-readable code in the text.
Common browser codes are `STALE_REF`, `TIMEOUT`, `NO_TARGET`, `BAD_REQUEST`,
`NOT_SUPPORTED`, `TYPE_NO_EFFECT`, `HUMAN_IN_PROGRESS`, `NO_LLM_SURFACE`, and
`FETCH_BLOCKED`.

If the bridge is down, the call fails with a connection error that names
`HB_BRIDGE_URL`. Start the app or fix the bridge URL. See
[Error catalogue](../formats/errors.md).

## Recommended workflow

```text
bridge_health
  -> observe(as:"markdown") or read_url
  -> find / extract
  -> act(mark_id, await_conditions)
  -> expect / diff
```

Use `take_screenshot` or Set-of-Marks when geometry matters. Use
`evaluate_javascript` only when the structured primitives cannot do the job.
