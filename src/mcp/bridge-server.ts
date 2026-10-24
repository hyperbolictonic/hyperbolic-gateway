import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS_CATALOG, TOOL_TIERS, TIER_LABELS } from './tools-catalog.js';
import { formatMark } from './format-mark.js';
import { APP_VERSION } from '../shared/version.js';
import { decisionStatus } from '../main/decide/decision-client.js';

const BRIDGE_URL = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';

// --- Diagnostics policy ------------------------------------------------------
// stdout is the JSON-RPC lifeline; stderr is diagnostics only. A client that
// pipes stderr but never drains it fills the OS pipe buffer and wedges the
// child. This server used to write ~500 bytes per tool call to stderr, so a
// normal browsing turn (~125 calls) was enough to kill the whole namespace.
// See docs/HANDOFF_ORCHA_MCP_STDERR.md.
//
//   - the file log is always written, asynchronously and memory-bounded;
//   - stderr gets a short boot banner by default and nothing per call;
//   - verbose stderr is opt-in and is backpressure-aware (lines are dropped,
//     never queued) plus hard-capped, so it can never wedge the process.
//
// Env: KUANG_MCP_LOG=0 (no file log), KUANG_MCP_STDERR=0 (no stderr),
//      KUANG_MCP_STDERR=verbose (per-call stderr, debugging only).
const LOG_TO_FILE = process.env.KUANG_MCP_LOG !== '0';
const STDERR_MODE: 'off' | 'boot' | 'verbose' =
  process.env.KUANG_MCP_STDERR === '0'
    ? 'off'
    : process.env.KUANG_MCP_STDERR === 'verbose'
      ? 'verbose'
      : 'boot';
const STDERR_HARD_CAP_BYTES = 16 * 1024;

const LOG_DIR = path.resolve(process.cwd(), 'data', 'logs');
let logDirReady = false;
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logDirReady = true;
} catch {
  // Logging is best-effort; never fail startup because of it.
}

let logQueue: string[] = [];
let logFlushing = false;
const LOG_QUEUE_MAX_LINES = 2000;

function flushLogQueue(): void {
  if (!LOG_TO_FILE || !logDirReady || logFlushing || logQueue.length === 0) return;
  logFlushing = true;
  const batch = logQueue.join('');
  logQueue = [];
  fs.appendFile(path.join(LOG_DIR, 'mcp-server.log'), batch, () => {
    logFlushing = false;
    if (logQueue.length > 0) flushLogQueue();
  });
}

/** Synchronous drain used only on shutdown paths, where async I/O cannot run. */
function flushLogSync(): void {
  if (!LOG_TO_FILE || !logDirReady || logQueue.length === 0) return;
  const batch = logQueue.join('');
  logQueue = [];
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'mcp-server.log'), batch);
  } catch {
    // Ignore.
  }
}

let stderrBytesWritten = 0;
let stderrBlocked = false;

/** Bounded, non-queuing stderr write. Dropped lines are intentional. */
function writeStderr(text: string): void {
  if (STDERR_MODE === 'off' || stderrBlocked) return;
  if (stderrBytesWritten >= STDERR_HARD_CAP_BYTES) return;
  const chunk = text.endsWith('\n') ? text : `${text}\n`;
  try {
    const accepted = process.stderr.write(chunk);
    stderrBytesWritten += Buffer.byteLength(chunk);
    if (!accepted) {
      // The consumer is not reading. Stop writing instead of buffering.
      stderrBlocked = true;
      process.stderr.once('drain', () => {
        stderrBlocked = false;
      });
    }
  } catch {
    stderrBlocked = true;
  }
}

type LogLevel = 'boot' | 'call' | 'error';

function preview(value: unknown, max = 2000): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function logMcp(message: string, level: LogLevel = 'call'): void {
  const timestamp = new Date().toISOString();
  if (LOG_TO_FILE) {
    if (logQueue.length >= LOG_QUEUE_MAX_LINES) logQueue.shift();
    logQueue.push(`[${timestamp}] ${message}\n`);
    flushLogQueue();
  }
  if (STDERR_MODE === 'verbose' || (STDERR_MODE === 'boot' && level !== 'call')) {
    writeStderr(`[Mark Eleven MCP ${timestamp}] ${message}`);
  }
}

// --- Process resilience -----------------------------------------------------
// A closed stdout pipe (EPIPE) used to arrive as an unhandled 'error' event on
// process.stdout, which crashed the whole MCP server and made the client drop the
// entire kuang tool namespace. Guard it and exit cleanly instead.
let stdoutClosed = false;
process.stdout.on('error', (err: any) => {
  if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') {
    if (!stdoutClosed) {
      stdoutClosed = true;
      logMcp('stdout pipe closed by client (EPIPE); shutting down cleanly.', 'boot');
    }
    process.exit(0);
  }
  logMcp(`stdout stream error: ${err?.message || err}`, 'error');
});
process.stderr.on('error', () => { /* never let logging throw */ });

// Explicit lifecycle: if the client closes our stdin, exit rather than linger as
// an orphan that keeps competing for the single browser session.
let shuttingDown = false;
function shutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logMcp(reason, 'boot');
  flushLogSync();
  process.exit(0);
}
process.stdin.on('end', () => shutdown('stdin closed by client; shutting down cleanly.'));
process.stdin.on('close', () => shutdown('stdin stream closed; shutting down cleanly.'));
process.on('exit', () => flushLogSync());

// Keep the namespace alive on stray async errors. This server is a stateless
// HTTP forwarder, so continuing after a rejection is safe and far better than
// vanishing mid-session.
process.on('unhandledRejection', (reason: any) => {
  logMcp(`Unhandled promise rejection (server kept alive): ${reason?.stack || reason}`, 'error');
});
process.on('uncaughtException', (err: any) => {
  logMcp(`Uncaught exception (server kept alive): ${err?.stack || err}`, 'error');
});

// Hard ceiling on any single text tool response so one oversized payload
// (e.g. a multi-MB get_api_payload / query_json_data slice) can neither flood the
// client context nor wedge the stdio transport.
const MAX_TEXT_CHARS = 60000;
function clampText(text: string): string {
  if (typeof text !== 'string' || text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n... [Mark Eleven MCP: response truncated at ${MAX_TEXT_CHARS} chars to protect the agent context. Narrow the query (e.g. query_json_data path/projection) for a smaller result.]`;
}

// Ceiling on any single bridge round-trip. Generous enough for HIL waits and
// long navigations, but guarantees a wedged Cyberdeck cannot hang a tool forever.
const BRIDGE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.KUANG_BRIDGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
})();

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
  let res: Response;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS) });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(
        `Bridge request timed out after ${BRIDGE_TIMEOUT_MS}ms (${method} ${endpoint}). ` +
          `The Cyberdeck may be busy or wedged; retry or call bridge_health().`
      );
    }
    throw err;
  }
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

/** Names gated by Settings → Recording → "Let agents use the recording tools". */
const RECORDING_TOOL_NAMES = new Set(['record_start', 'record_stop', 'list_recordings']);

/** Short probe; a bridge that is down must not hide tools (it may start later). */
async function recordingToolsAllowed(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_URL}/recording/status`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return true;
    const data: any = await res.json();
    return data?.toolsEnabled !== false;
  } catch {
    return true;
  }
}

/** Tools whose response carries a native image part (see the Phase-3 screenshot merge). */
const IMAGE_TOOLS = new Set([
  'take_screenshot',
  'take_annotated_screenshot',
  'take_economy_screenshot',
  'list_marks',
]);

export async function createBridgeMcpServer() {
  const server = new McpServer({
    name: 'kuang-grade-mark-eleven',
    version: APP_VERSION,
  });

  // The recording tools are gated by a human-only switch in Settings → Recording. Probe the
  // bridge once at startup: when the switch is off, they are not registered at all (so they
  // cannot appear in tools/list). The bridge routes refuse them too, which covers sessions
  // that were already connected when the switch was flipped.
  const recordingToolsAvailable = await recordingToolsAllowed();
  if (!recordingToolsAvailable) {
    logMcp('[Recording] Tools are disabled by the human-only switch; not registering them.', 'boot');
  }

  // When a decision model is configured, its tools are the most interesting thing on the surface:
  // register them first so `tools/list` leads with `drive` and `decide` instead of burying them
  // among 59 browser tools. When it is not configured they are not registered at all.
  const decisionConfigured = decisionStatus().configured;
  const orderedTools = decisionConfigured
    ? [
        ...TOOLS_CATALOG.filter((t) => t.name === 'drive' || t.name === 'decide'),
        ...TOOLS_CATALOG.filter((t) => t.name !== 'drive' && t.name !== 'decide'),
      ]
    : TOOLS_CATALOG;

  for (const tool of orderedTools) {
    // The decision model is opt-in: when no backend is configured, `decide`/`drive` are not
    // registered at all (so they cannot appear in tools/list and cannot be called by name). The
    // bridge routes still exist and answer NOT_CONFIGURED with setup instructions.
    if ((tool.name === 'decide' || tool.name === 'drive') && !decisionConfigured) continue;
    if (!recordingToolsAvailable && RECORDING_TOOL_NAMES.has(tool.name)) continue;

    // Phase 4: fold discoverability guidance into the advertised description so it
    // travels with every tools/list entry in any agent framework.
    const tier = TOOL_TIERS[tool.name];
    const prefix = tool.hidden
      ? `[DEPRECATED → use "${tool.deprecatedInFavorOf || 'the canonical tool'}"] `
      : tier
        ? `[${TIER_LABELS[tier]}] `
        : '';
    server.tool(tool.name, `${prefix}${tool.description}`, tool.parameters, async (args) => {
      try {
        logMcp(`[Tool Dispatch] "${tool.name}" with args: ${preview(args)}`);
        const body = tool.payload ? tool.payload(args) : args;
        const endpoint = tool.endpointFor ? tool.endpointFor(args) : tool.endpoint;
        logMcp(`[HTTP Forward] ${tool.method || 'POST'} ${endpoint} body: ${preview(body)}`);
        const data = await callBridge(endpoint, tool.method || 'POST', body);

        // Image-bearing tools: plain viewport screenshots and Set-of-Marks scans.
        // After the Phase-3 merge these funnel through take_screenshot (legacy
        // names remain as hidden aliases), so branch on the target, not the name.
        if (IMAGE_TOOLS.has(tool.name)) {
          const rawBase64 = extractCleanBase64(data);
          const screenshot = data.screenshot || data;
          const filePath = screenshot.filePath || '';
          const w = screenshot.width || 0;
          const h = screenshot.height || 0;
          const marks = Array.isArray(data.marks) ? data.marks : [];
          const withMarks = tool.name !== 'take_screenshot' || args?.marks === true;

          let text: string;
          if (withMarks) {
            const marksTable = marks.map((m: any) => formatMark(m)).join('\n');
            const header = filePath
              ? `Set-of-Marks Screenshot saved to ${filePath} (${w}x${h}px). ${marks.length} interactive elements detected.`
              : `Set-of-Marks text scan (viewport ${w}x${h}px, no image). ${marks.length} interactive elements detected.`;
            text = clampText(`${header}\n\nInteractive Elements:\n${marksTable}\n\nActuate via act(mark_id, action) — action defaults to "click"; "type" for inputs (text=...), "hover" for menus, "press" for keys.`);
          } else {
            text = filePath
              ? `Screenshot captured and saved to ${filePath} (${w}x${h}px).`
              : `Screenshot captured (${w}x${h}px).`;
          }

          const content: any[] = [{ type: 'text', text }];
          if (rawBase64) {
            content.push({
              type: 'image',
              data: rawBase64,
              mimeType: screenshot.mimeType || (filePath.endsWith('.png') ? 'image/png' : 'image/jpeg'),
            });
          }
          logMcp(`[Tool Success] "${tool.name}" returning text${rawBase64 ? ' + image part' : ' only'} (${rawBase64.length} chars base64, ${marks.length} marks, path: ${filePath})`);
          return { content };
        }

        const rawText = tool.format
          ? tool.format(data, args)
          : typeof data === 'string'
            ? data
            : JSON.stringify(data, null, 2);
        const text = clampText(typeof rawText === 'string' ? rawText : String(rawText ?? ''));
        logMcp(`[Tool Success] "${tool.name}" result: ${text.slice(0, 100)}`);
        return { content: [{ type: 'text', text }] };
      } catch (err: any) {
        logMcp(`[Tool Error] "${tool.name}": ${err?.message || err}`, 'error');
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

1. [CORE ARCHITECTURE & OPERATIONAL SEQUENCE]
  - Visual Browser: Active visible Chromium window ('headless: false') with Bézier ghost-cursor telemetry.
  - Zero Context Bleed: Tools return compact 1-line markdown or distilled structures instead of raw JSON.
  - PREFERENTIAL SEQUENCE (Tokens & Anti-Shadowban):
    * TIER 1 (First Choice): observe(as:"markdown") -> clean text with inline [#ID] marks. Actuate via act(mark_id, action) (or act(selector) / act(x, y) when you have no badge). Zero vision tokens burned!
    * TIER 2 (Fallback): take_screenshot(marks:true, detail:"economy") -> downscaled 640px JPEG Set-of-Marks. Use ONLY when visual layout/CAPTCHA requires vision.
    * TIER 3 (Use deliberately): evaluate_javascript() -> arbitrary page JS that can read AND mutate. A powerful tool for what the primitives cannot express — prefer observe/extract for reads and act for clicks/typing, since heavy injected JS is a bot-detection signal (untrusted events).
  - Start non-trivial sessions with bridge_health() to read capabilities[], revision and input.transport.
  - QUICK DECISION ORDER (5 common jobs): read a page -> observe(as:"markdown"); find an element -> find(); act -> act(mark_id | selector | x,y, action); wait -> wait_for(conditions[]); harvest a lazy list -> collect_all(). Full detail: mark-eleven://tools/recommended.

2. [ORTHOGONAL PRIMITIVES — PREFER THESE OVER BLIND SLEEPS]
  - wait_for(conditions[], require?, timeout_ms?, poll_ms?): declarative readiness gate; returns {ok, waitedMs, attempts, results[]}. Replaces every sleep.
  - act(mark_id? | selector? | x?+y?, action, text?, secret?, clear_first?, await_conditions?, timeout_ms?, dry_run?): unified humanlike click/focus/hover/type/press on a mark badge, a CSS selector, or viewport coordinates + optional post-conditions + delta report. dry_run resolves without acting; secret redacts credentials; clear_first=true replaces a pre-filled value (Ctrl+A + Backspace) instead of appending.
  - TYPING DISCIPLINE: typing APPENDS by default. On any field that may already hold a value (pre-filled origins/airports, search boxes, comboboxes) pass clear_first=true. For an autocomplete, type then COMMIT by clicking the option mark — free text is often ignored by React selects. If a click appears to do nothing, do NOT simply re-click: check diff(since) and read the form/validation state, because an invalid field silently blocks submit and looks exactly like a dropped click.
  - expect(conditions[]): immediate assertion (no polling) with per-condition evidence.
  - find(role?, name?, contains?, regex?, tag?, selector?): semantic search -> mark refs (feed them to act).
  - extract(kind:"list"|"table"|"tables"|"app_data"|"schema_org", ref?, selector?, type?): structured read (repeating rows, one table, every table, embedded __NEXT_DATA__/JSON-LD, or typed schema.org items — pass type to keep just e.g. "Recipe").
  - collect_all(selector?, ref?, scroll?, max_scrolls?, max?): scroll a lazy/infinite list to the end and dedupe rows in ONE call, with scroll diagnostics.
  - observe(as:"markdown"|"text"|"ax"|"som", region?, budget?, cursor?): one observation model; page huge pages with budget + next_cursor.
  - read_url(url?, max_chars?, cursor?): read ANY URL as Markdown in ONE call — site-provided Markdown/Text when the site advertises it, else a detached render distilled to Markdown (your active tab is untouched); paged via max_chars + next_cursor (the result reports a machine-readable 'next_cursor=<offset>' fact when truncated). Prefer this to read a specific URL.
  - llm_surface(url?) / llm_fetch(url?, as?): the site's OWN Markdown/Text (llms.txt, <link rel=alternate> or a real <a href="….md"> page link, or negotiated) instead of a render — GATED on an advertised surface. 'recommended' is NULL when there is none (that is NOT a fetch target): follow 'next' (llm_fetch(as) or observe(as:"markdown")). Both report 'scope' (origin|page).
  - search_web(query, engine?, engines?, url_template?, max_results?): multi-engine search in a detached view with automatic fallback → ranked {title,url,snippet}; feed the URLs to navigate_to / collect_all.
  - deep_crawl(url, max_depth?, max_pages?, match_patterns?, same_origin?, prefer_llm?, harvest_to_cortex?): autonomous BFS crawl that distills + indexes each page into Cortex (cheap llm path first); scope with match_patterns.
  - research_topic(query, max_sources?, engine?, url_template?, excerpt_chars?, harvest_to_cortex?): autonomous search → gather top sources → distill → index into Cortex; returns cited EXTRACTIVE evidence (no prose — you synthesize).
  - page_state() / diff(since?): cheap change signature + field-by-field diff for loops (no full re-reads).
  - Condition vocabulary: selector / gone / text(regex) / url / role_name / count(min/equals/max) / network_idle / stable(target:"marks"|"height"|"text"|"nodes") / revision. WARNING: skeletons can satisfy a naive selector early — prefer stable/count for lazily-rendered lists.
  - Errors are machine-coded (HTTP 400): STALE_REF (re-scan), TIMEOUT, NO_TARGET, BAD_REQUEST, NOT_SUPPORTED. See resource mark-eleven://okf/partitions/primitives-and-workflows for recipes R1-R6.

3. [VISUAL GROUNDING & SET-OF-MARKS (SoM)]
  - ONE tool, three detail levels (identical badge IDs): take_screenshot(marks:true, detail?):
    * detail="full" (default): Marks table + full-resolution PNG (for vision models).
    * detail="economy": Marks table + 640px JPEG (~10-20x lighter, recommended for vision).
    * detail="markdown": Marks table only, NO image (zero token waste; equal to observe(as:"som")).
    * plain viewport image (no badges): take_screenshot() -> 768px JPEG.
  - Actuation:
    * act(mark_id | selector | x,y, action): unified click/focus/hover/type/press with optional post-conditions. mark_id is preferred (re-resolved against the live DOM, tracks layout shifts); selector and x/y are escape hatches.
  - Accessibility & States:
    * Badge tags display roles and state: [role=combobox] {value="...", expanded=false, disabled, required}.
    * Custom selects / menus: Click mark to expand -> call observe(as:"som") -> click option mark -> verify.
    * Long/virtualized result lists: pass include_offscreen=true to take_screenshot(marks:true) / observe() so below-the-fold items are numbered too (act scrolls them into view before clicking).

4. [NETWORK INTERCEPTION & JSON NAVIGATOR]
  - Inspection:
    * get_network_traffic(resource_type?, url_pattern?, limit?, since?): Compact 1-line HTTP summaries with [HAS_BODY] indicator. since accepts epoch-ms, a revision, or "last_action" (only what the last mutating action fired).
    * Raw response body: query_json_data({ source:"network_payload", source_id:"<req_id>" }) (add path/view to slice it).
    * export_har(pattern?, limit?, save?): HAR 1.2 export (save=true writes data/har/har_<ts>.har).
  - Token-Efficient JSON Navigator (query_json_data):
    * Step 1 (Schema): query_json_data({ source: "network_payload", source_id: "<req_id>", view: "schema" }) -> outlines structure and array counts without raw dump.
    * Step 2 (Path Slice): query_json_data({ ..., path: "results.itineraries[0..3].price" }) -> slices arrays and projects nested properties.
    * Step 3 (Filter): Filter at object level before leaf projection:
      - Embedded path style: path: "vendors[?usesCookies = true].name" (filters objects, then projects name).
      - Parameter style: path: "vendors[0..10]", filter_predicate: "usesCookies == true" (do NOT pass leaf .name before filter_predicate).
    * Sources: "network_payload" (request_id), "stream_messages" (stream_id), "download_file" (filename), "inline_json" (jsonString).
    * Views: "value" (default), "schema", "keys", "summary".

5. [RENDERED SNAPSHOTS & SPECULATIVE PRERENDERING]
  - snapshot_rendered_page(format?, wait_until_idle_ms?, pierce_shadow_dom?, save_to_disk?):
    * Freezes post-hydration DOM in heavy SPAs (React, Next.js, Vue).
    * format: "ax_tree" (recommended: semantic hierarchy skipping div soup), "markdown" (clean computed text), "html".
    * Pierces #shadow-root and bakes live input values into attributes.
  - prerender_links(urls?, selector?, max_pages?, harvest_to_cortex?):
    * Speculative Pre-rendering: Pre-executes candidate links in background views for 0ms instantaneous navigation.
    * Automatically distills and embeds pages into LanceDB Cortex memory (recall_memory ready).

6. [MULTI-TAB & SESSION ORCHESTRATION]
  - Tabs: new_tab(url?) -> switch_tab(tab_id) -> list_tabs() (1-line markdown) -> close_tab(tab_id?).
  - Profiles (cookies & storage persist across runs): context_save(name) -> context_open(name) -> context_list() -> context_delete(name).
  - Legacy save_session / restore_session / list_sessions are deprecated aliases (still callable by name, hidden from tools/list).

7. [LANCEDB CORTEX & KNOWLEDGE RECALL]
  - recall_memory(query, limit?, domain?): Hybrid vector + BM25 search across all previously visited pages.
  - Bookmarks: add_bookmark(url, title, notes?, tags?) -> list_bookmarks(query?, tag?) -> delete_bookmark(url_or_id).
  - History: browsing_history(limit?, domain?) -> browsing_history_clear().

8. [REALTIME WEBSOCKETS & SSE]
  - list_realtime_streams(type?, active_only?): Lists active wss:// sockets and SSE streams.
  - Inspect stream frames with query_json_data({ source:"stream_messages", source_id:"<streamId>" }) (get_stream_messages is deprecated).

9. [INPUT DELIVERY & BACKGROUND RENDERING]
  - Synthetic input is dispatched over CDP (Input.dispatchMouseEvent / dispatchKeyEvent / mouseWheel) and is FOCUS-INDEPENDENT: clicks/typing land even when another app owns the OS foreground. bridge_health().input.transport reports "cdp" (good) or "native" (legacy fallback that needs the window focused).
  - Browsing tabs run with backgroundThrottling disabled + occlusion/renderer/timer backgrounding switches, so an occluded Cyberdeck still renders and fires scroll events (lazy-load harvests work while the window is behind your editor).
  - Viewport gating: real input needs a non-zero viewport. If a fresh/hidden tab reports 0x0, call set_window_visibility({visible:true}) and wait for a non-zero viewport. Making the window visible to a human (HIL) is the only other reason to call it.

10. [HUMAN-IN-THE-LOOP & SYSTEM TRAY]
  - request_human_intervention(reason, timeout_seconds?, bring_to_front?): PROACTIVELY CALL THIS whenever hitting Cloudflare challenges, CAPTCHAs, login/2FA screens, checkout payments, or critical blockers. Halts agent, triggers audible desktop alerts, unhides window, flashes taskbar, and presents HUD banner until user confirms.
  - set_window_visibility(visible?, focus?): Shows/restores the window (and focuses it by default) or hides it to the tray.
  - send_notification(title, message, urgency?): Native OS desktop notification.`;

  // 1. Standard MCP Resource: mark-eleven://skills/guide
  // Any agent in ANY directory or external repo can read this via list_resources / read_resource
  server.resource(
    'mark-eleven-skill',
    'mark-eleven://skills/guide',
    {
      description: 'Comprehensive operational manual, Golden Operational Sequence, and workflow skill guide for Mark Eleven in OKF (Outline Knowledge Format).',
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

  // 2. Standard MCP Resource: mark-eleven://okf/manifest
  server.resource(
    'okf-manifest',
    'mark-eleven://okf/manifest',
    {
      description: 'Open Knowledge Format (OKF) manifest declaring bundleId kuang_browser_docs and all available partitions.',
      mimeType: 'application/json',
    },
    async () => {
      const manifestPath = path.resolve(process.cwd(), 'kuang_docs', 'okf.json');
      let text = '{}';
      try { text = fs.readFileSync(manifestPath, 'utf8'); } catch {}
      return { contents: [{ uri: 'mark-eleven://okf/manifest', mimeType: 'application/json', text }] };
    }
  );

  // 3. Standard MCP Resource: mark-eleven://okf/partitions/selector-and-som
  server.resource(
    'okf-selector-som',
    'mark-eleven://okf/partitions/selector-and-som',
    {
      description: 'OKF Playbook: Golden Operational Sequence (Markdown -> Economy Screenshot -> Read-Only JS) and Set-of-Marks visual recipes.',
      mimeType: 'text/markdown',
    },
    async () => {
      const docPath = path.resolve(process.cwd(), 'kuang_docs', 'partitions', 'selector_and_som_recipes.md');
      let text = '';
      try { text = fs.readFileSync(docPath, 'utf8'); } catch {}
      return { contents: [{ uri: 'mark-eleven://okf/partitions/selector-and-som', mimeType: 'text/markdown', text }] };
    }
  );

  // 4. Standard MCP Resource: mark-eleven://okf/partitions/captcha-and-anti-bot
  server.resource(
    'okf-captcha-antibot',
    'mark-eleven://okf/partitions/captcha-and-anti-bot',
    {
      description: 'OKF Playbook: Challenge Triage Matrix, Turnstile, text CAPTCHA solving, and HIL trigger rules.',
      mimeType: 'text/markdown',
    },
    async () => {
      const docPath = path.resolve(process.cwd(), 'kuang_docs', 'partitions', 'captcha_and_anti_bot_strategies.md');
      let text = '';
      try { text = fs.readFileSync(docPath, 'utf8'); } catch {}
      return { contents: [{ uri: 'mark-eleven://okf/partitions/captcha-and-anti-bot', mimeType: 'text/markdown', text }] };
    }
  );

  // 5. Standard MCP Resource: mark-eleven://okf/partitions/browser-navigation
  server.resource(
    'okf-browser-navigation',
    'mark-eleven://okf/partitions/browser-navigation',
    {
      description: 'OKF Playbook: 0ms speculative prerender navigation, multi-tab orchestration, and session persistence.',
      mimeType: 'text/markdown',
    },
    async () => {
      const docPath = path.resolve(process.cwd(), 'kuang_docs', 'partitions', 'browser_navigation_playbook.md');
      let text = '';
      try { text = fs.readFileSync(docPath, 'utf8'); } catch {}
      return { contents: [{ uri: 'mark-eleven://okf/partitions/browser-navigation', mimeType: 'text/markdown', text }] };
    }
  );

  // 6. Standard MCP Resource: mark-eleven://okf/partitions/primitives-and-workflows
  server.resource(
    'okf-primitives-workflows',
    'mark-eleven://okf/partitions/primitives-and-workflows',
    {
      description: 'OKF Reference: the orthogonal primitive layer (observe/act/wait_for/expect/find/extract/collect_all/page_state/diff/export_har/contexts), wait vocabulary, error codes, recipes R1-R5, and input-delivery guarantees.',
      mimeType: 'text/markdown',
    },
    async () => {
      const docPath = path.resolve(process.cwd(), 'kuang_docs', 'partitions', 'primitives_and_workflows.md');
      let text = '';
      try { text = fs.readFileSync(docPath, 'utf8'); } catch {}
      return { contents: [{ uri: 'mark-eleven://okf/partitions/primitives-and-workflows', mimeType: 'text/markdown', text }] };
    }
  );

  // Standard MCP Resource: mark-eleven://tools/recommended
  // The canonical "what to use when" order, in one place, so an agent that only reads
  // resources (or the help `all` text) still picks the right tool.
  const RECOMMENDED_ORDER = `# Mark Eleven — Recommended Tool Order

Reach for these first; anything whose description starts with \`[TIER n]\` is a fallback.

| Job | Use | Fallback |
| :--- | :--- | :--- |
| Read / understand a page | \`observe(as:"markdown")\` | \`take_screenshot(marks:true, detail:"economy")\` |
| Read a URL as Markdown (site-provided or rendered) | \`read_url(url)\` | \`llm_surface\` → \`llm_fetch\` → \`observe(as:"markdown")\` |
| Find an element | \`find(...)\` | \`observe(as:"som")\` and read the \`[#ID]\` |
| Act on an element | \`act(mark_id, action)\` | \`act(selector)\` / \`act(x, y)\` |
| Wait for readiness | \`wait_for(conditions[])\` | — |
| Harvest a lazy list | \`collect_all(...)\` | \`observe\` + \`scroll_page\` |

Rules of thumb:
- Never \`sleep\`; use \`wait_for\` or \`act(await_conditions=[...])\`.
- Prefer act() over \`evaluate_javascript\` (TIER 3): CDP input is the humanlike path, and heavy injected JS is a bot-detection signal — it stays available for what the primitives cannot express.
- Prefer \`observe\` over screenshots; prefer a mark id over a CSS selector.
- Use \`expect(...)\` to assert now, \`page_state()\`/\`diff(since)\` to confirm change cheaply.
`;

  server.resource(
    'tools-recommended',
    'mark-eleven://tools/recommended',
    {
      description: 'Canonical "what to use when" order across the five common jobs (read, find, act, wait, harvest).',
      mimeType: 'text/markdown',
    },
    async () => ({ contents: [{ uri: 'mark-eleven://tools/recommended', mimeType: 'text/markdown', text: RECOMMENDED_ORDER }] })
  );

  // Built-in help tool
  server.tool(
    'help',
    'Returns a categorized guide, cheatsheet, and workflow tips for all available Mark Eleven MCP tools (served directly in OKF).',
    {
      category: z.enum([
        'all',
        'recommended',
        'navigation',
        'interaction',
        'primitives',
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
          recommended: RECOMMENDED_ORDER,
          navigation: `### Navigation Tools\n- navigate_to(url, auto_dismiss_consent?): Navigates active browser window to URL and auto-clears cookie overlays.\n- navigate_history(direction: "back" | "forward"): Moves back or forward in history.`,
          interaction: `### Interaction & Telemetry Tools\n- act(mark_id? | selector? | x?+y?, action, text?, secret?, await_conditions?, dry_run?): unified humanlike click/focus/hover/type/press with optional post-conditions and a before/after delta (the preferred way to interact).\n- press_key(key): Dispatches single hardware keys ('Enter', 'Tab', 'Escape', 'Backspace').\n- scroll_page(direction?, amount?): Simulates organic inertial wheel scrolling.\n- fill_form(fields, submit_selector?): Populates multiple form inputs in a single turn.`,
          primitives: `### Orthogonal Primitives (prefer over blind sleeps)\n- bridge_health(): version, revision, capabilities[], window, input.transport.\n- wait_for(conditions[], require?, timeout_ms?, poll_ms?): declarative readiness gate (replaces sleeps).\n- act(mark_id? | selector? | x?+y?, action, text?, secret?, await_conditions?, timeout_ms?, dry_run?): unified click/focus/hover/type/press (mark badge, CSS selector, or coordinates) + post-conditions + delta. Selectors pierce open shadow roots and resolve a custom-element host to the control a mouse would hit. Typing is verified: a provable no-op returns ok:false with error.code TYPE_NO_EFFECT plus a typing evidence object (key counts, value lengths — never the text) and a hint that says whether input never arrived or the control refuses it (OTP → request_human_intervention).\n- expect(conditions[]): immediate assertion with per-condition evidence.\n- decide(state, questions?, model?): OPTIONAL typed decision model (absent unless a backend is configured; see Settings). One call, many questions: choice (takes criteria, option->description — NOT options), score, noul. Returns answers + confidence verbatim; never called implicitly; an answer is a component id, never a selector. Loop: observe(as:"components") -> decide -> act(mark_id) -> verify. GET /decisions lists the last 50 calls.\n- find(role?, name?, contains?, regex?, tag?, selector?): semantic search -> mark refs.\n- extract(kind:"list"|"table"|"tables"|"app_data"|"schema_org", ref?, selector?, type?): structured reads (rows, tables, every table, embedded JSON, typed JSON-LD).\n- collect_all(selector?, ref?, scroll?, max_scrolls?, max?): harvest a lazy/infinite list in one call.\n- observe(as:"markdown"|"text"|"ax"|"som", region?, budget?, cursor?): budgeted, cursor-paged observation. markdown reads the COMPOSED DOM (open shadow roots, live form values, passwords as a length only); its envelope reports reader/extracted_chars/page_chars/shadow_roots; it returns a 25,000-char default view (budget:0 = the whole construct) and a partly-visible or text-free page says so.
- read_url(url?, max_chars?, cursor?): read ANY URL as Markdown in one call (site-provided Markdown/Text when advertised, else a detached render); always returns text, paged via max_chars + next_cursor.\n- llm_surface(url?): checks whether a site publishes an LLM-friendly Markdown/Text surface (/llms.txt, /sitemap.xml, <link rel=alternate> or a real <a href="….md"> page link, or content negotiation) and returns recommended ("llms_txt"|"llms_full"|"markdown"|"text", or NULL when there is none), scope (origin|page) and next (the unambiguous next step).
- llm_fetch(url?, as?): fetches that advertised representation (GATED — NO_LLM_SURFACE when nothing is advertised, or when recommended is null). Reports scope + scope_mismatch. For a normal rendered page use observe(as:"markdown") or read_url.\n- page_state() / diff(since?): cheap change detection for loops.\n- export_har(pattern?, limit?, save?): HAR 1.2 export. context_save/open/list/delete(name): cookie+storage profiles.\n- Condition vocabulary: selector/gone/text/regex/url/role_name/count/network_idle/stable/revision. Errors: STALE_REF|TIMEOUT|NO_TARGET|BAD_REQUEST|NOT_SUPPORTED|NO_LLM_SURFACE|FETCH_BLOCKED.`,
          inspection: `### Visual & Content Inspection\n- observe(as:"markdown"|"text"|"ax"|"som", region?, budget?, cursor?): primary budgeted read/projection (preferred over get_page_markdown).\n- take_screenshot(marks?, detail?, include_offscreen?, max_width?, format?, quality?): plain viewport image, or Set-of-Marks when marks=true with detail "full"|"economy"|"markdown".\n- snapshot_rendered_page(format?, wait_until_idle_ms?, pierce_shadow_dom?): Freezes dynamic post-hydration JS-heavy pages (AX tree outline, rendered markdown, or HTML).\n- prerender_links(urls?, selector?, max_pages?, harvest_to_cortex?): Pre-executes and hydrates candidate links in background views for 0ms navigation and Cortex pre-harvest.\n- evaluate_javascript(script): Evaluates arbitrary JS in the active tab (can read AND mutate). Powerful — reach for it deliberately; observe/extract cover most reads and act covers clicks/typing, and injected JS is a bot-detection signal.\n- bridge_health(): version, revision, capabilities, window, input.transport (replaces get_page_info).\n- get_console_logs(limit?): Returns live browser console logs.\n- act(mark_id | selector | x,y, action): the single interaction entry point; address by Set-of-Marks badge, CSS selector, or viewport coordinates.
- read_url(url?, max_chars?, cursor?) / llm_surface(url?) / llm_fetch(url?, as?): read a URL as Markdown — site's OWN Markdown/Text (llms.txt, sitemap, <link rel=alternate> or a real <a href="….md"> link, or negotiated) instead of rendering the page; gated on an advertised surface (recommended null means "none — render"), else observe(as:"markdown"). read_url is the one-call composite.
- search_web(query, engine?, engines?, url_template?, max_results?): multi-engine web search (google|duckduckgo|bing|brave|startpage|custom) run in a detached view with automatic fallback; returns ranked {title,url,snippet}.
- deep_crawl(url, max_depth?, max_pages?, match_patterns?, same_origin?, prefer_llm?, harvest_to_cortex?): autonomous BFS crawl; distills each page to Markdown and indexes it into Cortex (cheap llm path first).
- research_topic(query, max_sources?, engine?, url_template?): autonomous search → gather top sources → distill → index into Cortex; returns cited EXTRACTIVE evidence (you write the answer).`,
          tabs: `### Multi-Tab Orchestration\n- new_tab(url?): Opens a new tab.\n- switch_tab(tab_id): Focuses a specific tab.\n- close_tab(tab_id?): Closes a tab.\n- list_tabs(): Returns all open tabs.`,
          memory: `### LanceDB Cortex & Bookmarks\n- recall_memory(query, limit?, domain?): Hybrid vector + BM25 search across all previously browsed pages.\n- add_bookmark(url, title, notes?, tags?): Saves a research bookmark to LanceDB.\n- list_bookmarks(query?, tag?, limit?): Filters saved bookmarks by query terms (title/notes/URL/tags) or exact tag, ranked by relevance; lists recent when query is omitted.\n- delete_bookmark(url_or_id): Removes a bookmark.\n- browsing_history(limit?, domain?): Chronological browsing history.`,
          macros: `### Script Vault & Macro Engine\n- save_script(name, description, code, parameters?): Vaults a reusable DOM script into LanceDB.\n- list_scripts(query?, tag?, limit?): Lists or searches vaulted scripts (query ranks by relevance).\n- run_script(name, args?): Executes vaulted script inside the live tab.\n- delete_script(name): Removes a vaulted script.`,
          network: `### Network & Stream Interception\n- get_network_traffic(url_pattern?, method?, resource_type?, limit?): Inspects HTTP requests/responses (returns compact 1-line markdown summaries).\n- query_json_data({ source:"network_payload", source_id }): raw JSON response body, sliced by path/view.\n- query_json_data(source, source_id?, path?, view?, filter_predicate?, max_items?, max_string_length?): Token-efficient JSON navigator. Extracts nested paths (e.g. "items[0..3].price"), distills schemas, filters arrays, and avoids context blowups. Sources: "network_payload", "stream_messages", "download_file", "inline_json".\n- list_realtime_streams(type?, active_only?): Lists active wss:// WebSockets and SSE streams.\n- Inspect stream frames via query_json_data({ source:"stream_messages", source_id:"<streamId>" }).\n- clear_capture(scope?): Clears captured HTTP traffic ("network"), WS/SSE frames ("streams"), or both ("all", default).`,
          system: `### System Tray & Human-In-The-Loop\n- set_window_visibility(visible?, focus?): Shows/restores the window (and focuses it by default) or hides it to the system tray.\n- configure_system_tray(close_to_tray?): Configures close-to-tray background mode.\n- request_human_intervention(reason, timeout_seconds?, bring_to_front?): Alerts user with desktop notification, HUD banner, and unhides window when login/CAPTCHA is needed.\n- send_notification(title, message, urgency?, sound?): Sends native OS notification.`
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

  // Intercept tools/list to enrich each tool definition for ANY agent framework or chatbot.
  // Deprecated aliases (TOOLS_CATALOG[].hidden) are filtered out of the advertised surface but
  // remain registered, so they can still be invoked by name via tools/call.
  const HIDDEN_TOOLS = new Map(
    TOOLS_CATALOG.filter((t) => t.hidden).map((t) => [t.name, t.deprecatedInFavorOf] as const)
  );
  const rawListHandler = (server as any).server?._requestHandlers?.get?.('tools/list');
  if (rawListHandler) {
    (server as any).server._requestHandlers.set('tools/list', async (request: any, extra: any) => {
      const result = await rawListHandler(request, extra);
      if (result && Array.isArray(result.tools)) {
        const visible = result.tools.filter((t: any) => !HIDDEN_TOOLS.has(t.name));
        result.tools = visible.map((t: any) => {
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
        logMcp(`tools/call: "${request.params.name}" args: ${preview(request.params.arguments)}`);
      }
      const result = await rawCallHandler(request, extra);
      // Nudge callers off deprecated names without breaking them.
      const canonical = HIDDEN_TOOLS.get(request?.params?.name);
      if (canonical && result?.content?.[0]?.type === 'text') {
        logMcp(`[Deprecated] "${request.params.name}" called; canonical is "${canonical}".`);
        result.content[0].text = `⚠ deprecated tool name — use "${canonical}".\n\n${result.content[0].text}`;
      }
      return result;
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

  // Gather any non-protocol top-level properties on params (for flat callers e.g. { name: 'act', mark_id: 1 } or { name: 'act', id: 1 })
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
  logMcp('Initializing Mark Eleven MCP Server over stdio...', 'boot');
  const server = await createBridgeMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logMcp('Connected to stdio transport. Listening for JSON-RPC messages.', 'boot');

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
  logMcp(`Fatal Mark Eleven MCP Server Error: ${err?.stack || err}`, 'error');
  flushLogSync();
  process.exit(1);
});
