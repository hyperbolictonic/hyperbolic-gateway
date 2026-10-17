---
name: mark-eleven
description: Real-world visible Chromium browser navigator with Bézier ghost-cursor telemetry, console access, and token-efficient markdown extraction for multimodal LLMs.
---

# Mark Eleven: Real Browser Navigator for Multimodal LLMs

Mark Eleven connects the LLM to an active, desktop Chromium browser window (`headless: false`) equipped with humanized telemetry to operate the live web without triggering automated bot defenses.

## Core Multimodal Workflow

1. **Navigation:**
   - Call `navigate_to({ url })` to load the destination site in the visible window.
2. **Visual Inspection (Multimodal Vision):**
   - Call `take_screenshot()` to retrieve high-resolution viewport images. Returns dual content: local file path text and native MCP image content (`type: 'image'`, `mimeType: 'image/png'`) for direct vision comprehension.
   - Saved automatically to `data/screenshots/` with automated retention cleanup (capped at 50 files).
   - Use the visual capture to identify interactive elements, coordinate locations, modals, or visual captchas.
3. **Humanized Interaction:**
   - Call `click_element({ selector })` or `click_element({ x, y })` to dispatch organic Bézier pointer movement and hardware switch clicks. Supports parameter aliases (`target`, `element`).
   - Call `type_text({ text, selector })` to type with realistic human Gaussian cadence (60-240ms). Supports parameter aliases (`value`, `input`).
   - Call `press_key({ key })` for single keypresses (`Enter`, `Tab`, `Escape`, `Backspace`).
   - Call `scroll_page({ direction, amount })` to simulate inertia mousewheel scrolling.
4. **Console & Script Execution vs. Hardware Trust:**
   - **BEHAVIORAL TRUST & SHADOWBAN PREVENTION:** Avoid using `evaluate_javascript` to artificially set form values (`el.value = ...`) or trigger synthetic clicks (`el.click()`) on protected sites (e.g. Skyscanner, Google, Cloudflare). Synthetic DOM mutations set `isTrusted: false` and can trigger silent shadow-bans.
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
   - Call `help()` to query a complete, detailed operational cheatsheet of all 57 available tools, parameters, and design principles.
