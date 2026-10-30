# Tool surface consolidation

**Status:** phase 2 implemented (15 advertised +2 optional; presets and per-action instruction overrides)

**Related:** [`TOOL_CATALOG_REVIEW.md`](./TOOL_CATALOG_REVIEW.md), [`../developer/api/browser-mcp.md`](../developer/api/browser-mcp.md)

## Problem

The current `hb-browser` surface is broad and expensive to advertise:

- 68 flat catalog tools (15 advertised groups plus hidden aliases) and two optional decision tools;
- many long, overlapping descriptions;
- several families that are really one operation with different nouns
  (tabs, contexts, downloads, recordings, scripts);
- an agent must read the whole surface before it can choose a first action.

The goal is **fewer names, shorter descriptions and unchanged capability**.
Detailed guidance belongs in `help` and the OKF resources, not in every tool
description.

## Implemented surface

15 base tools, plus optional decision tools when configured. Old flat names are
hidden aliases and remain callable by name; `fill_form` and `recipe` are also
compatibility aliases rather than part of the advertised surface.

| Tool | Absorbs | Action shape |
| --- | --- | --- |
| `navigate` | `navigate_to`, `navigate_history`, `dismiss_consent`, `recipe` | `open`, `back`, `forward`, `reload`, `consent`, `scroll`, `recipe` |
| `observe` | `observe` | `markdown`, `text`, `ax`, `som`, `components` |
| `find` | `find` | semantic target search |
| `act` | `act`, `fill_form`, `press_key`, `scroll_page` | `click`, `focus`, `hover`, `type`, `press`, `scroll`, `fill` (multi-field via `fields`) |
| `wait_for` | `wait_for` | readiness gate |
| `extract` | `extract`, `collect_all` | structured reads, optional `scroll_to_end` |
| `capture` | `take_screenshot`, `snapshot_rendered_page` | `plain`, `marks`, `rendered` |
| `evaluate` | `evaluate_javascript` | deliberate JS execution |
| `devtools` | `page_state`, `diff`, `get_console_logs`, `get_fingerprint_profile`, `bridge_health`, `get_network_traffic`, `query_json_data`, `list_realtime_streams`, `clear_capture`, `export_har` | `state`, `diff`, `console`, `fingerprint`, `health`, `traffic`, `query`, `streams`, `clear`, `har` |
| `human_in_loop` | HIL requests, status/resolve, activity/resume, notifications, window visibility, tray | `request`, `status`, `activity`, `resolve`, `resume`, `notify`, `show`, `hide`, `tray` |
| `browser_workspace` | tabs, downloads, contexts, recordings, scripts | domain-prefixed actions |
| `shadow_iframes` | `frames`, `focus_walk` | `frames`, `focus_walk` |
| `research` | `read_url`, `search_web`, `llm_surface`, `llm_fetch`, `deep_crawl`, `research_topic`, `prerender_links` | discovery/read actions |
| `memory` | `recall_memory`, browsing history, bookmarks | recall/history/bookmark actions |
| `help` | `help` | docs lookup |
| `drive` *(optional)* | `drive` | Tier 1 when a decision model is configured |
| `decide` *(optional)* | `decide` | Tier 1 when a decision model is configured |
| `recipe` *(hidden compatibility)* | `recipe` | Exposed as `navigate({action:"recipe", recipe_action:"list"|"save"|"replay"|"delete"})`; old name remains callable |

`devtools` is deliberately read-only. `evaluate` stays separate because it can
mutate the page and must remain a deliberate Tier 3 action. `export_har`,
network capture and console access belong here, not in `browser_workspace`.

## Description policy

- Top-level tool description: **150-250 characters**.
- Each action description: one line.
- Full examples and recovery rules live in `help` and the existing MCP
  resources.
- Per-workspace overrides remain in Settings -> Tools.
- Do not repeat the same guidance in the tool schema, the tool description and
  an MCP resource.

Target `tools/list` size is roughly 20-25 KB, down from ~62 KB.

## Ordering

The default order follows the operational sequence:

`navigate` -> `observe` -> `act` -> `wait_for` -> `find` -> `extract`

Then capture/evaluate, then domain tools, then `help`.

When a decision model is configured, `drive` and `decide` lead the surface and
are Tier 1. `recipe` remains a hidden compatibility alias until the action UI lands.

## Settings shape

Keep one top-level **Tools** tab with master-detail:

```text
Settings -> Tools
  Preset: Core / Research / Automation / Full
  Tier groups -> tool cards -> detail
  Grouped tools -> inline action accordion
```

No extra navigation level. Action rows carry per-action instruction overrides.
Per-action on/off switches are deliberately not implemented; the tool-level
switch remains the unit of enablement.

## Compatibility

- New meta-tools are canonical.
- Old names remain callable as hidden aliases for one release.
- Old tool-manager settings keep their tool-level order, disabled state and
  instructions; migration maps only known group members.
- The bridge contract test and `tools/list` surface test must cover both the
  new groups and the hidden aliases.

## Implementation phases

1. Group metadata and dispatch layer. **Done**
2. Hidden-alias migration and compatibility tests. **Done**
3. Tools panel action accordion and preset selector. **Done**
4. Per-action instruction overrides and migration. **Done**
5. Docs and release notes. **Done for 1.7.0**
