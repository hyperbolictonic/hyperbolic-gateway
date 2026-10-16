# 🛠️ Kuang Grade Mark Eleven — Scripts Directory

This directory contains utility scripts, automated test harnesses, and the standalone MCP stdio server executable.

---

## 📜 Key Scripts

### 1. Model Context Protocol Server
- **[`mcp-server.js`](./mcp-server.js)**:
  The official MCP server that communicates with LLM clients (Claude Desktop, Cursor, Antigravity) over standard input/output (`stdio`). Exposes all 24 standardized browser navigation, multimodal screenshot, tab management, and LanceDB Cortex memory tools by translating them into HTTP calls against the chassis bridge (`http://127.0.0.1:4111`).

### 2. Automated Test Suites
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
