# 🔌 Kuang Grade Mark Eleven — Model Context Protocol Server (`src/mcp/`)

This directory contains the in-process TypeScript implementation of the Model Context Protocol (MCP) server using `@modelcontextprotocol/sdk`.

---

## 🏛️ Purpose & Architecture

While [`scripts/mcp-server.js`](../../scripts/README.md) is the standalone stdio server executable communicating via the HTTP bridge (`:4111`), [`src/mcp/server.ts`](./server.ts) allows the MCP server to be instantiated directly inside the Electron main process with zero HTTP serialization overhead when running in unified mode.

---

## 🧰 Registered MCP Tool Domains (49 Tools Total)

1. **Navigation & History (3 Tools):** `navigate_to`, `navigate_history`, `get_page_info`.
2. **Autonomous Shield & Consent (1 Tool):** `dismiss_consent`.
3. **Hardware-Level Input Simulation (5 Tools):** `click_element`, `type_text`, `fill_form`, `press_key`, `scroll_page`.
4. **Multimodal Observation & Console (5 Tools):** `take_screenshot`, `get_page_markdown`, `evaluate_javascript`, `get_console_logs`, `get_fingerprint_profile`.
5. **Multi-Tab Orchestration (4 Tools):** `new_tab`, `switch_tab`, `close_tab`, `list_tabs`.
6. **LanceDB Cortex Persistent Memory (6 Tools):** `recall_memory`, `get_history`, `clear_history`, `add_bookmark`, `list_bookmarks`, `delete_bookmark`.
7. **Download Manager & Harvester (2 Tools):** `list_downloads`, `read_download`.
8. **Session & Cookie Jar Vault (3 Tools):** `save_session`, `restore_session`, `list_sessions`.
9. **Network Intelligence & Real-Time Streams (6 Tools):** `get_network_traffic`, `get_api_payload`, `clear_network_traffic`, `list_realtime_streams`, `get_stream_messages`, `clear_stream_messages`.
10. **Set-of-Marks Visual Grounding (3 Tools):** `take_annotated_screenshot`, `click_mark`, `type_mark`.
11. **Script Vault & Semantic Macro Engine (5 Tools):** `save_script`, `recall_script`, `run_script`, `list_scripts`, `delete_script`.
12. **Desktop System Tray & HIL Intervention (6 Tools):** `set_window_visibility`, `configure_system_tray`, `request_human_intervention`, `resolve_human_intervention`, `get_human_intervention_status`, `send_notification`.

---

## 📄 Source Files

- **[`server.ts`](./server.ts)**:
  Defines `createMcpServer(chassis: BrowserChassis)` and registers all 49 standard semantic tool definitions with Zod schemas.
