import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS_CATALOG } from './tools-catalog.js';

const BRIDGE_URL = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';

async function callBridge(endpoint: string, method: string = 'GET', body: any = null) {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${BRIDGE_URL}${endpoint}`, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return await res.json();
}

export function createBridgeMcpServer() {
  const server = new McpServer({
    name: 'kuang-grade-mark-eleven',
    version: '1.0.0',
  });

  for (const tool of TOOLS_CATALOG) {
    server.tool(tool.name, tool.description, tool.parameters, async (args) => {
      try {
        const body = tool.payload ? tool.payload(args) : args;
        const data = await callBridge(tool.endpoint, tool.method || 'POST', body);
        const text = tool.format
          ? tool.format(data, args)
          : typeof data === 'string'
            ? data
            : JSON.stringify(data, null, 2);
        return { content: [{ type: 'text', text }] };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `[Mark Eleven MCP Error] ${err?.message || err}. (Ensure Cyberdeck is running at ${BRIDGE_URL})`,
            },
          ],
        };
      }
    });
  }

  // Built-in help tool
  server.tool(
    'help',
    'Returns a categorized guide, cheatsheet, and workflow tips for all available Mark Eleven MCP tools.',
    {
      category: z.enum([
        'all',
        'navigation',
        'interaction',
        'inspection',
        'tabs',
        'memory',
        'macros',
        'network',
        'system'
      ]).optional().default('all').describe('Optional category to filter help'),
    },
    async ({ category }) => {
      const docs: Record<string, string> = {
        navigation: `### Navigation Tools
- navigate_to(url, auto_dismiss_consent?): Navigates active browser window to URL and auto-clears cookie overlays.
- navigate_history(direction: "back" | "forward"): Moves back or forward in history.`,
        interaction: `### Interaction & Telemetry Tools
- click_element(selector?, x?, y?): Performs organic Bio-Kinematic Chaos mouse movement and switch clicks with visual pointer.
- type_text(text, selector?): Types with realistic human Gaussian cadence (60-240ms).
- press_key(key): Dispatches single hardware keys ('Enter', 'Tab', 'Escape', 'Backspace').
- scroll_page(direction?, amount?): Simulates organic inertial wheel scrolling.
- fill_form(fields, submit_selector?): Populates multiple form inputs in a single turn.`,
        inspection: `### Visual & Content Inspection
- get_page_markdown(): Extracts DOM converted to token-efficient Markdown with YAML frontmatter.
- take_screenshot(): Captures full viewport image.
- evaluate_javascript(script): Evaluates arbitrary JS in the active tab.
- get_page_info(): Returns active URL, title, tab ID, loading status.
- get_console_logs(limit?): Returns live browser console logs.
- take_annotated_screenshot(): Set-of-Marks visual badges overlay.
- click_mark(mark_id) / type_mark(mark_id, text): Interacts via Set-of-Marks badge numbers.`,
        tabs: `### Multi-Tab Orchestration
- new_tab(url?): Opens a new tab.
- switch_tab(tab_id): Focuses a specific tab.
- close_tab(tab_id?): Closes a tab.
- list_tabs(): Returns all open tabs.`,
        memory: `### LanceDB Cortex & Bookmarks
- recall_memory(query, limit?, domain?): Hybrid vector + BM25 search across all previously browsed pages.
- add_bookmark(url, title, notes?, tags?): Saves a research bookmark to LanceDB.
- list_bookmarks(query?, tag?, limit?): Searches or lists saved bookmarks.
- delete_bookmark(url_or_id): Removes a bookmark.
- get_history(limit?, domain?): Chronological browsing history.`,
        macros: `### Script Vault & Macro Engine
- save_script(name, description, code, parameters?): Vaults a reusable DOM script into LanceDB.
- recall_script(query, limit?): Semantically searches for vaulted automation scripts.
- run_script(name, args?): Executes vaulted script inside the live tab.
- list_scripts() / delete_script(name): Manages vaulted scripts.`,
        network: `### Network & Stream Interception
- get_network_traffic(url_pattern?, method?, resource_type?, limit?): Inspects HTTP requests/responses.
- get_api_payload(request_id): Retrieves raw JSON response payload from intercepted API calls.
- list_realtime_streams(type?, active_only?): Lists active wss:// WebSockets and SSE streams.
- get_stream_messages(stream_id?, type?, direction?, limit?): Inspects real-time streaming frames.`,
        system: `### System Tray & Human-In-The-Loop
- set_window_visibility(visible): Minimizes Cyberdeck to system tray or restores to screen.
- configure_system_tray(close_to_tray?): Configures close-to-tray background mode.
- request_human_intervention(reason, timeout_seconds?, bring_to_front?): Alerts user with desktop notification, HUD banner, and unhides window when login/CAPTCHA is needed.
- send_notification(title, message, urgency?, sound?): Sends native OS notification.`
      };

      if (category && category !== 'all' && docs[category]) {
        return { content: [{ type: 'text', text: docs[category] }] };
      }

      const allDocs = Object.values(docs).join('\n\n');
      return {
        content: [
          {
            type: 'text',
            text: `# 🧭 Kuang Grade Mark Eleven — MCP Help & Cheatsheet\n\nTotal Tools: ${TOOLS_CATALOG.length + 1}\n\n${allDocs}`
          }
        ]
      };
    }
  );

  return server;
}

async function start() {
  const server = createBridgeMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

start().catch((err) => {
  console.error('Fatal Mark Eleven MCP Server Error:', err);
  process.exit(1);
});
