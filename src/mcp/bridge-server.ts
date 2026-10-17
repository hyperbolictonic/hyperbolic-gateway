import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS_CATALOG } from './tools-catalog.js';
import { formatMark } from './format-mark.js';

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
  let url = `${BRIDGE_URL}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body?.queryParams && (method === 'GET' || method === 'DELETE')) {
    const q = new URLSearchParams(body.queryParams).toString();
    if (q) url += (url.includes('?') ? '&' : '?') + q;
  } else if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    const detail = errorData?.error || errorData?.message || res.statusText;
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return await res.json();
}

function extractCleanBase64(data: any): string {
  const raw = data?.screenshot?.base64Image || data?.base64Image || data?.image || '';
  return typeof raw === 'string' ? raw.replace(/^data:image\/[a-z]+;base64,/, '') : '';
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

        // Native MCP Image Content support for multimodal vision LLMs & file-reading agents
        if (tool.name === 'take_screenshot') {
          const rawBase64 = extractCleanBase64(data);
          const screenshot = data.screenshot || data;
          const filePath = screenshot.filePath || '';
          const w = screenshot.width || 0;
          const h = screenshot.height || 0;
          const descriptionText = filePath
            ? `Screenshot captured and saved to ${filePath} (${w}x${h}px).`
            : `Screenshot captured (${w}x${h}px).`;

          const content: any[] = [
            {
              type: 'text',
              text: descriptionText,
            },
          ];

          if (rawBase64) {
            content.push({
              type: 'image',
              data: rawBase64,
              mimeType: 'image/png',
            });
          }

          logMcp(`[Tool Success] "take_screenshot" returning text + image part (${rawBase64.length} chars base64, path: ${filePath})`);
          return { content };
        }

        if (tool.name === 'take_annotated_screenshot' || tool.name === 'take_economy_screenshot' || tool.name === 'list_marks') {
          const rawBase64 = extractCleanBase64(data);
          const screenshot = data.screenshot || data;
          const filePath = screenshot.filePath || '';
          const w = screenshot.width || 0;
          const h = screenshot.height || 0;
          const marks = Array.isArray(data.marks) ? data.marks : [];
          const marksTable = marks.map((m: any) => formatMark(m)).join('\n');

          const header = filePath
            ? `Set-of-Marks Screenshot saved to ${filePath} (${w}x${h}px). ${marks.length} interactive elements detected.`
            : `Set-of-Marks Screenshot captured (${w}x${h}px). ${marks.length} interactive elements detected.`;

          const descriptionText = `${header}\n\nInteractive Elements:\n${marksTable}\n\nUse click_mark(mark_id) or type_mark(mark_id, text) to interact.`;

          const content: any[] = [
            {
              type: 'text',
              text: descriptionText,
            },
          ];

          if (rawBase64) {
            content.push({
              type: 'image',
              data: rawBase64,
              mimeType: screenshot.mimeType || 'image/png',
            });
          }

          logMcp(`[Tool Success] "${tool.name}" returning text${rawBase64 ? ' + image part' : ' only'} (${rawBase64.length} chars base64, ${marks.length} marks, path: ${filePath})`);
          return { content };
        }

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

  // Register standard MCP Resource: mark-eleven://skills/guide
  // Any agent in ANY directory can read this via list_resources / read_resource
  const OKF_SKILL_GUIDE = `# 🧭 MARK ELEVEN: OPERATIONAL KNOWLEDGE FORMAT (OKF)

1. [CORE ARCHITECTURE]
  - Visual Browser: Active visible Chromium window ('headless: false') with Bézier ghost-cursor telemetry.
  - Zero Context Bleed: Tools return compact 1-line markdown or distilled structures instead of raw JSON.
  - Port & Transport: Connected to Cyberdeck bridge at 127.0.0.1:4111.

2. [VISUAL GROUNDING & SET-OF-MARKS (SoM)]
  - Three tiers (all share identical badge IDs):
    * take_annotated_screenshot(): Marks table + full-resolution PNG (for vision models).
    * take_economy_screenshot(): Marks table + 640px JPEG (~10-20x lighter, recommended for vision).
    * list_marks(): Marks table only, NO image (zero token waste, ideal for text-only LLMs).
  - Actuation:
    * click_mark(mark_id): Bézier trajectory click on badge number (accepts number or string).
    * type_mark(mark_id, text, clear_first?): Focuses mark badge and types with human cadence.
  - Accessibility & States:
    * Badge tags display roles and state: [role=combobox] {value="...", expanded=false, disabled, required}.
    * Custom selects / menus: Click mark to expand -> call list_marks() -> click option mark -> verify.

3. [NETWORK INTERCEPTION & JSON NAVIGATOR]
  - Inspection:
    * get_network_traffic(resource_type?, url_pattern?, limit?): Compact 1-line HTTP summaries with [HAS_BODY] indicator.
    * get_api_payload(request_id): Retrieves raw response body.
  - Token-Efficient JSON Navigator (query_json_data):
    * Step 1 (Schema): query_json_data({ source: "network_payload", source_id: "<req_id>", view: "schema" }) -> outlines structure and array counts without raw dump.
    * Step 2 (Path Slice): query_json_data({ ..., path: "results.itineraries[0..3].price" }) -> slices arrays and projects nested properties.
    * Step 3 (Filter): Filter at object level before leaf projection:
      - Embedded path style: path: "vendors[?usesCookies = true].name" (filters objects, then projects name).
      - Parameter style: path: "vendors[0..10]", filter_predicate: "usesCookies == true" (do NOT pass leaf .name before filter_predicate).
    * Sources: "network_payload" (request_id), "stream_messages" (stream_id), "download_file" (filename), "inline_json" (jsonString).
    * Views: "value" (default), "schema", "keys", "summary".

4. [RENDERED SNAPSHOTS & SPECULATIVE PRERENDERING]
  - snapshot_rendered_page(format?, wait_until_idle_ms?, pierce_shadow_dom?, save_to_disk?):
    * Freezes post-hydration DOM in heavy SPAs (React, Next.js, Vue).
    * format: "ax_tree" (recommended: semantic hierarchy skipping div soup), "markdown" (clean computed text), "html".
    * Pierces #shadow-root and bakes live input values into attributes.
  - prerender_links(urls?, selector?, max_pages?, harvest_to_cortex?):
    * Speculative Pre-rendering: Pre-executes candidate links in background views for 0ms instantaneous navigation.
    * Automatically distills and embeds pages into LanceDB Cortex memory (recall_memory ready).

5. [MULTI-TAB & SESSION ORCHESTRATION]
  - Tabs: new_tab(url?) -> switch_tab(tab_id) -> list_tabs() (1-line markdown) -> close_tab(tab_id?).
  - Sessions: save_session(name) -> restore_session(name) -> list_sessions() (cookies & storage persist).

5. [LANCEDB CORTEX & KNOWLEDGE RECALL]
  - recall_memory(query, limit?, domain?): Hybrid vector + BM25 search across all previously visited pages.
  - Bookmarks: add_bookmark(url, title, notes?, tags?) -> list_bookmarks(query?, tag?) -> delete_bookmark(url_or_id).
  - History: get_history(limit?, domain?) -> clear_history().

6. [REALTIME WEBSOCKETS & SSE]
  - list_realtime_streams(type?, active_only?): Lists active wss:// sockets and SSE streams.
  - get_stream_messages(stream_id?, limit?): Rolling buffer of parsed frames.

7. [HUMAN-IN-THE-LOOP & SYSTEM TRAY]
  - request_human_intervention(reason, timeout_seconds?, bring_to_front?): PROACTIVELY CALL THIS whenever hitting Cloudflare challenges, CAPTCHAs, login/2FA screens, checkout payments, or critical blockers. Halts agent, triggers audible desktop alerts, unhides window, flashes taskbar, and presents HUD banner until user confirms.
  - set_window_visibility(visible): Minimizes Cyberdeck to tray or restores to screen.
  - send_notification(title, message, urgency?): Native OS desktop notification.`;

  server.resource(
    'mark-eleven-skill',
    'mark-eleven://skills/guide',
    {
      description: 'Comprehensive operational manual and workflow skill guide for Mark Eleven in OKF (Outline Knowledge Format).',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [
        {
          uri: 'mark-eleven://skills/guide',
          mimeType: 'text/markdown',
          text: OKF_SKILL_GUIDE,
        },
      ],
    })
  );

  // Built-in help tool
  server.tool(
    'help',
    'Returns a categorized guide, cheatsheet, and workflow tips for all available Mark Eleven MCP tools (served directly in OKF).',
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
      if (category && category !== 'all') {
        const docs: Record<string, string> = {
          navigation: `### Navigation Tools\n- navigate_to(url, auto_dismiss_consent?): Navigates active browser window to URL and auto-clears cookie overlays.\n- navigate_history(direction: "back" | "forward"): Moves back or forward in history.`,
          interaction: `### Interaction & Telemetry Tools\n- click_element(selector?, x?, y?): Performs organic Bio-Kinematic Chaos mouse movement and switch clicks with visual pointer.\n- type_text(text, selector?): Types with realistic human Gaussian cadence (60-240ms).\n- press_key(key): Dispatches single hardware keys ('Enter', 'Tab', 'Escape', 'Backspace').\n- scroll_page(direction?, amount?): Simulates organic inertial wheel scrolling.\n- fill_form(fields, submit_selector?): Populates multiple form inputs in a single turn.`,
          inspection: `### Visual & Content Inspection\n- get_page_markdown(): Extracts DOM converted to token-efficient Markdown with YAML frontmatter.\n- snapshot_rendered_page(format?, wait_until_idle_ms?, pierce_shadow_dom?): Freezes dynamic post-hydration JS-heavy pages (AX tree outline, rendered markdown, or HTML).\n- prerender_links(urls?, selector?, max_pages?, harvest_to_cortex?): Pre-executes and hydrates candidate links in background views for 0ms navigation and Cortex pre-harvest.\n- take_screenshot(): Captures full viewport image.\n- evaluate_javascript(script): Evaluates arbitrary JS in the active tab.\n- get_page_info(): Returns active URL, title, tab ID, loading status.\n- get_console_logs(limit?): Returns live browser console logs.\n- take_annotated_screenshot(): Set-of-Marks visual badges overlay (full PNG + marks table).\n- take_economy_screenshot(): Same marks table with a small 640px JPEG (~10-20x lighter). Prefer for vision models when cost matters.\n- list_marks(): Marks table only, NO image. Use with text-only models; click_mark/type_mark work afterwards.\n- click_mark(mark_id) / type_mark(mark_id, text): Interacts via Set-of-Marks badge numbers.`,
          tabs: `### Multi-Tab Orchestration\n- new_tab(url?): Opens a new tab.\n- switch_tab(tab_id): Focuses a specific tab.\n- close_tab(tab_id?): Closes a tab.\n- list_tabs(): Returns all open tabs.`,
          memory: `### LanceDB Cortex & Bookmarks\n- recall_memory(query, limit?, domain?): Hybrid vector + BM25 search across all previously browsed pages.\n- add_bookmark(url, title, notes?, tags?): Saves a research bookmark to LanceDB.\n- list_bookmarks(query?, tag?, limit?): Searches or lists saved bookmarks.\n- delete_bookmark(url_or_id): Removes a bookmark.\n- get_history(limit?, domain?): Chronological browsing history.`,
          macros: `### Script Vault & Macro Engine\n- save_script(name, description, code, parameters?): Vaults a reusable DOM script into LanceDB.\n- recall_script(query, limit?): Semantically searches for vaulted automation scripts.\n- run_script(name, args?): Executes vaulted script inside the live tab.\n- list_scripts() / delete_script(name): Manages vaulted scripts.`,
          network: `### Network & Stream Interception\n- get_network_traffic(url_pattern?, method?, resource_type?, limit?): Inspects HTTP requests/responses (returns compact 1-line markdown summaries).\n- get_api_payload(request_id): Retrieves raw JSON response payload from intercepted API calls.\n- query_json_data(source, source_id?, path?, view?, filter_predicate?, max_items?, max_string_length?): Token-efficient JSON navigator. Extracts nested paths (e.g. "items[0..3].price"), distills schemas, filters arrays, and avoids context blowups. Sources: "network_payload", "stream_messages", "download_file", "inline_json".\n- list_realtime_streams(type?, active_only?): Lists active wss:// WebSockets and SSE streams.\n- get_stream_messages(stream_id?, type?, direction?, limit?): Inspects real-time streaming frames.`,
          system: `### System Tray & Human-In-The-Loop\n- set_window_visibility(visible): Minimizes Cyberdeck to system tray or restores to screen.\n- configure_system_tray(close_to_tray?): Configures close-to-tray background mode.\n- request_human_intervention(reason, timeout_seconds?, bring_to_front?): Alerts user with desktop notification, HUD banner, and unhides window when login/CAPTCHA is needed.\n- send_notification(title, message, urgency?, sound?): Sends native OS notification.`
        };
        return { content: [{ type: 'text', text: docs[category] || 'Category not found.' }] };
      }

      return {
        content: [
          {
            type: 'text',
            text: OKF_SKILL_GUIDE
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
            required: Array.isArray(rawSchema.required) ? rawSchema.required : [],
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

  // Standard MCP tools/call structure: { name: string, arguments?: Record<string, any> }
  let container = params.arguments;

  // Some harnesses send args / data / input / parameters as the argument container object
  if (container === undefined || container === null || (typeof container === 'object' && Object.keys(container).length === 0)) {
    if (params.args !== undefined && typeof params.args === 'object' && params.args !== null) {
      container = params.args;
    } else if (params.parameters !== undefined && typeof params.parameters === 'object' && params.parameters !== null) {
      container = params.parameters;
    } else if (params.data !== undefined && typeof params.data === 'object' && params.data !== null) {
      container = params.data;
    } else if (params.input !== undefined && typeof params.input === 'object' && params.input !== null) {
      container = params.input;
    } else if (params.properties !== undefined && typeof params.properties === 'object' && params.properties !== null) {
      container = params.properties;
    } else if (params.props !== undefined && typeof params.props === 'object' && params.props !== null) {
      container = params.props;
    }
  }

  // Parse JSON string if arguments arrived as a serialized string (OpenAI function calling)
  if (typeof container === 'string') {
    try {
      const parsed = JSON.parse(container);
      if (parsed && typeof parsed === 'object') {
        container = parsed;
      }
    } catch {
      // not JSON object
    }
  }

  // Unwrap nested arguments object if doubled: { arguments: { ... } } or { input: { ... } }
  if (container && typeof container === 'object') {
    if (container.arguments && typeof container.arguments === 'object') {
      container = container.arguments;
    } else if (container.input && typeof container.input === 'object') {
      container = container.input;
    }
  }

  // Gather any non-protocol top-level properties on params (for flat callers e.g. { name: 'click_mark', mark_id: 1 } or { name: 'click_mark', id: 1 })
  const protocolKeys = new Set(['name', 'arguments', 'args', 'parameters', 'properties', 'props', 'data', '_meta', 'task', 'method', 'jsonrpc']);
  const topLevelArgs: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!protocolKeys.has(k) && v !== undefined) {
      topLevelArgs[k] = v;
    }
  }

  const rawArgs = {
    ...topLevelArgs,
    ...(typeof container === 'object' && container !== null ? container : {}),
  };

  const normalized: Record<string, any> = {};
  // Copy and convert camelCase to snake_case
  for (const [k, v] of Object.entries(rawArgs)) {
    normalized[k] = v;
    const snakeKey = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (snakeKey !== k && normalized[snakeKey] === undefined) {
      normalized[snakeKey] = v;
    }
  }

  // Aliases for mark_id
  const markVal = normalized.mark_id ?? normalized.markId ?? normalized.mark ?? normalized.badge ?? normalized.index ?? normalized.num ?? normalized.number ?? (normalized.selector === undefined && normalized.tab_id === undefined && normalized.id !== undefined ? normalized.id : undefined);
  if (markVal !== undefined) {
    normalized.mark_id = isNaN(Number(markVal)) ? markVal : Number(markVal);
  }

  // Aliases for script / JS
  const scriptVal = normalized.script ?? normalized.code ?? normalized.js ?? normalized.expression ?? normalized.javascript;
  if (scriptVal !== undefined) {
    normalized.script = String(scriptVal);
  }

  // Aliases for text
  const textVal = normalized.text ?? normalized.value ?? normalized.content ?? (normalized.selector === undefined && normalized.input !== undefined && typeof normalized.input === 'string' ? normalized.input : undefined);
  if (textVal !== undefined) {
    normalized.text = String(textVal);
  }

  // Aliases for tab_id
  const tabVal = normalized.tab_id ?? normalized.tabId ?? normalized.tab ?? (normalized.mark_id === undefined && normalized.id !== undefined ? normalized.id : undefined);
  if (tabVal !== undefined) {
    normalized.tab_id = typeof tabVal === 'number' ? `tab_${tabVal}` : String(tabVal);
  }

  // Aliases for url
  const urlVal = normalized.url ?? normalized.destination ?? normalized.target ?? normalized.link ?? normalized.href ?? normalized.address ?? normalized.uri ?? normalized.URL;
  if (urlVal !== undefined) {
    normalized.url = String(urlVal);
  }

  // Aliases for reason
  const reasonVal = normalized.reason ?? normalized.message ?? normalized.prompt;
  if (reasonVal !== undefined) {
    normalized.reason = String(reasonVal);
  }

  // Aliases for selector
  const selectorVal = normalized.selector ?? normalized.element ?? normalized.target ?? normalized.css ?? (normalized.search_query === undefined && normalized.query !== undefined ? normalized.query : undefined);
  if (selectorVal !== undefined) {
    normalized.selector = String(selectorVal);
  }

  // Aliases for key
  const keyVal = normalized.key ?? normalized.key_name ?? normalized.button;
  if (keyVal !== undefined) {
    normalized.key = String(keyVal);
  }

  // Booleans / numbers / settings
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
            required: Array.isArray(rawSchema.required) ? rawSchema.required : [],
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
