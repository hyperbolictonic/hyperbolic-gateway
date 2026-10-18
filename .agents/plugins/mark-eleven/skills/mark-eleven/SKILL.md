---
name: mark-eleven
description: Real-world visible Chromium browser navigator with Bézier ghost-cursor telemetry, console access, and token-efficient markdown extraction for multimodal LLMs.
---

# Mark Eleven: Real Browser Navigator for Multimodal LLMs

Mark Eleven connects the LLM to an active, desktop Chromium browser window (`headless: false`) equipped with humanized telemetry to operate the live web without triggering automated bot defenses.

## Golden Operational Sequence (Preferential Tool Hierarchy)

To maximize speed, minimize token burn, and eliminate bot shadowbans, ALWAYS follow this 3-tier sequence:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 1 (FIRST CHOICE): Grounded Markdown (`get_page_markdown`)         │
│ • Downsamples page to clean text with inline [#ID] marks.              │
│ • You can immediately call `click_mark(id)` or `type_mark(id, text)`.   │
│ • ZERO image tokens burned, 100% hardware trusted (isTrusted: true).    │
├────────────────────────────────────────────────────────────────────────┤
│ TIER 2 (FALLBACK): Set-of-Marks Screenshot (`take_economy_screenshot`) │
│ • Use ONLY when visual layout, complex maps, or CAPTCHAs require vision.│
│ • Downscaled 640px JPEG (~15x lighter than full PNG).                  │
│ • Mark IDs match the markdown marks identically.                       │
├────────────────────────────────────────────────────────────────────────┤
│ TIER 3 (LAST RESORT): Script Inspection (`evaluate_javascript`)        │
│ • Use STRICTLY for read-only DOM inspection, calculating values, or    │
│   querying hidden attributes.                                          │
│ • NEVER use JS to artificially set input values (`el.value = ...`) or  │
│   dispatch synthetic clicks (`el.click()`) on protected sites! That   │
│   sets `isTrusted: false` and triggers silent bot shadowbans.          │
└────────────────────────────────────────────────────────────────────────┘
```

## Core Multimodal Workflow

1. **Navigation:**
   - Call `navigate_to({ url })` to load the destination site in the visible window.
2. **Page Understanding (Tier 1 — Grounded Markdown First):**
   - Call `get_page_markdown()` to read the page content with inline `[#ID]` marks stamped directly on buttons, links, and inputs.
   - Actuate directly using `click_mark(id)` or `type_mark(id, text)`.
3. **Visual Inspection (Tier 2 Fallback):**
   - Call `take_economy_screenshot()` if visual verification or image inspection is needed. Returns compact 640px JPEG + marks table.
   - `take_screenshot()` is reserved for full-resolution native captures.
4. **Humanized Interaction:**
   - Call `click_mark({ mark_id })` or `click_element({ selector })` to dispatch organic Bézier pointer movement and hardware switch clicks.
   - Call `type_mark({ mark_id, text })` or `type_text({ text, selector })` to type with realistic human Gaussian cadence (60-240ms).
   - Call `press_key({ key })` for single keypresses (`Enter`, `Tab`, `Escape`, `Backspace`).
   - Call `scroll_page({ direction, amount })` to simulate inertia mousewheel scrolling.
5. **Console & Script Execution vs. Hardware Trust (Tier 3):**
   - **BEHAVIORAL TRUST & SHADOWBAN PREVENTION:** Avoid using `evaluate_javascript` to artificially mutate form values or trigger synthetic clicks on protected sites (e.g. Skyscanner, Google, Cloudflare). Synthetic DOM mutations set `isTrusted: false` and can trigger silent shadow-bans.
   - Use `evaluate_javascript` strictly for **read-only DOM inspection**, querying computed styles, or checking JSON state.
   - For all interactions, use genuine hardware events: `type_mark`, `click_mark`, `type_text`, or `click_element` (`isTrusted: true`).
   - Call `get_console_logs({ limit })` to inspect page errors and network responses.
5. **Multi-Tab Orchestration:**
   - Call `new_tab({ url })` to open a new isolated browser tab.
   - Call `switch_tab({ tab_id })` to focus another tab.
   - Call `close_tab({ tab_id })` to close an active or specified tab and free memory.
   - Call `list_tabs()` to inspect all active tabs.
6. **Token-Efficient Payload Extraction & Grounded Marked Markdown:**
   - Call `get_page_markdown({ include_marks: true })` (or `harvest_markdown()`) to downsample the active DOM into clean Markdown with YAML front-matter envelopes, saving 90%+ context window tokens.
   - **Marked Markdown Grounding:** Interactive elements are automatically tagged with inline `[#ID]` markers:
     * Links: `[#1] [Flights](https://...)`
     * Buttons: `[#2] <button>Search Flights</button>`
     * Inputs: `[#3] <input type="text" "Where from?" value="London">`
   - **Zero-Screenshot Workflow:** You can read the markdown and immediately call `click_mark(2)` or `type_mark(3, "Tokyo")` directly from the text without taking a screenshot!
   - **Rendered Point-in-Time Snapshots (`snapshot_rendered_page`):** For complex JavaScript SPAs (React, Next.js, Vue) where standard HTML is an unhydrated shell, call `snapshot_rendered_page({ format, force_rerender, save_to_disk })`.
     * `format: "ax_tree"` (Recommended): Extracts an ultra-clean Accessibility Tree outline (roles, labels, values, states like `expanded=`, `checked=`, `disabled`) with zero `<div>` clutter.
     * `format: "markdown"`: Computed DOM markdown with Shadow DOM pierced and live form values preserved.
     * `format: "unrendered_html"`: Raw, pre-mutation initial HTML source before client scripts ran.
     * `format: "html"`: Rendered static HTML with Shadow DOM expanded.
     * `force_rerender: true`: Dispatches resize events and forces reflows to trigger re-renders before snapshotting.
   - **Speculative Pre-rendering Engine (`prerender_links`):** Call `prerender_links({ urls, selector, max_pages })` while reading the current page. Pre-renders and hydrates candidate target links in background views for **0ms instantaneous navigation** on subsequent `navigate_to()` calls, and automatically distills and indexes their content straight into LanceDB Cortex memory (`recall_memory` ready).
7. **LanceDB Persistent Cortex & Semantic Recall:**
   - Call `recall_memory({ query, limit, domain })` to run hybrid semantic vector + BM25 full-text search across all previously browsed and read web pages.
   - Call `get_history({ limit, domain })` to view chronological visit history.
   - Call `add_bookmark({ url, title, notes, tags })` to persist important research links with semantic tags.
   - Call `list_bookmarks({ query, tag })` to retrieve or semantically search saved bookmarks.
   - Call `delete_bookmark({ url_or_id })` to remove a bookmark.
8. **Visual Grounding with Set-of-Marks (SoM) & Cached Mark Re-Use:**
   - **Stop Wasting Tokens on Repeated Screenshots:**
     * Call `take_annotated_screenshot()` or `take_economy_screenshot()` ONCE to orient yourself.
     * **Cached Mark IDs:** Static anchors (inputs, buttons, search bars in cyan badges) maintain **session-sticky Mark IDs** across layout shifts.
     * You can call `click_mark(id)` or `type_mark(id, text)` repeatedly without taking a new screenshot! The browser chassis dynamically tracks the element's live bounding box even if it moved.
     * If you need an updated list of element IDs or input values without downloading an image, call `list_marks()` (~15ms, 0 image tokens).
   - **Economy mode (`take_economy_screenshot`):** Use this as your default visual tool for vision models—it produces a 640px JPEG (~15x lighter than full PNG) with the exact same badge numbers.
   - **Text-only mode (`list_marks`):** Marks table with NO image. Ideal when vision isn't strictly required.
   - Call `click_mark({ mark_id })` to dispatch humanized Bézier pointer movement and hardware switch clicks.
   - Call `type_mark({ mark_id, text, clear_first })` to focus and type with human Gaussian cadence variance.
   - Mark lines are accessibility-aware: `[#4] <INPUT role=combobox> "Country" {value="UK", expanded=false, required}`. Labels come from `aria-label`, `aria-labelledby`, `<label>`, visible text, alt/placeholder. State flags: `disabled`, `expanded=`, `checked`, `selected`, `pressed=`, `required`, `invalid`, `haspopup=`, `readonly`. Do NOT click marks flagged `disabled`. Use `value=` to verify what was typed or selected.
   - **Custom dropdowns (div-based selects, React Select, Radix, MUI):** `click_mark` the trigger (look for `haspopup=` / `expanded=false`), then call `list_marks()` again. Options of an open popup (`role=option`/`menuitem`) are numbered first. `click_mark` the option, then re-scan to confirm (`expanded=false` and the trigger's `value`/text changed). Mark IDs are re-assigned on every scan, so always re-scan after the page changes.
   - Elements covered by a modal or open menu are not marked. Plain clickable divs with no ARIA are detected via `cursor: pointer`. If a widget is still missing, fall back to `click_element({ x, y })` or `evaluate_javascript`.
9. **Single-Turn Batch Form Filler:**
   - Call `fill_form({ fields, submit_selector })` to populate multiple inputs, selects, radios, and checkboxes in a single turn with human typing cadence.
10. **Autonomous Shield-Breaker:**
   - Cookie consent dialogs (OneTrust, Cookiebot, Google GDPR, TrustArc) are auto-dismissed on navigation.
   - Call `dismiss_consent()` to manually force-dismiss any remaining consent banners.
11. **Download Manager & Harvester:**
   - Files are automatically routed to `data/downloads/` and indexed into Cortex.
   - Call `list_downloads()` to inspect completed downloads.
   - Call `read_download({ filename })` to read parsed markdown text (PDFs, CSVs, JSON).
12. **Session & Cookie Jar Vault:**
   - Call `save_session({ name })` to snapshot cookies, localStorage, and sessionStorage.
   - Call `restore_session({ name })` to rehydrate authenticated sessions.
   - Call `list_sessions()` to view saved sessions.
13. **Live Network & API Interception:**
   - Call `get_network_traffic({ url_pattern, method, resource_type, limit })` to inspect captured XHR/Fetch/document HTTP requests (returns compact 1-line markdown summaries).
   - Call `get_api_payload({ request_id })` to fetch JSON or structured responses directly from the API layer.
   - Call `clear_network_traffic()` to reset the network request ring buffer.
14. **Token-Efficient JSON Navigator (`query_json_data`):**
   - Avoid context-window overflow and file offloading by navigating large JSON payloads directly without dumping multi-megabyte objects.
   - Sources: `"network_payload"` (by `request_id`), `"stream_messages"` (by `stream_id`), `"download_file"` (by `filename`), or `"inline_json"`.
   - **Step 1 — Schema Inspection:** Call `query_json_data({ source: "network_payload", source_id: "<req_id>", view: "schema" })` to see structural outline and array lengths (e.g. `itineraries: Array(45) { price: number, legs: Array }`).
   - **Step 2 — Dot/Bracket Path Extraction:** Drill down directly: `path: "content.results.itineraries[0..3].pricingOptions"`.
   - **Step 3 — Wildcards & Predicate Filters:** Filter arrays without code: `filter_predicate: "price < 300"` or inline `path: "items[?price < 300].name"`. (Tip: Predicates evaluate against the object level before projecting to a leaf property like `.name`).
   - Views: `"value"` (default extracted result), `"schema"` (type summary), `"keys"` (top-level property names), `"summary"` (entry count, depth, size).
   - Automatic truncation: Strings over `max_string_length` (default: 200 chars) are clipped to prevent base64/HTML blowups; arrays are capped at `max_items` (default: 50).
15. **Script Vault & Semantic Macro Engine:**
   - Call `save_script({ name, description, code, parameters })` to persist DOM scripts and vector-embed them in LanceDB.
   - Call `recall_script({ query, limit })` to semantically search for reusable scripts using natural language.
   - Call `run_script({ name, args })` to execute a vaulted script in the active tab with dynamic arguments.
   - Call `list_scripts()` or `delete_script({ name })` to manage scripts.
16. **Real-Time WebSocket & SSE Interception:**
   - Call `list_realtime_streams({ type, active_only })` to inspect active and recent `wss://` WebSockets and SSE streams.
   - Call `get_stream_messages({ stream_id, type, direction, limit })` to inspect streaming frames and auto-parsed JSON payloads.
   - Call `clear_stream_messages({ stream_id })` to clear streaming frame buffers.
17. **Desktop & System Tray Management:**
   - Call `set_window_visibility({ visible })` to minimize the cyberdeck window to the system tray to stay out of the user's way, or restore to screen.
   - Call `configure_system_tray({ close_to_tray })` to enable or disable background minimization when closing the window.
18. **Human-In-The-Loop (HIL) Intervention & Desktop Notifications:**
   - **CRITICAL DIRECTIVE — PROACTIVE HIL USAGE:** Do NOT get stuck in loops, guess passwords, or attempt to bypass complex bot defenses autonomously. If you encounter any of the following, call `request_human_intervention` IMMEDIATELY:
     1. **Bot Checkpoints:** Cloudflare Turnstile, reCAPTCHA, hCaptcha, Arkose Labs, or Cloudflare challenge pages.
     2. **Authentication:** Login forms requiring user credentials, 2FA/MFA, SMS OTP codes, or email verification links.
     3. **High-Stakes Actions:** Payment checkout forms, credit card entry, or final booking confirmations.
     4. **Ambiguity / Hard Roadblocks:** When the target page structure is completely unexpected or blocked and you need the user to clarify.
   - Calling `request_human_intervention({ reason, timeout_seconds, bring_to_front: true })` immediately alerts the user with an audible OS desktop notification, unhides and brings the browser window to the front, flashes the Windows taskbar, and injects a prominent HUD banner. Once the human solves the checkpoint, execution resumes automatically.
   - Call `resolve_human_intervention({ id, notes })` to programmatically resolve a pending intervention.
   - Call `get_human_intervention_status()` to inspect active request status and history.
   - Call `send_notification({ title, message, urgency, sound })` to emit non-blocking desktop notifications.
   - Call `send_desktop_notification({ message, title, urgency, sound })` to summon human operator with critical sound/banner.
19. **Operational Manual & Tool Discovery:**
   - Call `help({ category })` to query a complete, detailed operational cheatsheet of all 74 available tools, parameters, and design principles.
   - Call `bridge_health()` once per session to read `capabilities[]`, `revision`, `window`, and `input.transport` (`cdp` = focus-independent delivery, `native` = legacy fallback).
   - Prefer the **orthogonal primitives** below over blind sleeps and guessy selectors. The full recipe set (R1–R5), wait vocabulary and error catalogue is available as the OKF resource `mark-eleven://okf/partitions/primitives-and-workflows`.

## Orthogonal Primitive Layer (prefer these)

One observation model, one action model, one wait model — the flat verbs above become projections.

- `wait_for(conditions[], require?, timeout_ms?, poll_ms?)` — declarative readiness gate; replaces every sleep. Condition types: `selector`, `gone`, `text`/`regex`, `url`, `role_name`, `count(min/equals/max)`, `network_idle`, `stable(target:"marks"|"height"|"text"|"nodes")`, `revision`. **Warning:** skeletons can satisfy a naive `selector` early — prefer `stable`/`count` for lazily-rendered lists.
- `act(mark_id, action, text?, secret?, await_conditions?, timeout_ms?, dry_run?)` — unified humanlike `click`/`focus`/`hover`/`type`/`press` with optional post-conditions and a delta report. `dry_run:true` resolves without acting; `secret:true` redacts credentials from logs. Do "act then wait" in one round trip.
- `find(role?, name?, contains?, regex?, tag?, selector?)` — semantic search → **mark refs**; feed ids straight into `act`/`click_mark`.
- `extract(kind:"list"|"table"|"app_data", ref?, selector?)` — structured reads: repeating rows, table records, embedded app JSON (`__NEXT_DATA__`/JSON-LD).
- `collect_all(selector?, ref?, scroll?, max_scrolls?, max?)` — scroll a lazy/infinite list to the end and dedupe rows (by text+href) in **one call**, with scroll diagnostics. Use `scroll:"window"` for page-level infinite scroll.
- `observe(as:"markdown"|"text"|"ax"|"som"|"list"|"table"|"app_data", region?, budget?, cursor?)` — one observation model; page a huge page with `budget` + `next_cursor` instead of truncating.
- `expect(conditions[])` — immediate assertion (no polling) with per-condition evidence.
- `page_state()` / `diff(since?)` — cheap change signature + field-by-field diff for loops (no full re-reads).
- `export_har(pattern?, limit?, save?)` — HAR 1.2 export of captured traffic; `get_network_traffic({ since:"last_action" })` returns only what the last mutating action fired.
- `context_save/open/list/delete(name)` — named cookie/storage profiles (thin aliases over the session vault).
- **Structured errors** (HTTP 400): `STALE_REF` (re-scan the page and re-issue), `TIMEOUT`, `NO_TARGET`, `BAD_REQUEST`, `NOT_SUPPORTED`.
- **Input is focus-independent:** clicks/typing/wheel are delivered over CDP and land even when another app owns the OS foreground. If a tab reports a `0x0` viewport, call `set_window_visibility({visible:true})` and wait for a non-zero viewport before acting.
