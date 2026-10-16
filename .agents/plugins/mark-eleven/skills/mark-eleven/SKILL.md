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
   - Call `take_screenshot()` to retrieve high-resolution viewport images.
   - Use the visual capture to identify interactive elements, coordinate locations, modals, or visual captchas.
3. **Humanized Interaction:**
   - Call `click_element({ selector })` or `click_element({ x, y })` to dispatch organic Bézier pointer movement and hardware switch clicks.
   - Call `type_text({ text, selector })` to type with realistic human Gaussian cadence (60-240ms).
   - Call `press_key({ key })` for single keypresses (`Enter`, `Tab`, `Escape`, `Backspace`).
   - Call `scroll_page({ direction, amount })` to simulate inertia mousewheel scrolling.
4. **Console & Script Execution:**
   - Call `evaluate_javascript({ script })` to query the DOM or execute client-side logic.
   - Call `get_console_logs({ limit })` to inspect page errors and network responses.
5. **Multi-Tab Orchestration:**
   - Call `new_tab({ url })` to open a new isolated browser tab.
   - Call `switch_tab({ tab_id })` to focus another tab.
   - Call `close_tab({ tab_id })` to close an active or specified tab and free memory.
   - Call `list_tabs()` to inspect all active tabs.
6. **Token-Efficient Payload Extraction:**
   - Call `get_page_markdown()` to downsample the active DOM into clean Markdown with YAML front-matter envelopes, saving 90%+ context window tokens.
7. **LanceDB Persistent Cortex & Semantic Recall:**
   - Call `recall_memory({ query, limit, domain })` to run hybrid semantic vector + BM25 full-text search across all previously browsed and read web pages.
   - Call `get_history({ limit, domain })` to view chronological visit history.
   - Call `add_bookmark({ url, title, notes, tags })` to persist important research links with semantic tags.
   - Call `list_bookmarks({ query, tag })` to retrieve or semantically search saved bookmarks.
   - Call `delete_bookmark({ url_or_id })` to remove a bookmark.
8. **Visual Grounding with Set-of-Marks (SoM):**
   - Call `take_annotated_screenshot()` to render high-contrast neon badges over all interactable elements and return a lookup table.
   - Call `click_mark({ mark_id })` to perform human Bézier clicks directly on a visual badge number.
   - Call `type_mark({ mark_id, text, clear_first })` to type directly into an annotated input badge.
9. **Single-Turn Batch Form Filler:**
   - Call `fill_form({ fields, submit_selector })` to populate multiple inputs, selects, radios, and checkboxes in a single turn with human typing cadence.
10. **Autonomous Shield-Breaker:**
   - Cookie consent dialogs (OneTrust, Cookiebot, Google GDPR, TrustArc) are auto-dismissed on navigation.
   - Call `dismiss_cookie_dialogs()` to manually force-dismiss any remaining consent banners.
11. **Download Manager & Harvester:**
   - Files are automatically routed to `data/downloads/` and indexed into Cortex.
   - Call `list_downloads()` to inspect completed downloads.
   - Call `read_download({ filename })` to read parsed markdown text (PDFs, CSVs, JSON).
12. **Session & Cookie Jar Vault:**
   - Call `save_session({ name })` to snapshot cookies, localStorage, and sessionStorage.
   - Call `restore_session({ name })` to rehydrate authenticated sessions.
   - Call `list_sessions()` to view saved sessions.
13. **Live Network & API Interception:**
   - Call `get_network_traffic({ url_pattern, method, resource_type, limit })` to inspect captured XHR/Fetch/document HTTP requests.
   - Call `get_api_payload({ request_id })` to fetch JSON or structured responses directly from the API layer.
   - Call `clear_network_traffic()` to reset the network request ring buffer.
14. **Script Vault & Semantic Macro Engine:**
   - Call `save_script({ name, description, code, parameters })` to persist DOM scripts and vector-embed them in LanceDB.
   - Call `recall_script({ query, limit })` to semantically search for reusable scripts using natural language.
   - Call `run_script({ name, args })` to execute a vaulted script in the active tab with dynamic arguments.
   - Call `list_scripts()` or `delete_script({ name })` to manage scripts.
15. **Real-Time WebSocket & SSE Interception:**
   - Call `list_realtime_streams({ type, active_only })` to inspect active and recent `wss://` WebSockets and SSE streams.
   - Call `get_stream_messages({ stream_id, type, direction, limit })` to inspect streaming frames and auto-parsed JSON payloads.
   - Call `clear_stream_messages({ stream_id })` to clear streaming frame buffers.
16. **Desktop & System Tray Management:**
   - Call `set_window_visibility({ visible })` to minimize the cyberdeck window to the system tray to stay out of the user's way, or restore to screen.
   - Call `configure_system_tray({ close_to_tray })` to enable or disable background minimization when closing the window.
17. **Human-In-The-Loop (HIL) Intervention & Desktop Notifications:**
   - Call `request_human_intervention({ reason, timeout_seconds, bring_to_front })` when human credentials, 2FA, OTP, or CAPTCHAs are required. Triggers desktop notification, restores window from tray, flashes taskbar, and injects interactive banner until completed.
   - Call `resolve_human_intervention({ id, notes })` to programmatically resolve a pending intervention.
   - Call `get_human_intervention_status()` to inspect active request status and history.
   - Call `send_notification({ title, message, urgency, sound })` to emit non-blocking desktop notifications.
