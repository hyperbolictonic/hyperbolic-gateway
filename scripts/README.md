# 🛠️ Kuang Grade Mark Eleven — Scripts Directory

This directory contains utility scripts, automated test harnesses, and the standalone MCP stdio server executable.

---

## 📜 Key Scripts

### 1. Model Context Protocol Server
- **[`mcp-server.js`](./mcp-server.js)**:
  The official MCP server that communicates with LLM clients (Claude Desktop, Cursor, Antigravity) over standard input/output (`stdio`). Exposes all 49 standardized browser navigation, visual grounding, tab management, session vault, network stream interception, script recall, system tray, and human-in-the-loop tools by translating them into HTTP calls against the chassis bridge (`http://127.0.0.1:4111`).

### 2. Automated Test Suites
- **[`test-tray-and-hil.js`](./test-tray-and-hil.js)**:
  Verifies system tray visibility toggling, close-to-tray configuration, native desktop notification dispatch, and human-in-the-loop (HIL) intervention request and resolution flow.
- **[`test-realtime-streams.js`](./test-realtime-streams.js)**:
  Connects to a real WebSocket echo feed (`wss://ws.postman-echo.com/raw`) and tests live CDP WebSocket/SSE duplex message frame interception, message limits, and buffer clearing.
- **[`test-script-vault.js`](./test-script-vault.js)**:
  Saves DOM extraction macros, verifies LanceDB semantic vector embedding, tests natural language macro recall (`recall_script`), and validates runtime parameter injection (`run_script`).
- **[`test-marks.js`](./test-marks.js)**:
  Tests Set-of-Marks (SoM) visual grounding by injecting numbered neon badges over interactable DOM nodes, taking annotated screenshots, and actuating Bézier clicks on badge IDs.
- **[`test-network.js`](./test-network.js)**:
  Attaches CDP network listeners, captures background XHR/Fetch JSON API responses, and verifies `get_network_traffic` and `get_api_payload`.
- **[`test-session.js`](./test-session.js)**:
  Tests snapshotting cookies and localStorage into persistent JSON files and rehydrating them across browser sessions.
- **[`test-downloads.js`](./test-downloads.js)**:
  Verifies download interception into `./data/downloads/`, PDF/CSV/JSON text extraction, and automatic ingestion into LanceDB Cortex.
- **[`test-form.js`](./test-form.js)**:
  Tests single-turn batch form population (`fill_form`) across text inputs, selects, checkboxes, and radios with human typing cadence.
- **[`test-shield.js`](./test-shield.js)**:
  Validates autonomous OneTrust, Cookiebot, and Google GDPR consent banner detection and dismissal.
- **[`test-mcp-cortex.js`](./test-mcp-cortex.js)**:
  Connects a test client to `mcp-server.js` over stdio and executes `recall_memory`, `get_history`, `list_bookmarks`, and `add_bookmark` calls to verify end-to-end LanceDB vector recall.
- **[`test-cortex.js`](./test-cortex.js)**:
  Navigates the chassis, ingests web pages, chunks markdown, saves bookmarks, and tests hybrid vector + BM25 full-text recall against the HTTP bridge.
- **[`test-mcp-tabs.js`](./test-mcp-tabs.js)**:
  Spawns, switches, lists, and closes multiple isolated browser tabs via MCP tools.
- **[`test-client.js`](./test-client.js)**:
  Basic smoke test for the initial MCP navigation and click toolset.

### 3. Build & Visual Verification Helpers
- **[`embed-logos.js`](./embed-logos.js)**:
  Encodes tactical PNG emblems (`ono-sendai.png`, `kuang-grade.png`, `mark-eleven.png`) into base64 data URIs and embeds them into the offline welcome screen to bypass Chromium sandbox local file restrictions.
- **[`scroll-top.js`](./scroll-top.js)**:
  Helper script to scroll the active viewport back to the top coordinates.
- **[`test-white-bg.js`](./test-white-bg.js)**:
  Validates unstyled/transparent webpage background color rendering.
- **[`test-screenshot.js`](./test-screenshot.js)**:
  Captures a test screenshot of the active viewport via the HTTP bridge.
