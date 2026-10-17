<p align="center">
  <img src="public/assets/ono-sendai.png" width="30%" alt="Ono-Sendai Cyberspace 7" />
  &nbsp;&nbsp;
  <img src="public/assets/kuang-grade.png" width="30%" alt="Kuang Grade Icebreaker" />
  &nbsp;&nbsp;
  <img src="public/assets/mark-eleven.png" width="30%" alt="Mark Eleven Tactical Core" />
</p>

# ⚡ Kuang Grade Mark Eleven

> *"I'll hack the Gibson"*  
> — **Dade Murphy (AKA Crash Override)**, Circa 1995

---

### **Grade Eleven is a Web Browser for your Local AI.**

> [!WARNING]
> **EXPERIMENTAL PROTOTYPE**: Kuang Grade Mark Eleven is currently under active, experimental development. Tool contracts, telemetry tuning, and database schemas may evolve rapidly. Built for developers experimenting with multimodal local AI agents.

> [!IMPORTANT]
> **RESEARCH PURPOSES ONLY**: This software is provided strictly for educational, testing, and local AI agent research purposes. It is **not intended for malicious use**, automated credential stuffing, unauthorized exploitation, or violating third-party websites' Terms of Service. Users are responsible for complying with all applicable laws and terms.

Mark Eleven is an interactive, stateful web-browsing Model Context Protocol (MCP) server that empowers multimodal LLM Agents (such as Bonsai 2 27B, Gemini, Claude, and GPT-4o) to operate the live, open web **like a human operator inside a real, visible Chromium browser instance**.

### 🎯 Core Architecture Principles
1. **100% Real Browser Chassis:** No headless emulation, synthetic user-agent spoofing, or sandboxed scraping. Mark Eleven runs a full-fledged, visible Chromium instance (`headless: false`) with hardware acceleration, audio/video capabilities, and authentic cookie/session persistence.
2. **Multimodal Vision Integration:** Specifically tailored for multimodal models (e.g. Bonsai 2 27B). The agent takes high-res viewport screenshots (`take_screenshot`) to visually understand layouts, buttons, and dynamic canvas states, and can click directly by coordinate or selector (`click_element`).
3. **Full Developer Console & Script Execution:** Gives the agent full console access (`get_console_logs`) to inspect runtime errors and API output, plus arbitrary JavaScript evaluation (`evaluate_javascript`) to interact with complex SPAs.
4. **Behavioral Bot Detection Bypass:** Bypasses Cloudflare, Akamai, Datadome, and behavioral bot sensors by avoiding synthetic `element.click()` events (`isTrusted: false`). Instead, it dispatches native OS-level hardware input events (`webContents.sendInputEvent`) accompanied by organic cubic Bézier pointer movement and human Gaussian typing cadence.

---

## 🌌 Neuromancer Inspiration & Cyberpunk Canon

> *"A Kuang Grade Mark Eleven penetration program. Icebreaker. The military stuff, the heavy artillery."*  
> — **William Gibson, *Neuromancer* (1984)**

In William Gibson's genre-defining cyberpunk masterpiece *Neuromancer*, console cowboys Case and the ROM personality construct of the Dixie Flatline jack into the Matrix using an **Ono-Sendai Cyberspace 7** deck. Their ultimate weapon: the **Kuang Grade Mark Eleven**—a mythical military-grade icebreaker designed to slice through the impenetrable corporate ICE surrounding the Tessier-Ashpool mainframe.

**Kuang Grade Mark Eleven** channels this lineage:
- **Piercing the Modern Web's "ICE":** Headless automation (Puppeteer, Playwright) is routinely flagged and blocked by Cloudflare, Datadome, and behavioral bot sensors. Mark Eleven provides a tactile, visible Chromium cyberdeck that operates with authentic human telemetry.
- **The Ghost Cursor as Neural Trodes:** Dispatches organic cubic Bézier pointer movement and Gaussian typing cadences, behaving like an authentic human operator seated at the console.
- **The LanceDB Cortex as ROM Personality Construct:** Provides persistent semantic recall and memory traces so your local AI agent retains research context and bookmarks across browsing sessions.

---

## 🎨 Theme & Cyberdeck Interface

Built with **Tailwind CSS v4** and **DaisyUI 5**:
- **Custom Theme:** `mark-eleven`
- **Color Inspiration:** Antigravity electric cyan (`oklch(75% 0.18 215)`), VS Code workspace slate (`oklch(21% 0.012 250)`), and Photoshop deep charcoal neutrals.
- **DaisyUI Components:**
  - `navbar` & `mockup-browser` address bar with real-time navigation and SSL/protocol status.
  - `status` and `badge` indicators reflecting live agent lifecycle (`IDLE`, `TRAVERSING`, `SIMULATING_INPUT`, `HARVESTING`).
  - `tabs` (`tabs-border`) for switching between **Telemetry Kinematics**, **Construct Terminal**, and **MCP Matrix Logs**.
  - `stats` / `stat` blocks tracking coordinates, Bézier velocity, tokens saved, and interaction counters.
  - `mockup-code` for viewing synthesized Markdown memory constructs with token downsampling ratios.

---

## 🕹️ Ghost Cursor Telemetry Engine

- **Organic Bézier Trajectories:** Natural cubic Bézier curve calculation with quintic ease-in/ease-out acceleration, micro-jitter, and target deceleration.
- **Hardware Event Piping:** Directly dispatches Chromium input events via Electron's `webContents.sendInputEvent` (mouse movement, button press dwell time, variable-cadence keystrokes, and momentum mousewheel scrolling).
- **Anti-Bot Defense Bypass:** Avoids heuristic bot triggers by behaving like an authentic human operator.

---

## 📄 Token-Efficient Construct Harvester

- **Pure Node.js:** Powered by Mozilla Readability and Turndown. No external Python or platform-specific binaries required.
- **Semantic Flattening:** Strips ads, navigation sidebars, and script clutter.
- **Automated Envelope Front-Matter:**
  ```yaml
  ---
  designation: "KUANG_GRADE_MARK_ELEVEN_CONSTRUCT"
  source_url: "https://example.com"
  title: "Example Domain"
  harvested_at: "2026-10-16T07:10:00.000Z"
  raw_bytes: 48920
  construct_bytes: 2140
  estimated_tokens: 535
  compression_ratio: "4.4%"
  ---
  ```

---

---

## 🧠 LanceDB Persistent Cortex & Semantic Recall

Mark Eleven features an embedded, serverless vector database (**LanceDB**) combined with Tantivy-powered Full-Text Search (BM25) stored locally under `./data/cortex/`.

- **Auto-Harvest on Navigation:** Every web page visited is automatically chunked, embedded, and indexed into the `page_history` table in the background.
- **Hybrid Semantic Recall:** Models can invoke `recall_memory` to execute hybrid vector + BM25 search across past research sessions, retrieving verbatim snippets, page titles, and relevance match scores.
- **Persistent Bookmarks:** Save critical research nodes, documentation hubs, or matrix targets with semantic tags and research notes.
- **DaisyUI 5 Cortex HUD:** Open the Cortex modal (`🧠 CORTEX`) from the navbar to browse recent history, execute live semantic queries, or manage bookmarked cards.

---

## 📑 Hardware-Accelerated Multi-Tab Browsing

- **Electron `WebContentsView` Isolation:** Independent navigation state, separate history stacks, and zero-flicker view swapping.
- **Automatic Popup Trapping:** Links configured with `target="_blank"` or `window.open` are cleanly trapped into managed child tabs rather than escaping as detached OS windows.
- **Dynamic DaisyUI 5 Tab Bar Strip:** Real-time loading spinners, active indicators, title truncations, and memory reclamation upon tab closure.

---

## 🛡️ Autonomous Shield-Breaker (Cookie & GDPR Destroyer)

- **Zero-Token Modal Clearance:** Saves 1–2 LLM tool calls on almost every new domain.
- **Preload Framework Detection:** Detects OneTrust, Cookiebot, Google GDPR (`#L2AGLb`), TrustArc, and generic consent frameworks.
- **Bézier Dismissal:** Dispatches authentic Bézier cursor movement and hardware clicks to "Accept All" or "Agree" before notifying the agent that the page is ready.
- **Manual Directive:** Agents can also manually call `dismiss_consent` whenever unexpected overlays block the viewport.

---

## 🎯 Set-of-Marks (SoM) Visual Grounding

- **Zero Coordinate Hallucination:** Completely eliminates hallucinated pixel coordinates or fragile CSS selectors.
- **High-Contrast Neon Badges:** Ephemerally injects high-contrast amber neon numbered badges (`[1]`, `[2]`, `[3]`, etc.) over every visible, interactable DOM element (`<a>`, `<button>`, `<input>`, `select`, `[role="button"]`).
- **Precision Multimodal Actuation:**
  1. `take_annotated_screenshot()` captures the badge overlay and returns an element lookup table (`{ id: 1, tag: "BUTTON", text: "Submit", bbox: [...] }`).
  2. `click_mark(1)` moves the Bézier ghost cursor to the element's centroid with sub-pixel accuracy and clicks.
  3. `type_mark(2, "cyberdeck")` focuses the input and types text with human cadence.
- **Three cost tiers** (pick the cheapest that fits your model):

  | Tool | Payload | Use when |
  | :--- | :--- | :--- |
  | `take_annotated_screenshot` | Marks table + full-resolution PNG | Vision model, fine visual detail matters |
  | `take_economy_screenshot` | Marks table + 640px-wide JPEG (q45), roughly 10-20x smaller | Vision model, tokens/bandwidth matter |
  | `list_marks` | Marks table only, **no image** | Text-only models (e.g. local GGUFs) or the cheapest page scan |

  All three register the same mark IDs, so `click_mark` / `type_mark` work after any of them. Text-only models must not be sent images: a base64 PNG inlined into the prompt can be 100k+ tokens and will stall local inference servers.

---

## 📝 Single-Turn Batch Form Filler

- **Instantaneous Multi-Input Population:** Fills complex checkout forms, flight booking screens, or multi-field search bars in a single turn without round-trip LLM latency.
- **Human Typing Cadence:** Simulates variable human inter-key delays (60–240ms) with Gaussian jitter between fields.
- **Flexible Field Types:** Supports text inputs, password fields, dropdown `<select>` menus, checkboxes, and radio buttons with optional automatic form submission (`submit_selector`).

---

## 📥 Download Manager & Cortex Harvester

- **Workspace-Local Routing:** Intercepts Chromium's `will-download` session events, routing all files into `./data/downloads/` rather than the OS user folder.
- **Automated Text Extraction:** Automatically extracts clean Markdown text from downloaded **PDFs** (`pdf-parse`), **CSVs**, and **JSON** files.
- **LanceDB Vector Ingestion:** Automatically ingests downloaded document text into the **LanceDB Cortex** vector store for instant conversational recall.
- **MCP Inspection:** `list_downloads` and `read_download(filename)` allow agents to inspect and read downloaded files on demand.

---

## 🔐 Session & Cookie Jar Vault

- **Stateful Auth Persistence:** Captures and restores active session cookies, `localStorage`, and `sessionStorage` into encrypted/structured snapshots under `./data/sessions/<name>.json`.
- **Bypass 2FA & Logins:** Resume authenticated states on GitHub, airline portals, news sites, or internal dashboards across agent sessions without triggering repetitive logins or CAPTCHAs.
- **MCP Tools:** `save_session(name)`, `restore_session(name)`, and `list_sessions()`.

---

## 📡 Live Network & API Stream Interceptor

- **Direct Chrome DevTools Protocol Wire:** Attaches directly via CDP (`Network.enable`) to monitor all incoming and outgoing network traffic.
- **Direct JSON Extraction:** Bypasses DOM scraping entirely for modern Single-Page Applications (SPAs like Twitter, Reddit, Skyscanner). Captures completed XHR/Fetch response bodies (`Network.getResponseBody`).
- **MCP Inspection:** `get_network_traffic` filters requests by URL pattern or method, and `get_api_payload(request_id)` returns parsed JSON directly into the LLM context.

---

## ⚡ Real-Time WebSocket & SSE Interceptor

- **Duplex Stream Surveillance:** Captures duplex frames across persistent `wss://` WebSockets and Server-Sent Events (`text/event-stream`).
- **Auto-Parsed Payloads:** Automatically detects and parses JSON streaming frames from live crypto tickers, chat platforms, financial feeds, and streaming LLM APIs.
- **In-Memory Ring Buffer:** Rolling buffer of 500 frames with filtering by stream ID, direction (`sent` / `received`), and message limit.
- **MCP Tools:** `list_realtime_streams`, `get_stream_messages`, `clear_stream_messages`.

---

## 💾 Script Vault & LanceDB Semantic Macro Engine

- **Reusable Automation Macros:** Store, recall, and execute custom JavaScript DOM extraction and automation scripts under `./data/scripts/<name>.json`.
- **Vector-Indexed Semantic Recall:** Every vaulted script is automatically embedded into the LanceDB `scripts` table. Models can recall scripts using conversational natural language queries (`recall_script("extract table rows as json")`).
- **Parameter Injection:** `run_script(name, args)` executes vaulted scripts inside the active tab with dynamic runtime arguments and closure isolation.

---

## 🗔 System Tray & Background Minimization ("Out of the Way")

- **Unobtrusive Background Operation:** Keeps the Cyberdeck running completely out of the way in the Windows notification tray during long-running automated tasks, batch scrapes, and research pipelines.
- **Single-Click Summon:** Left-clicking or double-clicking the system tray icon toggles window visibility instantly.
- **Close-to-Tray Protection:** Closing the window (`X`) minimizes to the system tray rather than killing active background tasks and MCP sessions.
- **MCP Tools:** `set_window_visibility({ visible })` and `configure_system_tray({ close_to_tray })`.

---

## 🚨 Human-In-The-Loop (HIL) Intervention Protocol

- **Graceful Human Collaboration:** When the agent hits Cloudflare Turnstile, CAPTCHAs, 2FA/SMS OTPs, or payment confirmations, it invokes `request_human_intervention`.
- **Multi-Channel Alerting:**
  1. **OS Native Desktop Notification:** Fires an urgent desktop notification banner with sound.
  2. **Window Summon & Taskbar Flash:** Automatically restores the window from the tray, brings it to the front, and flashes the Windows taskbar amber (`flashFrame(true)`).
  3. **Interactive In-Page Cyberdeck Banner:** Injects an amber neon cyberdeck banner (`#__kuang_hil_banner`) directly into the active webpage with a **"RESUME AGENT (DONE)"** button.
  4. **HUD Action Indicator:** Changes the status badge to `AWAITING_INPUT` with live prompt text.
- **Instant Unpause:** When the user completes the action and clicks "DONE", the agent immediately resumes its autonomous turn.
- **MCP Tools:** `request_human_intervention`, `resolve_human_intervention`, `get_human_intervention_status`, and non-blocking `send_notification`.

---

## 🔌 Standardized Semantic MCP Tools (55 Tools Total)

| Category | Tool | Parameters | Description |
| :--- | :--- | :--- | :--- |
| **Navigation** | `navigate_to` | `url: string`, `auto_dismiss_consent?: boolean` | Navigates active tab to URL. Auto-dismisses GDPR/cookie overlays by default. Supports 0ms instant elevation if pre-rendered. |
| | `go_to_url` | `url: string`, `auto_dismiss_consent?: boolean` | Primary alias for `navigate_to`. Dispatches visible window navigation. |
| | `navigate_history` | `action: 'back' \| 'forward' \| 'reload'` | Browser history navigation and reload controls. |
| | `get_page_info` | _none_ | Returns current URL, title, and load state without full extraction. |
| **Shield & Defense** | `dismiss_consent` | _none_ | Autonomously detects and dismisses GDPR/cookie banners via Bézier mouse click. |
| **Interaction** | `click_element` | `selector?: string`, `x?: number`, `y?: number` | Clicks element by CSS selector or direct viewport (x, y) coordinates with loose argument normalization (`target`, `element`). |
| | `type_text` | `text: string`, `selector?: string` | Types text with human Gaussian cadence variance (60–240ms) with loose argument normalization (`value`, `input`). |
| | `fill_form` | `fields: Record<string, string \| boolean \| number>`, `submit_selector?: string` | Fills multiple form inputs, selects, and checkboxes in a single turn. |
| | `press_key` | `key: string` | Presses specific key (e.g. `Enter`, `Tab`, `Escape`, `Backspace`). |
| | `scroll_page` | `direction: 'up' \| 'down'`, `amount?: number` | Incremental momentum wheel scrolling. |
| **Observation & Vision** | `take_screenshot` | _none_ | High-res PNG capture. Returns dual content: file path text & native MCP image block (`type: 'image'`, `mimeType: 'image/png'`). Saved to `data/screenshots/` with automatic retention pruning. |
| | `get_page_markdown` | _none_ | Downsamples active DOM to clean token-efficient Markdown with YAML metadata. |
| | `harvest_markdown` | _none_ | Primary alias for `get_page_markdown`. Extracts clean markdown from the active tab. |
| | `snapshot_rendered_page` | `format?: 'ax_tree' \| 'markdown' \| 'html' \| 'unrendered_html'`, `wait_until_idle_ms?: number`, `pierce_shadow_dom?: boolean`, `force_rerender?: boolean`, `save_to_disk?: boolean` | **Rendered Point-in-Time Snapshot.** Freezes dynamic SPAs, pierces Shadow DOM, and extracts ultra-token-efficient Accessibility (AX) Trees, rendered Markdown, or unrendered source HTML. |
| | `prerender_links` | `urls?: string[]`, `selector?: string`, `max_pages?: number`, `harvest_to_cortex?: boolean`, `wait_until_idle_ms?: number` | **Speculative Pre-rendering Engine.** Pre-hydrates candidate links in background views for **0ms instant navigation**, and auto-indexes into LanceDB Cortex memory. |
| | `evaluate_javascript` | `script: string` | Evaluates custom JS expression in page context and returns serialized JSON. Accepts `script`, `code`, or `expression`. |
| | `get_console_logs` | `limit?: number` | Returns recent web page and script console logs, warnings, and errors. |
| | `get_fingerprint_profile` | _none_ | Returns active stealth host browser fingerprint and spoofed headers. |
| **Multi-Tab** | `new_tab` | `url?: string` | Spawns a new independent browser tab instance. |
| | `switch_tab` | `tab_id: string` | Activates and focuses the specified tab. |
| | `close_tab` | `tab_id?: string` | Closes tab and reclaims memory resources. |
| | `list_tabs` | _none_ | Returns structured array of all open tabs (IDs, titles, URLs, active status). |
| **LanceDB Memory** | `recall_memory` | `query: string`, `limit?: number`, `domain?: string` | Performs hybrid vector and BM25 full-text search across visited pages and markdown. |
| | `get_history` | `limit?: number`, `domain?: string` | Chronological browsing history from persistent LanceDB cortex. |
| | `clear_history` | `older_than?: string` | Prunes or purges browsing history from persistent storage. |
| | `add_bookmark` | `url?: string`, `title?: string`, `notes?: string`, `tags?: string[]` | Saves active or specified page with tags and notes in LanceDB. |
| | `list_bookmarks` | `query?: string`, `tag?: string`, `limit?: number` | Retrieves or semantically filters saved bookmarks. |
| | `delete_bookmark` | `url_or_id: string` | Deletes bookmark by URL or unique ID. |
| **Downloads & Docs** | `list_downloads` | _none_ | Lists all files downloaded into `data/downloads/` with sizes, state, and timestamps. |
| | `read_download` | `filename_or_id: string` | Parses downloaded file (PDF, CSV, JSON, text) into token-efficient markdown. |
| **Session Vault** | `save_session` | `name?: string` | Captures active cookies and localStorage state into persistent JSON vault. |
| | `restore_session` | `name: string` | Rehydrates cookies and localStorage state into browser session. |
| | `list_sessions` | _none_ | Lists all stored session snapshots with timestamps and cookie counts. |
| **Network Intelligence** | `get_network_traffic` | `url_pattern?: string`, `method?: string`, `resource_type?: string`, `limit?: number` | Inspects live HTTP/XHR/Fetch requests captured via Chrome DevTools Protocol (returns compact 1-line markdown summaries). |
| | `get_api_payload` | `request_id: string` | Retrieves and parses the full raw JSON or text response body for an intercepted request. |
| | `query_json_data` | `source: string`, `source_id?: string`, `path?: string`, `view?: string`, `filter_predicate?: string`, `max_items?: number`, `max_string_length?: number` | **Token-Efficient JSON Navigator.** Queries large payloads/streams/files via dot/bracket paths (`items[0..3].price`), extracts schemas, searches keys, and applies filters without context-window blowup. |
| | `clear_network_traffic` | _none_ | Resets and clears the in-memory network traffic ring buffer. |
| | `list_realtime_streams` | `type?: 'websocket' \| 'sse'`, `active_only?: boolean` | Lists active WebSocket connections and open SSE channels in compact 1-line format. |
| | `get_stream_messages` | `stream_id?: string`, `type?: string`, `direction?: string`, `limit?: number` | Inspects captured incoming/outgoing frames from WebSockets and SSE token streams. |
| | `clear_stream_messages` | `stream_id?: string` | Clears the in-memory WebSocket and SSE message frame buffer. |
| **Visual Grounding** | `take_annotated_screenshot` | _none_ | Tags all visible interactive elements with numbered neon badges (`[1]`, `[2]`, etc.). Returns dual content: Set-of-Marks table text & native MCP image block (`type: 'image'`). Saved to `data/screenshots/`. |
| | `take_economy_screenshot` | _none_ | Lightweight variant: same marks table, but the image is downscaled to 640px wide and JPEG-encoded (q45, `image/jpeg`). Saved to `data/screenshots/` as `annotated_eco_*.jpg`. |
| | `list_marks` | _none_ | Text-only variant: returns the marks table with no image and no file written. Ideal for text-only models. |
| | `click_mark` | `mark_id: number` | Moves humanized Bézier ghost cursor to mark #ID and clicks with 100% accuracy. Accepts numbers, strings, and aliases (`mark`, `id`). |
| | `type_mark` | `mark_id: number`, `text: string`, `clear_first?: boolean` | Focuses mark #ID and types text with variable human typing cadence. |
| **Script Vault & Macros** | `save_script` | `name: string`, `code: string`, `description?: string`, `domain?: string`, `tags?: string[]` | Saves and embeds a custom JavaScript macro into LanceDB Cortex. |
| | `recall_script` | `query?: string`, `domain?: string`, `tag?: string`, `limit?: number` | Semantically searches saved scrapers & macros using natural language. |
| | `run_script` | `name: string`, `args?: object` | Executes a saved script in active tab with dynamic runtime arguments. |
| | `list_scripts` | `domain?: string`, `tag?: string` | Lists all registered macros in the persistent vault. |
| | `delete_script` | `name: string` | Removes a script from the persistent vault and vector index. |
| **Desktop & System Tray** | `set_window_visibility` | `visible: boolean` | Minimizes browser window to Windows notification tray to stay out of the way, or restores to screen. |
| | `configure_system_tray` | `close_to_tray?: boolean` | Configures tray options such as close-to-tray background operation. |
| **Human-In-The-Loop & Alert** | `request_human_intervention` | `reason: string`, `timeout_seconds?: number`, `bring_to_front?: boolean` | Halts agent, triggers native OS alert, unhides window, and injects interactive banner for CAPTCHAs/credentials. |
| | `resolve_human_intervention` | `id?: string`, `notes?: string` | Resolves active intervention request and resumes agent execution. |
| | `get_human_intervention_status` | _none_ | Checks active intervention status and history log. |
| | `send_notification` | `title: string`, `message: string`, `urgency?: string`, `sound?: boolean` | Emits non-blocking OS native desktop banner notification to user. |
| | `send_desktop_notification` | `message: string`, `title?: string`, `urgency?: string`, `sound?: boolean` | Dedicated HIL notification tool (used by Agent Orcha) to alert human operator with critical desktop sound/banner. |
| **Assistance & Discovery** | `help` | _none_ | Returns a comprehensive operational manual and cheatsheet of all available browser automation capabilities. |

---

## 🗺️ Codebase Directory Structure & Documentation

Each folder contains a dedicated `README.md` detailing its responsibilities, dependencies, and internal workflows:

| Directory | Documentation Link | Description |
| :--- | :--- | :--- |
| **`docs/`** | [docs/README.md](./docs/README.md) | Central documentation hub, concept lore, and architectural specifications. |
| **`scripts/`** | [scripts/README.md](./scripts/README.md) | Automated test harnesses, logo embedders, and the standalone `mcp-server.js` stdio runner. |
| **`public/`** | [public/README.md](./public/README.md) | Static web root and the built-in offline Cyberdeck Manual (`welcome.html`). |
| **`public/assets/`** | [public/assets/README.md](./public/assets/README.md) | Tactical high-resolution brand insignia (Ono-Sendai 7, Kuang Grade, Mark Eleven). |
| **`src/`** | [src/README.md](./src/README.md) | Root source directory organizing process-isolated TypeScript modules. |
| **`src/main/`** | [src/main/README.md](./src/main/README.md) | Electron main process, `BrowserChassis` coordinator, and HTTP bridge (`:4111`). |
| **`src/main/cortex/`** | [src/main/cortex/README.md](./src/main/cortex/README.md) | Embedded LanceDB vector database, 128-d embedder, chunker, and hybrid semantic recall. |
| **`src/main/tabs/`** | [src/main/tabs/README.md](./src/main/tabs/README.md) | Hardware-accelerated `WebContentsView` multi-tab pooling and popup trapping. |
| **`src/main/shield/`** | [src/main/shield/README.md](./src/main/shield/README.md) | Autonomous Shield Breaker engine auto-dismissing cookie banners and GDPR modals. |
| **`src/main/downloads/`** | [src/main/downloads/README.md](./src/main/downloads/README.md) | Deterministic workspace file download routing and automatic document-to-Cortex ingestion. |
| **`src/main/session/`** | [src/main/session/README.md](./src/main/session/README.md) | Persistent cookie jar and session snapshot vault for cross-run auth persistence. |
| **`src/main/network/`** | [src/main/network/README.md](./src/main/network/README.md) | Chrome DevTools Protocol wire interceptor capturing background XHR/Fetch JSON streams. |
| **`src/main/marks/`** | [src/main/marks/README.md](./src/main/marks/README.md) | Set-of-Marks visual grounding engine injecting numbered neon badges for zero-ambiguity LLM actuation. |
| **`src/main/scripts/`** | [src/main/scripts/README.md](./src/main/scripts/README.md) | Persistent script vault and LanceDB semantic macro recall engine with parameter injection. |
| **`src/main/tray/`** | [src/main/tray/README.md](./src/main/tray/README.md) | Windows System Tray integration and close-to-tray background minimization. |
| **`src/main/hil/`** | [src/main/hil/README.md](./src/main/hil/README.md) | Human-In-The-Loop cooperative intervention protocol, OS notifications, and in-page alert banners. |
| **`src/main/telemetry/`** | [src/main/telemetry/README.md](./src/main/telemetry/README.md) | Organic cubic Bézier mouse kinematics, Gaussian typing cadence, and stealth fingerprinting. |
| **`src/main/harvester/`** | [src/main/harvester/README.md](./src/main/harvester/README.md) | Mozilla Readability & Turndown token-efficient markdown distillation. |
| **`src/preload/`** | [src/preload/README.md](./src/preload/README.md) | Sandboxed ContextBridge IPC exposing typed `window.electronAPI` to the DOM. |
| **`src/renderer/`** | [src/renderer/README.md](./src/renderer/README.md) | DaisyUI 5 Cyberdeck HUD, phosphor radar trail canvas, and Cortex modal dialogs. |
| **`src/shared/`** | [src/shared/README.md](./src/shared/README.md) | Shared TypeScript contracts, telemetry events, and construct schemas. |
| **`src/mcp/`** | [src/mcp/README.md](./src/mcp/README.md) | In-process TypeScript MCP server definition for zero-overhead unified execution. |

---

## 🚀 Quickstart

### Development Mode (with Live Reloading)
```bash
pnpm dev
```

### Production Build & Launch
```bash
pnpm run build
pnpm start
```

### MCP Client Configuration (e.g. Claude Desktop, Cursor, Antigravity, Agent-Orcha)
Add this to your MCP configuration (`claude_desktop_config.json` / `mcp_config.json`):
```json
{
  "mcpServers": {
    "mark-eleven": {
      "command": "node",
      "args": [
        "<user>/Documents/<workspace>/kuang_grade_mark_eleven/bin/mcp-server.cjs"
      ]
    }
  }
}
```
> **Note:** The Mark Eleven Cyberdeck application must be running in the background (`pnpm run dev` or `pnpm start`) so the MCP stdio bridge runner can communicate with the active browser instance on `http://127.0.0.1:4111`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) © 2026 hyperbolictonic.
