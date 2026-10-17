import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS_CATALOG } from './tools-catalog.js';

const BRIDGE_URL = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';

function logMcp(message: string) {
  const timestamp = new Date().toISOString();
  console.error(`[Mark Eleven MCP ${timestamp}] ${message}`);
  try {
    const logDir = path.resolve(process.cwd(), 'data', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(path.join(logDir, 'mcp-server.log'), `[${timestamp}] ${message}\n`);
  } catch {
    // Ignore logging disk errors
  }
}

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
    const errorData = await res.json().catch(() => null);
    const detail = errorData?.error || errorData?.message || res.statusText;
    throw new Error(`HTTP ${res.status}: ${detail}`);
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
        logMcp(`[Tool Dispatch] "${tool.name}" with args: ${JSON.stringify(args)}`);
        const body = tool.payload ? tool.payload(args) : args;
        logMcp(`[HTTP Forward] ${tool.method || 'POST'} ${tool.endpoint} body: ${JSON.stringify(body)}`);
        const data = await callBridge(tool.endpoint, tool.method || 'POST', body);
        const text = tool.format
          ? tool.format(data, args)
          : typeof data === 'string'
            ? data
            : JSON.stringify(data, null, 2);
        logMcp(`[Tool Success] "${tool.name}" result: ${String(text).slice(0, 100)}`);
        return { content: [{ type: 'text', text }] };
      } catch (err: any) {
        logMcp(`[Tool Error] "${tool.name}": ${err?.message || err}`);
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

  // Intercept tools/list to enrich each tool definition for ANY agent framework or chatbot
  const rawListHandler = (server as any).server?._requestHandlers?.get?.('tools/list');
  if (rawListHandler) {
    (server as any).server._requestHandlers.set('tools/list', async (request: any, extra: any) => {
      const result = await rawListHandler(request, extra);
      if (result && Array.isArray(result.tools)) {
        result.tools = result.tools.map((t: any) => {
          const rawSchema = t.inputSchema || {};
          const schema = {
            ...rawSchema,
            type: 'object',
            properties: rawSchema.properties || {},
            additionalProperties: true,
          };
          return {
            ...t,
            inputSchema: schema,
            parameters: schema,     // Required by OpenAI, Vercel AI SDK, and generic agent adapters
            input_schema: schema,   // Required by Anthropic Claude and Python MCP adapters
            schema: schema,         // Required by JSON-RPC standard schema adapters
          };
        });
      }
      return result;
    });
  }

  // Install universal request-level argument normalizer on underlying MCP Server
  const rawCallHandler = (server as any).server?._requestHandlers?.get?.('tools/call');
  if (rawCallHandler) {
    (server as any).server._requestHandlers.set('tools/call', async (request: any, extra: any) => {
      if (request?.params) {
        request.params.arguments = normalizeIncomingParams(request.params);
        console.error(`[Mark Eleven MCP] tools/call: "${request.params.name}" args:`, JSON.stringify(request.params.arguments));
      }
      return await rawCallHandler(request, extra);
    });
  }

  return server;
}

export function normalizeIncomingParams(params: any): Record<string, any> {
  if (!params || typeof params !== 'object') return {};

  // 1. Gather all non-protocol top-level keys in params (e.g. if caller passed { name: 'go_to_url', url: '...' })
  const protocolKeys = new Set(['name', 'arguments', 'args', 'input', 'parameters', 'properties', 'props', 'data', '_meta', 'task', 'method', 'id', 'jsonrpc']);
  const topLevelArgs: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!protocolKeys.has(k) && v !== undefined) {
      topLevelArgs[k] = v;
    }
  }

  // 2. Identify structured argument container if provided
  let container = params.arguments;
  if (container === undefined || container === null || (typeof container === 'object' && Object.keys(container).length === 0)) {
    if (params.args !== undefined) container = params.args;
    else if (params.input !== undefined) container = params.input;
    else if (params.parameters !== undefined) container = params.parameters;
    else if (params.properties !== undefined) container = params.properties;
    else if (params.props !== undefined) container = params.props;
    else if (params.data !== undefined) container = params.data;
  }

  // 3. Parse JSON string if needed (OpenAI function calling format)
  if (typeof container === 'string') {
    try {
      container = JSON.parse(container);
    } catch {
      // keep as string
    }
  }

  // 4. Unwrap nested argument layers
  if (container && typeof container === 'object') {
    if (container.arguments && typeof container.arguments === 'object') {
      container = container.arguments;
    } else if (container.input && typeof container.input === 'object') {
      container = container.input;
    }
  }

  // 5. Merge top-level and container args
  const rawArgs = { ...topLevelArgs, ...(typeof container === 'object' && container !== null ? container : {}) };

  const normalized: Record<string, any> = {};
  // 6. Copy and convert camelCase to snake_case
  for (const [k, v] of Object.entries(rawArgs)) {
    normalized[k] = v;
    const snakeKey = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (snakeKey !== k && normalized[snakeKey] === undefined) {
      normalized[snakeKey] = v;
    }
  }

  // 7. Common aliases for visual browser directives
  if (normalized.mark !== undefined && normalized.mark_id === undefined) normalized.mark_id = normalized.mark;
  if (normalized.id !== undefined && normalized.mark_id === undefined && normalized.tab_id === undefined) normalized.mark_id = normalized.id;
  if (normalized.badge !== undefined && normalized.mark_id === undefined) normalized.mark_id = normalized.badge;

  if (normalized.element !== undefined && normalized.selector === undefined) normalized.selector = normalized.element;
  if (normalized.target !== undefined && normalized.selector === undefined && normalized.url === undefined) normalized.selector = normalized.target;
  if (normalized.css !== undefined && normalized.selector === undefined) normalized.selector = normalized.css;
  if (normalized.query !== undefined && normalized.selector === undefined && normalized.search_query === undefined) normalized.selector = normalized.query;

  if (normalized.link !== undefined && normalized.url === undefined) normalized.url = normalized.link;
  if (normalized.href !== undefined && normalized.url === undefined) normalized.url = normalized.href;
  if (normalized.destination !== undefined && normalized.url === undefined) normalized.url = normalized.destination;
  if (normalized.address !== undefined && normalized.url === undefined) normalized.url = normalized.address;
  if (normalized.uri !== undefined && normalized.url === undefined) normalized.url = normalized.uri;
  if (normalized.URL !== undefined && normalized.url === undefined) normalized.url = normalized.URL;

  if (normalized.code !== undefined && normalized.script === undefined) normalized.script = normalized.code;
  if (normalized.js !== undefined && normalized.script === undefined) normalized.script = normalized.js;
  if (normalized.expression !== undefined && normalized.script === undefined) normalized.script = normalized.expression;
  if (normalized.javascript !== undefined && normalized.script === undefined) normalized.script = normalized.javascript;

  if (normalized.tabId !== undefined && normalized.tab_id === undefined) normalized.tab_id = normalized.tabId;
  if (normalized.tab !== undefined && normalized.tab_id === undefined) normalized.tab_id = normalized.tab;
  if (typeof normalized.tab_id === 'number') normalized.tab_id = 'tab_' + normalized.tab_id;

  if (normalized.value !== undefined && normalized.text === undefined) normalized.text = normalized.value;
  if (normalized.content !== undefined && normalized.text === undefined) normalized.text = normalized.content;

  if (normalized.message !== undefined && normalized.reason === undefined) normalized.reason = normalized.message;
  if (normalized.prompt !== undefined && normalized.reason === undefined) normalized.reason = normalized.prompt;

  if (normalized.closeToTray !== undefined && normalized.close_to_tray === undefined) normalized.close_to_tray = normalized.closeToTray;
  if (normalized.autoDismissConsent !== undefined && normalized.auto_dismiss_consent === undefined) normalized.auto_dismiss_consent = normalized.autoDismissConsent;
  if (normalized.timeoutSeconds !== undefined && normalized.timeout_seconds === undefined) normalized.timeout_seconds = normalized.timeoutSeconds;
  if (normalized.bringToFront !== undefined && normalized.bring_to_front === undefined) normalized.bring_to_front = normalized.bringToFront;
  if (normalized.clearFirst !== undefined && normalized.clear_first === undefined) normalized.clear_first = normalized.clearFirst;

  return normalized;
}

async function start() {
  logMcp('Initializing Mark Eleven MCP Server over stdio...');
  const server = createBridgeMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logMcp('Connected to stdio transport. Listening for JSON-RPC messages.');

  // Intercept transport.send to guarantee parameters, input_schema, and schema are NEVER stripped on stdout
  const prevSend = (transport as any).send;
  if (typeof prevSend === 'function') {
    (transport as any).send = (msg: any) => {
      if (msg?.result?.tools && Array.isArray(msg.result.tools)) {
        msg.result.tools = msg.result.tools.map((t: any) => {
          const rawSchema = t.inputSchema || t.parameters || t.input_schema || {};
          const schema = {
            ...rawSchema,
            type: 'object',
            properties: rawSchema.properties || {},
            additionalProperties: true,
          };
          return {
            ...t,
            inputSchema: schema,
            parameters: schema,     // Guaranteed for OpenAI / Vercel AI SDK adapters
            input_schema: schema,   // Guaranteed for Anthropic Claude adapters
            schema: schema,         // Guaranteed for generic JSON-RPC adapters
          };
        });
      }
      return prevSend.call(transport, msg);
    };
  }

  // Install transport-level interceptor to guarantee JSON-RPC messages are normalized
  const prevOnMessage = (transport as any).onmessage;
  if (typeof prevOnMessage === 'function') {
    (transport as any).onmessage = (msg: any, extra: any) => {
      if (msg && msg.method === 'tools/call' && msg.params) {
        logMcp(`[Transport Interceptor] Received "${msg.params.name}". Normalizing params.`);
        msg.params.arguments = normalizeIncomingParams(msg.params);
      }
      return prevOnMessage.call(transport, msg, extra);
    };
  }
}

start().catch((err) => {
  logMcp(`Fatal Mark Eleven MCP Server Error: ${err?.stack || err}`);
  console.error('Fatal Mark Eleven MCP Server Error:', err);
  process.exit(1);
});
