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
