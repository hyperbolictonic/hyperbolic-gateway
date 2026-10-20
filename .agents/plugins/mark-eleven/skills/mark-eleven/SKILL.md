---
name: mark-eleven
description: Real-world visible Chromium browser navigator with Bézier ghost-cursor telemetry, console access, and token-efficient markdown extraction for multimodal LLMs.
---

# Mark Eleven: Real Browser Navigator for Multimodal LLMs

Mark Eleven connects the LLM to an active, desktop Chromium browser window (`headless: false`) equipped with humanized telemetry to operate the live web without triggering automated bot defenses.

> **One interaction tool.** Every click/focus/hover/type/press goes through `act`, addressed three ways: a **mark id** (`act(3)`), a **CSS selector** (`act(selector="#go")`), or **coordinates** (`act(x=100, y=200)`). Mark ids are preferred. Marks, `find` and selector targeting all traverse **open shadow roots**, so a web-component control (login/signup forms) is addressable like any other element; only `mode:"closed"` roots stay opaque (use coordinates). The older `click_mark` / `type_mark` / `click_element` / `type_text` names still work but are hidden aliases.

## Golden Operational Sequence (Preferential Tool Hierarchy)

To maximize speed, minimize token burn, and eliminate bot shadowbans, ALWAYS follow this 3-tier sequence:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 1 (FIRST CHOICE): Grounded Markdown (`observe(as:"markdown")`)     │
│ • Downsamples page to clean text with inline [#ID] marks.              │
│ • Actuate with `act(id)` (click) or `act(id, action:"type", text=…)`.  │
│ • ZERO image tokens burned, 100% hardware trusted (isTrusted: true).    │
├────────────────────────────────────────────────────────────────────────┤
│ TIER 2 (FALLBACK): `take_screenshot(marks:true, detail:"economy")`     │
│ • Use ONLY when visual layout, complex maps, or CAPTCHAs require vision.│
│ • Downscaled 640px JPEG (~15x lighter than full PNG).                  │
│ • Mark IDs match the markdown marks identically.                       │
├────────────────────────────────────────────────────────────────────────┤
│ TIER 3 (USE DELIBERATELY): Script Inspection (`evaluate_javascript`)   │
│ • A powerful tool: arbitrary page JS that can read AND mutate.         │
│   Reach for it deliberately — observe/extract cover most reads         │
│   and act covers clicks and typing.                                    │
│ • Heavy injected JS is a bot-detection signal (untrusted events),      │
│   so keep it purposeful, not routine.                                  │
└────────────────────────────────────────────────────────────────────────┘
```

## Core Multimodal Workflow

1. **Navigation:**
   - Call `navigate_to({ url })` to load the destination site in the visible window.
2. **Page Understanding (Tier 1 — Grounded Markdown First):**
   - Call `observe({ as: "markdown" })` to read the page content with inline `[#ID]` marks stamped directly on buttons, links, and inputs.
   - Actuate directly with `act({ mark_id })` (click) or `act({ mark_id, action: "type", text })`.
3. **Visual Inspection (Tier 2 Fallback):**
   - Call `take_screenshot({ marks: true, detail: "economy" })` if visual verification or image inspection is needed. Returns a compact 640px JPEG + marks table.
   - `take_screenshot()` with no `marks` is reserved for full-resolution plain captures.
   - `take_screenshot({ marks: true, detail: "markdown" })` (same as `observe({ as: "som" })`) returns the marks table with **no image**.
4. **Humanized Interaction:**
   - Call `act({ mark_id })` to dispatch organic Bézier pointer movement and hardware switch clicks; `act({ selector })` or `act({ x, y })` when you have no badge.
   - Call `act({ mark_id, action: "type", text })` (or `act({ selector, action: "type", text })`) to type with realistic human Gaussian cadence (60-240ms).
   - **Typing appends by default.** On a field that may already hold a value (pre-filled origin/airport boxes, search inputs, comboboxes) pass `clear_first: true` so the value is **replaced** (trusted Ctrl+A + Backspace — React controlled inputs still update). For an autocomplete, type then **commit by clicking the option mark**; free text is often ignored by React selects.
   - Call `press_key({ key })` for single keypresses (`Enter`, `Tab`, `Escape`, `Backspace`).
   - Call `scroll_page({ direction, amount })` to simulate inertia mousewheel scrolling.
5. **Console & Script Execution vs. Hardware Trust (Tier 3):**
   - **BEHAVIORAL TRUST & SHADOWBAN PREVENTION:** For clicks, typing and value changes prefer `act(...)` (genuine hardware events, `isTrusted: true`) over driving them from `evaluate_javascript` on protected sites (e.g. Skyscanner, Google, Cloudflare) — synthetic DOM mutations set `isTrusted: false` and can trigger silent shadow-bans.
   - `evaluate_javascript` remains a powerful tool for what the primitives cannot express — querying computed styles, reading hidden JSON state, calculating values — and it can also mutate. Reach for it deliberately rather than by default.
   - For all interactions, use `act(...)` — it drives genuine hardware events (`isTrusted: true`).
   - **If a click appears to do nothing, do not just re-click it.** Check `diff(since)` and `observe` the form/validation state — an invalid field silently blocks submit and looks exactly like a dropped click. Input is delivered over CDP and is **focus-independent**, so a "lost focus" window is rarely the real cause (confirm with `bridge_health().input.transport`).
   - Call `get_console_logs({ limit })` to inspect page errors and network responses.
6. **Multi-Tab Orchestration:**
   - Call `new_tab({ url })` to open a new isolated browser tab.
   - Call `switch_tab({ tab_id })` to focus another tab.
   - Call `close_tab({ tab_id })` to close an active or specified tab and free memory.
   - Call `list_tabs()` to inspect all active tabs.
7. **Token-Efficient Payload Extraction & Grounded Marked Markdown:**
   - Call `observe({ as: "markdown" })` to downsample the active DOM into clean Markdown with YAML front-matter envelopes, saving 90%+ context window tokens.
   - **Marked Markdown Grounding:** Interactive elements are automatically tagged with inline `[#ID]` markers:
     * Links: `[#1] [Flights](https://...)`
     * Buttons: `[#2] <button>Search Flights</button>`
     * Inputs: `[#3] <input type="text" "Where from?" value="London">`
   - **Zero-Screenshot Workflow:** Read the markdown and immediately call `act(2)` or `act({ mark_id: 3, action: "type", text: "Tokyo" })` straight from the text without taking a screenshot!
   - **Rendered Point-in-Time Snapshots (`snapshot_rendered_page`):** For complex JavaScript SPAs (React, Next.js, Vue) where standard HTML is an unhydrated shell, call `snapshot_rendered_page({ format, force_rerender, save_to_disk })`.
     * `format: "ax_tree"` (Recommended): Extracts an ultra-clean Accessibility Tree outline (roles, labels, values, states like `expanded=`, `checked=`, `disabled`) with zero `<div>` clutter.
     * `format: "markdown"`: Computed DOM markdown with Shadow DOM pierced and live form values preserved.
     * `format: "unrendered_html"`: Raw, pre-mutation initial HTML source before client scripts ran.
     * `format: "html"`: Rendered static HTML with Shadow DOM expanded.
     * `force_rerender: true`: Dispatches resize events and forces reflows to trigger re-renders before snapshotting.
   - **Speculative Pre-rendering Engine (`prerender_links`):** Call `prerender_links({ urls, selector, max_pages })` while reading the current page. Pre-renders and hydrates candidate target links in background views for **0ms instantaneous navigation** on subsequent `navigate_to()` calls, and automatically distills and indexes their content straight into LanceDB Cortex memory (`recall_memory` ready).
8. **LanceDB Persistent Cortex & Semantic Recall:**
   - Call `recall_memory({ query, limit, domain })` to run hybrid semantic vector + BM25 full-text search across all previously browsed and read web pages.
   - Call `browsing_history({ limit, domain })` to view chronological visit history.
   - Call `add_bookmark({ url, title, notes, tags })` to persist important research links with semantic tags.
   - Call `list_bookmarks({ query, tag })` to retrieve or filter saved bookmarks (query terms matched against title, notes, URL, and tags).
   - Call `delete_bookmark({ url_or_id })` to remove a bookmark.
9. **Visual Grounding with Set-of-Marks (SoM) & Cached Mark Re-Use:**
   - **Stop Wasting Tokens on Repeated Screenshots:**
     * Call `take_screenshot({ marks: true, detail: "economy" })` ONCE to orient yourself.
     * **Cached Mark IDs:** Static anchors (inputs, buttons, search bars in cyan badges) maintain **session-sticky Mark IDs** across layout shifts.
     * You can call `act(id)` repeatedly without taking a new screenshot! The browser chassis dynamically tracks the element's live bounding box even if it moved.
     * If you need an updated list of element IDs or input values without downloading an image, call `observe({ as: "som" })` (~15ms, 0 image tokens).
   - **Economy mode (`detail: "economy"`):** Use this as your default visual tool for vision models — a 640px JPEG (~15x lighter than full PNG) with the exact same badge numbers.
   - **Text-only mode (`observe({ as: "som" })` or `detail: "markdown"`):** Marks table with NO image. Ideal when vision isn't strictly required.
   - Call `act({ mark_id })` to dispatch humanized Bézier pointer movement and hardware switch clicks.
   - Call `act({ mark_id, action: "type", text })` to focus and type with human Gaussian cadence variance.
   - Mark lines are accessibility-aware: `[#4] <INPUT role=combobox> "Country" {value="UK", expanded=false, required}`. Labels come from `aria-label`, `aria-labelledby`, `<label>`, visible text, alt/placeholder. State flags: `disabled`, `expanded=`, `checked`, `selected`, `pressed=`, `required`, `invalid`, `haspopup=`, `readonly`. Do NOT click marks flagged `disabled`. Use `value=` to verify what was typed or selected.
   - **Custom dropdowns (div-based selects, React Select, Radix, MUI):** `act` the trigger (look for `haspopup=` / `expanded=false`), then call `observe({ as: "som" })` again. Options of an open popup (`role=option`/`menuitem`) are numbered first. `act` the option, then re-scan to confirm (`expanded=false` and the trigger's `value`/text changed). Mark IDs are re-assigned on every scan, so always re-scan after the page changes.
   - Elements covered by a modal or open menu are not marked. Plain clickable divs with no ARIA are detected via `cursor: pointer`. If a widget is still missing, fall back to `act({ x, y })` or `evaluate_javascript`.
10. **Single-Turn Batch Form Filler:**
   - Call `fill_form({ fields, submit_selector })` to populate multiple inputs, selects, radios, and checkboxes in a single turn with human typing cadence.
11. **Autonomous Shield-Breaker:**
   - Cookie consent dialogs (OneTrust, Cookiebot, Google GDPR, TrustArc) are auto-dismissed on navigation.
   - Call `dismiss_consent()` to manually force-dismiss any remaining consent banners.
12. **Download Manager & Harvester:**
   - Files are automatically routed to `data/downloads/` and indexed into Cortex.
   - Call `list_downloads()` to inspect completed downloads.
   - Call `read_download({ filename })` to read parsed markdown text (PDFs, CSVs, JSON).
13. **Session & Cookie Jar Vault:**
   - Call `context_save({ name })` to snapshot cookies + localStorage into a named profile.
   - Call `context_open({ name })` to rehydrate an authenticated profile.
   - Call `context_list()` to view saved profiles.
14. **Live Network & API Interception:**
   - Call `get_network_traffic({ url_pattern, method, resource_type, limit })` to inspect captured XHR/Fetch/document HTTP requests (returns compact 1-line markdown summaries).
   - Call `query_json_data({ source: "network_payload", source_id: "<req_id>" })` to fetch JSON or structured responses directly from the API layer.
   - Call `clear_capture({ scope: "network" })` to reset the network request ring buffer.
15. **Token-Efficient JSON Navigator (`query_json_data`):**
   - Avoid context-window overflow and file offloading by navigating large JSON payloads directly without dumping multi-megabyte objects.
   - Sources: `"network_payload"` (by `request_id`), `"stream_messages"` (by `stream_id`), `"download_file"` (by `filename`), or `"inline_json"`.
   - **Step 1 — Schema Inspection:** Call `query_json_data({ source: "network_payload", source_id: "<req_id>", view: "schema" })` to see structural outline and array lengths (e.g. `itineraries: Array(45) { price: number, legs: Array }`).
   - **Step 2 — Dot/Bracket Path Extraction:** Drill down directly: `path: "content.results.itineraries[0..3].pricingOptions"`.
   - **Step 3 — Wildcards & Predicate Filters:** Filter arrays without code: `filter_predicate: "price < 300"` or inline `path: "items[?price < 300].name"`. (Tip: Predicates evaluate against the object level before projecting to a leaf property like `.name`).
   - Views: `"value"` (default extracted result), `"schema"` (type summary), `"keys"` (top-level property names), `"summary"` (entry count, depth, size).
   - Automatic truncation: Strings over `max_string_length` (default: 200 chars) are clipped to prevent base64/HTML blowups; arrays are capped at `max_items` (default: 50).
16. **Script Vault & Semantic Macro Engine:**
   - Call `save_script({ name, description, code, parameters })` to persist DOM scripts and vector-embed them in LanceDB.
   - Call `list_scripts({ query, tag, limit })` to list vaulted scripts or semantically search them by natural language (`query` ranks by relevance).
   - Call `run_script({ name, args })` to execute a vaulted script in the active tab with dynamic arguments.
   - Call `list_scripts()` (no query) or `delete_script({ name })` to enumerate/manage scripts.
17. **Real-Time WebSocket & SSE Interception:**
   - Call `list_realtime_streams({ type, active_only })` to inspect active and recent `wss://` WebSockets and SSE streams.
   - Call `query_json_data({ source: "stream_messages", source_id: "<stream_id>" })` to inspect streaming frames and auto-parsed JSON payloads.
   - Call `clear_capture({ scope: "streams" })` to clear streaming frame buffers (HTTP traffic uses `scope: "network"`; omit `scope` to clear both).
18. **Desktop & System Tray Management:**
   - Call `set_window_visibility({ visible, focus })` to minimize the cyberdeck window to the system tray to stay out of the user's way, or restore to screen (showing focuses it by default).
   - Call `configure_system_tray({ close_to_tray })` to enable or disable background minimization when closing the window.
19. **Human-In-The-Loop (HIL) Intervention & Desktop Notifications:**
   - **CRITICAL DIRECTIVE — PROACTIVE HIL USAGE:** Do NOT get stuck in loops, guess passwords, or attempt to bypass complex bot defenses autonomously. If you encounter any of the following, call `request_human_intervention` IMMEDIATELY:
     1. **Bot Checkpoints:** Cloudflare Turnstile, reCAPTCHA, hCaptcha, Arkose Labs, or Cloudflare challenge pages.
     2. **Authentication:** Login forms requiring user credentials, 2FA/MFA, SMS OTP codes, or email verification links.
     3. **High-Stakes Actions:** Payment checkout forms, credit card entry, or final booking confirmations.
     4. **Ambiguity / Hard Roadblocks:** When the target page structure is completely unexpected or blocked and you need the user to clarify.
   - Calling `request_human_intervention({ reason, timeout_seconds, bring_to_front: true })` immediately alerts the user with an audible OS desktop notification, unhides and brings the browser window to the front, flashes the Windows taskbar, and injects a prominent HUD banner. Once the human solves the checkpoint, execution resumes automatically.
   - Call `resolve_human_intervention({ id, notes })` to programmatically resolve a pending intervention.
   - Call `get_human_intervention_status()` to inspect active request status and history.
   - Call `send_notification({ title, message, urgency, sound })` to emit non-blocking desktop notifications.
20. **Operational Manual & Tool Discovery:**
   - Call `help({ category })` to query a complete, detailed operational cheatsheet of the 59 advertised tools, parameters, and design principles.
   - Call `bridge_health()` once per session to read `capabilities[]`, `revision`, `window`, and `input.transport` (`cdp` = focus-independent delivery, `native` = legacy fallback).
   - Prefer the **orthogonal primitives** below over blind sleeps and guessy selectors. The full recipe set (R1–R5), wait vocabulary and error catalogue is available as the OKF resource `mark-eleven://okf/partitions/primitives-and-workflows`.

## Orthogonal Primitive Layer (prefer these)

One observation model, one action model, one wait model — the flat verbs above become projections.

**Tiers** (mirrors the `[TIER n]` prefixes on the advertised descriptions). **TIER 1 · prefer:** `observe`, `act`, `wait_for`, `expect`, `find`, `extract`, `collect_all`, `page_state`, `diff`. **TIER 2 · fallback:** `take_screenshot`, `snapshot_rendered_page`, `press_key`. **TIER 3 · use deliberately:** `evaluate_javascript` (powerful, just not the default). Every other tool is unprefixed — it is the only way to do its job.

- `wait_for(conditions[], require?, timeout_ms?, poll_ms?)` — declarative readiness gate; replaces every sleep. Condition types: `selector`, `gone`, `text`/`regex`, `url`, `role_name`, `count(min/equals/max)`, `network_idle`, `stable(target:"marks"|"height"|"text"|"nodes")`, `revision`. **Warning:** skeletons can satisfy a naive `selector` early — prefer `stable`/`count` for lazily-rendered lists.
- `act(mark_id? | selector? | x?+y?, action, text?, secret?, await_conditions?, timeout_ms?, dry_run?)` - the one humanlike interaction verb (`click`/`focus`/`hover`/`type`/`press`), addressed by mark badge, CSS selector, or coordinates, with optional post-conditions and a delta report. `dry_run:true` resolves without acting; `secret:true` redacts credentials from logs. Do "act then wait" in one round trip. Selectors pierce open shadow roots and resolve a custom-element host to the control a mouse would hit, so `#email` reaches the inner `<input>`. **Typing is verified** - a provable no-op returns `ok:false` with `error.code "TYPE_NO_EFFECT"` plus `typing` evidence (`keydowns:0` = input never arrived; events but unchanged value = the control rejects synthetic input, e.g. OTP - hand over to `request_human_intervention`).
- `find(role?, name?, contains?, regex?, tag?, selector?)` — semantic search → **mark refs**; feed ids straight into `act`.
- `extract(kind:"list"|"table"|"tables"|"app_data"|"schema_org", ref?, selector?, type?)` — structured reads: repeating rows, one table, every table, embedded app JSON (`__NEXT_DATA__`/JSON-LD), or **typed schema.org items** (`type` filters e.g. `"Recipe"`). For the clean article body (Readability) use `observe(as:"markdown")`.
- `collect_all(selector?, ref?, scroll?, max_scrolls?, max?)` — scroll a lazy/infinite list to the end and dedupe rows (by text+href) in **one call**, with scroll diagnostics. Use `scroll:"window"` for page-level infinite scroll.
- `observe(as:"markdown"|"text"|"ax"|"som", region?, budget?, cursor?)` — one observation model; page a huge page with `budget` + `next_cursor` instead of truncating. (Structured list/table/app-data reads live on `extract`.)
- `llm_surface(url?)` / `llm_fetch(url?, as?)` — read a site's *own* Markdown/Text (`/llms.txt`, a `<link rel="alternate">`, or content negotiation) instead of rendering; **GATED** on an advertised surface (`NO_LLM_SURFACE` otherwise). Falls back to `observe(as:"markdown")` when there is none.
- `search_web(query, engine?, engines?, url_template?, max_results?)` — multi-engine search (google | duckduckgo | bing | brave | startpage | custom) in a **detached view** (your active tab is untouched) with automatic engine fallback on bot-checks; returns ranked `{title,url,snippet}` to feed `navigate_to` / `collect_all`.
- `deep_crawl(url, max_depth?, max_pages?, match_patterns?, same_origin?, prefer_llm?, harvest_to_cortex?)` — **autonomous BFS crawl**: follows same-origin links within depth/page budgets, distills each page to Markdown, and indexes it into **Cortex**. Each page takes the cheap path first (content-negotiated Markdown/Text, else a render). Use `match_patterns` (glob or `/regex/`) to scope.
- `research_topic(query, max_sources?, engine?, url_template?)` — **autonomous research mode**: searches, gathers the top sources, distills them, and indexes them into **Cortex**. Returns **extractive, cited evidence** (highlights are real paragraphs from the sources) — it does **not** write prose, so synthesize the answer yourself (and use `recall_memory` for follow-ups).
- `expect(conditions[])` — immediate assertion (no polling) with per-condition evidence.
- `page_state()` / `diff(since?)` — cheap change signature + field-by-field diff for loops (no full re-reads).
- `export_har(pattern?, limit?, save?)` — HAR 1.2 export of captured traffic; `get_network_traffic({ since:"last_action" })` returns only what the last mutating action fired.
- `context_save/open/list/delete(name)` — named cookie/storage profiles (thin aliases over the session vault).
- **Structured errors** (HTTP 400): `STALE_REF` (re-scan the page and re-issue), `TIMEOUT`, `NO_TARGET`, `BAD_REQUEST`, `NOT_SUPPORTED`.
- **Input is focus-independent:** clicks/typing/wheel are delivered over CDP and land even when another app owns the OS foreground. If a tab reports a `0x0` viewport, call `set_window_visibility({visible:true})` and wait for a non-zero viewport before acting.
