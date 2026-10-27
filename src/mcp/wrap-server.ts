/**
 * Hyperbolic Rest — a second stdio MCP server for saved REST wrappers.
 *
 * It is deliberately stateless: every tool call becomes one HTTP request to the
 * Cyberdeck bridge, which owns the wrapper store and the outbound policy. That
 * keeps the MCP process free of secrets, file paths, and browser lifecycle.
 *
 * Agent surface:
 *   wrap_list / wrap_get          what exists
 *   wrap_derive                   infer a first-draft recipe from a sample or URL
 *   wrap_create / wrap_update     save a deterministic request + recipe
 *   wrap_run                      execute with flat semantic arguments
 *   wrap_test                     dry-run or render a sample, without sending
 *   wrap_delete                   remove a wrapper
 *   wrap_reload                   re-read the manifest (compatibility alias)
 *
 * A wrapper with `exposeAsTool: true` also gets a generated `wrap_<id>` tool with its
 * declared arguments (S4), capped at 40 and refreshed with `tools/list_changed` whenever
 * the wrapper set changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { APP_VERSION } from '../shared/version.js';
import { generatedToolName, wrapInputToZodShape } from './wrap-tool-schema.js';

const BRIDGE_URL = (process.env.HB_BRIDGE_URL || process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111').replace(/\/$/, '');
const BRIDGE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.HB_WRAP_TIMEOUT_MS ?? process.env.KUANG_WRAP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 90_000;
})();
const TOKEN_FILE = process.env.HB_WRAP_TOKEN_FILE || process.env.HB_WRAP_TOKEN_FILE || '';
const STATIC_TOKEN =
  process.env.HB_WRAP_TOKEN ||
  process.env.KUANG_WRAP_TOKEN ||
  process.env.HB_BRIDGE_TOKEN ||
  process.env.KUANG_BRIDGE_TOKEN ||
  '';

/**
 * How many generated `wrap_<id>` tools may be registered at once. This is a model-context
 * budget, not an MCP limit (the protocol has no tool cap). `HB_WRAP_MAX_TOOLS=0` disables
 * generated tools entirely; the ten meta-tools keep working.
 */
const GENERATED_TOOL_CAP = (() => {
  const raw = Number(process.env.HB_WRAP_MAX_TOOLS ?? process.env.HB_WRAP_MAX_TOOLS);
  if (!Number.isFinite(raw) || raw < 0) return 40;
  return Math.min(Math.floor(raw), 200);
})();

/** Names the static meta-tools own; a generated name must never collide with one. */
const META_TOOL_NAMES: readonly string[] = [
  'wrap_list',
  'wrap_get',
  'wrap_derive',
  'wrap_secret_list',
  'wrap_create',
  'wrap_update',
  'wrap_delete',
  'wrap_run',
  'wrap_test',
  'wrap_reload',
];

function currentWrapToken(): string {
  if (STATIC_TOKEN) return STATIC_TOKEN.trim();
  if (!TOKEN_FILE) return '';
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

// --- Diagnostics policy -----------------------------------------------------
// stdout is the JSON-RPC lifeline. Diagnostics go to a file; stderr gets a
// short boot banner only. A client that never drains stderr must not be able
// to wedge the server.
const LOG_TO_FILE = (process.env.HB_MCP_LOG ?? process.env.KUANG_MCP_LOG) !== '0';
const STDERR_MODE: 'off' | 'boot' =
  (process.env.HB_MCP_STDERR ?? process.env.KUANG_MCP_STDERR) === '0' ||
  (process.env.HB_WRAP_STDERR ?? process.env.KUANG_WRAP_STDERR) === '0'
    ? 'off'
    : 'boot';
const LOG_DIR = path.resolve(process.cwd(), 'data', 'logs');
let logDirReady = false;
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logDirReady = true;
} catch {
  // Best effort.
}

let stderrBytes = 0;
function writeStderr(text: string): void {
  if (STDERR_MODE === 'off' || stderrBytes >= 8 * 1024) return;
  const chunk = text.endsWith('\n') ? text : `${text}\n`;
  try {
    stderrBytes += Buffer.byteLength(chunk);
    process.stderr.write(chunk);
  } catch {
    // Never let logging throw.
  }
}

function logWrap(message: string, level: 'boot' | 'call' | 'error' = 'call'): void {
  const timestamp = new Date().toISOString();
  if (LOG_TO_FILE && logDirReady) {
    fs.appendFile(path.join(LOG_DIR, 'wrap-server.log'), `[${timestamp}] ${message}\n`, () => {
      // Best effort.
    });
  }
  if (STDERR_MODE === 'boot' && level !== 'call') {
    writeStderr(`[Hyperbolic Rest ${timestamp}] ${message}`);
  }
}

let stdoutClosed = false;
process.stdout.on('error', (err: any) => {
  if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') {
    if (!stdoutClosed) {
      stdoutClosed = true;
      logWrap('stdout pipe closed by client (EPIPE); shutting down cleanly.', 'boot');
    }
    process.exit(0);
  }
  logWrap(`stdout stream error: ${err?.message || err}`, 'error');
});
process.stderr.on('error', () => {
  // Never let logging throw.
});

let shuttingDown = false;
function shutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logWrap(reason, 'boot');
  process.exit(0);
}
process.stdin.on('end', () => shutdown('stdin closed by client; shutting down cleanly.'));
process.stdin.on('close', () => shutdown('stdin stream closed; shutting down cleanly.'));

process.on('unhandledRejection', (reason: any) => {
  logWrap(`Unhandled promise rejection (server kept alive): ${reason?.stack || reason}`, 'error');
});
process.on('uncaughtException', (err: any) => {
  logWrap(`Uncaught exception (server kept alive): ${err?.stack || err}`, 'error');
});

const MAX_TEXT_CHARS = 60_000;
function clampText(text: string): string {
  if (typeof text !== 'string' || text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n... [Hyperbolic Rest: response truncated at ${MAX_TEXT_CHARS} chars. Use format "json" with a narrower path or a recipe cap.]`;
}

interface BridgeResponse {
  ok: boolean;
  status: number;
  data: any;
}

async function callBridge(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<BridgeResponse> {
  const token = currentWrapToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
  };
  if (body !== undefined && method === 'POST') init.body = JSON.stringify(body);

  let response: Response;
  try {
    response = await fetch(`${BRIDGE_URL}${endpoint}`, init);
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`Bridge request timed out after ${BRIDGE_TIMEOUT_MS} ms (${method} ${endpoint}).`);
    }
    throw new Error(`Cannot reach the Cyberdeck bridge at ${BRIDGE_URL}. Is the app running? (${err?.message || err})`);
  }

  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 1_000), code: 'BAD_RESPONSE' };
    }
  }

  if (response.status === 401) {
    throw new Error(
      token
        ? 'The Cyberdeck rejected the Hyperbolic Rest bridge token. An app restart rotates it; restart the MCP client or update HB_WRAP_TOKEN_FILE.'
        : 'Hyperbolic Rest needs a bridge token. Add HB_WRAP_TOKEN_FILE to this server’s config (Settings → MCP Clients → REST wrappers).',
    );
  }

  return { ok: response.ok, status: response.status, data };
}

function asObject(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function asJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function lines(items: string[]): string {
  return items.filter(Boolean).join('\n');
}

function errorText(code: string | undefined, message: string | undefined): string {
  return `**${code || 'ERROR'}:** ${message || 'The wrapper request failed.'}`;
}

function resultText(data: any, format: 'markdown' | 'json' | 'both'): string {
  if (!data || data.ok === false) {
    const base = errorText(data?.error?.code, data?.error?.message);
    return data?.markdown && !data.markdown.startsWith('**') ? `${base}\n\n${data.markdown}` : base;
  }

  if (data.dryRun) return previewText(data);

  const markdown = typeof data.markdown === 'string' ? data.markdown : '';
  const records = Array.isArray(data.records) ? data.records : [];
  const json = JSON.stringify(records, null, 2);

  if (format === 'json') return json;
  if (format === 'both') return `${markdown}\n\n### Records\n\n\`\`\`json\n${json}\n\`\`\``;

  const footer = data.status
    ? `\n\n_${[
        `HTTP ${data.status}`,
        formatBytes(data.response?.bytes),
        `${data.durationMs ?? 0} ms`,
        ...(data.paging
          ? [`pages ${data.paging.pages}/${data.paging.cap}${data.paging.more ? ' (+more)' : ''}`]
          : []),
        ...(data.indexed
          ? [
              data.indexed.error
                ? `index failed: ${data.indexed.error}`
                : `indexed ${data.indexed.documents} doc${data.indexed.documents === 1 ? '' : 's'}`,
            ]
          : []),
      ].join(' · ')}_`
    : '';
  return `${markdown}${footer}`.trim();
}

function previewText(data: any): string {
  const request = data?.request;
  if (!request) return data?.markdown || '_Dry run — request not sent._';

  const requestLines = [
    `${request.method} ${request.url}`,
    ...Object.entries(request.headers || {}).map(([key, value]) => `${key}: ${value}`),
  ];

  if (typeof request.body === 'string' && request.body) {
    requestLines.push('', prettyMaybeJson(request.body));
  }

  return ['**Dry run** — nothing was sent.', '', '```http', ...requestLines, '```'].join('\n');
}

function prettyMaybeJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function formatBytes(bytes: number | undefined): string {
  if (!Number.isFinite(bytes) || bytes === undefined) return '0 B';
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} kB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatManifest(data: any, cap: number = GENERATED_TOOL_CAP): string {
  const wrappers = Array.isArray(data?.wrappers) ? data.wrappers : [];
  if (wrappers.length === 0) {
    return 'No wrappers saved. Use wrap_create with id, request, inputSchema, and response.';
  }

  // Same deterministic rule the registry uses: exposed wrappers sorted by id, first `cap`.
  const exposedIds = new Set(
    wrappers
      .filter((wrapper: any) => wrapper?.exposeAsTool === true)
      .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))
      .slice(0, cap)
      .map((wrapper: any) => String(wrapper.id)),
  );

  const rows = wrappers.map((wrapper: any) => {
    const required = Array.isArray(wrapper.required) && wrapper.required.length > 0
      ? ` · required: ${wrapper.required.join(', ')}`
      : '';
    const secret = wrapper.secret ? ` · secret: ${wrapper.secret}` : '';
    let tool = '';
    if (wrapper.exposeAsTool) {
      tool = cap === 0
        ? ' · tool (disabled: HB_WRAP_MAX_TOOLS=0)'
        : exposedIds.has(String(wrapper.id))
          ? ' · tool'
          : ' · tool (over cap: call wrap_run)';
    }
    const verified = wrapper.lastVerified ? ` · verified ${String(wrapper.lastVerified).slice(0, 10)}` : ' · never verified';
    const methods = Array.isArray(wrapper.methods) && wrapper.methods.length ? wrapper.methods.join('/') : wrapper.method;
    return `${wrapper.id} — ${wrapper.name} (${methods} ${wrapper.host}${wrapper.mutating ? ', mutating' : ''})${required}${secret}${tool}${verified}`;
  });

  const header = `### Wrappers (${wrappers.length}) · generated ${exposedIds.size}/${cap}`;
  return `${header}\n${lines(rows)}`;
}

/**
 * Explain why a saved wrapper with `exposeAsTool: true` is not a registered tool. Empty when
 * it is registered, or when the wrapper did not ask to be.
 */
function generatedWarning(wrapper: any, sync: { cap: number; exposed: string[] }): string {
  if (wrapper?.exposeAsTool !== true) return '';
  const id = String(wrapper.id || '');
  if (sync.exposed.includes(id)) return '';

  if (sync.cap === 0) {
    return `\n\n⚠ ${id} is not registered as a generated tool: HB_WRAP_MAX_TOOLS=0 disables generated tools. Call it with wrap_run, or raise the cap.`;
  }
  return `\n\n⚠ ${id} is not registered as a generated tool: the ${sync.cap}-tool cap is full (the first ${sync.cap} exposed wrappers by id win). Call it with wrap_run, or set HB_WRAP_MAX_TOOLS higher.`;
}

function formatSecrets(data: any): string {
  const secrets = Array.isArray(data?.secrets) ? data.secrets : [];
  const warning = typeof data?.warning === 'string' && data.warning ? `\n\n_${data.warning}_` : '';
  if (secrets.length === 0) {
    return `No secrets saved. A human can add one in Settings → Wrappers.${warning}`;
  }
  return lines(
    secrets.map((secret: any) => {
      const hosts = Array.isArray(secret.allowedHosts) ? secret.allowedHosts.join(', ') : '';
      const kind = secret.kind === 'oauth2' ? 'oauth2 · ' : '';
      return `${secret.name} · ${kind}${secret.header} · ${hosts}`;
    }),
  ) + warning;
}

function toolSuccess(text: string) {
  return { content: [{ type: 'text' as const, text: clampText(text) }] };
}

function toolError(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text: clampText(text) }] };
}

function bridgeFailure(err: any) {
  logWrap(`Bridge error: ${err?.message || err}`, 'error');
  return toolError(`[Hyperbolic Rest] ${err?.message || err}`);
}

export async function createWrapMcpServer() {
  const server = new McpServer({
    name: 'hb-rest',
    version: APP_VERSION,
  });

  /** Generated `wrap_<id>` tools, keyed by the registered tool name. */
  const generated = new Map<string, { remove(): void }>();

  /**
   * Reconcile the generated tool set with the manifest: register `wrap_<id>` for every
   * wrapper with `exposeAsTool: true` (first 40 by id), remove the ones that no longer
   * qualify. Returns how many were added/removed so callers can decide to notify.
   */
  async function refreshGeneratedTools(): Promise<{
    added: number;
    removed: number;
    cap: number;
    exposed: string[];
  }> {
    const unavailable = { added: 0, removed: 0, cap: GENERATED_TOOL_CAP, exposed: [] as string[] };

    let manifest: any;
    try {
      const response = await callBridge('/wrap/manifest');
      if (!response.ok) return unavailable;
      manifest = response.data;
    } catch {
      return unavailable;
    }

    const exposed = (Array.isArray(manifest?.wrappers) ? manifest.wrappers : [])
      .filter((entry: any) => entry?.exposeAsTool === true)
      .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))
      .slice(0, GENERATED_TOOL_CAP);

    const exposedIds = exposed.map((entry: any) => String(entry.id));

    const wanted = new Set<string>();
    let added = 0;

    for (const entry of exposed) {
      const detail = await callBridge(`/wrap/wrapper?id=${encodeURIComponent(String(entry.id))}`).catch(() => null);
      const wrapper = detail?.data?.wrapper;
      if (!wrapper) continue;

      const name = generatedToolName(String(entry.id), new Set([...META_TOOL_NAMES, ...wanted]));
      wanted.add(name);
      if (generated.has(name)) continue;

      const description =
        `[wrap] ${entry.name || entry.id} — ${entry.method} ${entry.host}. ` +
        `${entry.description ? entry.description + ' ' : ''}` +
        'Typed shortcut for wrap_run; the saved request supplies the URL, headers, auth and body.';
      const tool = server.registerTool(
        name,
        { description, inputSchema: wrapInputToZodShape(wrapper.inputSchema) },
        async (args: any) => {
          try {
            const response = await callBridge('/wrap/run', 'POST', {
              id: entry.id,
              args: args || {},
              format: 'markdown',
            });
            const data = response.data;
            if (!data) return toolError(`No response from the wrapper bridge (HTTP ${response.status}).`);
            const text = resultText(data, 'markdown');
            return data.ok === false ? toolError(text) : toolSuccess(text);
          } catch (err: any) {
            return bridgeFailure(err);
          }
        },
      );
      generated.set(name, tool);
      added++;
    }

    let removed = 0;
    for (const [name, tool] of generated) {
      if (wanted.has(name)) continue;
      try {
        tool.remove();
      } catch {
        /* already gone */
      }
      generated.delete(name);
      removed++;
    }

    return { added, removed, cap: GENERATED_TOOL_CAP, exposed: exposedIds };
  }

  // The SDK emits `tools/list_changed` itself on registerTool()/remove(), so no explicit
  // notification is needed after a refresh.

  server.tool(
    'wrap_list',
    'List saved REST wrappers as one line each: id, purpose, method/host, required arguments. Call this before wrap_get or wrap_run.',
    {},
    async () => {
      try {
        const response = await callBridge('/wrap/manifest');
        if (!response.ok) return toolError(errorText(response.data?.code, response.data?.error || `HTTP ${response.status}`));
        return toolSuccess(formatManifest(response.data));
      } catch (err: any) {
        return bridgeFailure(err);
      }
    },
  );

  server.tool(
    'wrap_get',
    'Show one wrapper in full: input schema, request template, and response recipe. Use wrap_list to discover ids.',
    { id: z.string().describe('Wrapper id, for example "orders.create"') },
    async ({ id }) => {
      try {
        const response = await callBridge(`/wrap/wrapper?id=${encodeURIComponent(id)}`);
        if (!response.ok || !response.data?.wrapper) {
          return toolError(errorText(response.data?.code, response.data?.error || `No wrapper named "${id}".`));
        }
        return toolSuccess(JSON.stringify(response.data.wrapper, null, 2));
      } catch (err: any) {
        return bridgeFailure(err);
      }
    },
  );

  server.tool(
    'wrap_secret_list',
    'List credential names a human has bound to hosts. Values are never available to this server. Use a name in request.auth; the main process attaches it only when the request host is allowed.',
    {},
    async () => {
      try {
        const response = await callBridge('/wrap/secrets');
        if (!response.ok) return toolError(errorText(response.data?.code, response.data?.error || `HTTP ${response.status}`));
        return toolSuccess(formatSecrets(response.data));
      } catch (err: any) {
        return bridgeFailure(err);
      }
    },
  );

  server.tool(
    'wrap_derive',
    'Derive a first-draft response recipe from a JSON sample (an object, an array, or a JSON string) or from a live URL. Returns a recipe you can drop into wrap_create/wrap_update as `response`. It reads the shape only — primitive fields, a table for arrays, a document for objects — so edit it afterwards if you need nested or formatted fields.',
    {
      sample: z.unknown().optional().describe('A JSON sample: an object, an array, or a JSON string'),
      url: z.string().optional().describe('Fetch this URL with a policy-checked GET and derive from its JSON (ignored when sample is given)'),
      id: z.string().optional().describe('Optional recipe id'),
      name: z.string().optional().describe('Optional recipe name'),
      description: z.string().optional(),
      max_fields: z.coerce.number().optional().describe('Maximum fields to infer (default 12, max 60)'),
    },
    async ({ sample, url, id, name, description, max_fields }) => {
      try {
        const response = await callBridge('/wrap/derive', 'POST', {
          sample,
          url,
          id,
          name,
          description,
          max_fields,
        });
        if (!response.ok || response.data?.success === false) {
          return toolError(errorText(response.data?.code, response.data?.error || `HTTP ${response.status}`));
        }
        const recipe = response.data.recipe;
        return toolSuccess(
          `## Derived recipe (from ${response.data.source})\n\n\`\`\`json\n${JSON.stringify(recipe, null, 2)}\n\`\`\`\n\n` +
            'Pass this as `response` to wrap_create (or wrap_update), then wrap_test it against a real call.',
        );
      } catch (err: any) {
        return bridgeFailure(err);
      }
    },
  );

  server.tool(
    'wrap_create',
    'Save a new REST wrapper. Supply the complete wrapper object: id, name, request (method, url, optional query/headers/body templates, optional auth secret name), inputSchema (game-facing arguments), and response (recipe). Never include a credential value; request.auth is a name only, and only a human can create it. Set `exposeAsTool: true` to register a generated `wrap_<id>` tool (capped by HB_WRAP_MAX_TOOLS, default 40).',
    {
      wrapper: z.record(z.string(), z.unknown()).describe('Complete wrapper object. Use flat input arguments, not URL or header JSON.'),
    },
    async ({ wrapper }) => {
      try {
        const response = await callBridge('/wrap/wrappers', 'POST', { action: 'create', wrapper: asObject(wrapper) });
        if (!response.data?.success) {
          const errors = Array.isArray(response.data?.errors) ? response.data.errors : [response.data?.error || `HTTP ${response.status}`];
          return toolError(`Wrapper rejected:\n- ${errors.join('\n- ')}`);
        }
        const saved = response.data.wrapper;
        const sync = await refreshGeneratedTools();
        return toolSuccess(
          `Created ${saved?.id}. Call wrap_test with dryRun first, then wrap_run.${generatedWarning(saved, sync)}`,
        );
      } catch (err: any) {
        return bridgeFailure(err);
      }
    },
  );

  server.tool(
    'wrap_update',
    'Replace an existing wrapper. Use the same complete object as wrap_create; the id identifies which wrapper to replace.',
    {
      wrapper: z.record(z.string(), z.unknown()).describe('Complete replacement wrapper object.'),
    },
    async ({ wrapper }) => {
      try {
        const response = await callBridge('/wrap/wrappers', 'POST', { action: 'update', wrapper: asObject(wrapper) });
        if (!response.data?.success) {
          const errors = Array.isArray(response.data?.errors) ? response.data.errors : [response.data?.error || `HTTP ${response.status}`];
          return toolError(`Wrapper rejected:\n- ${errors.join('\n- ')}`);
        }
        const sync = await refreshGeneratedTools();
        const updated = response.data.wrapper;
        return toolSuccess(
          `Updated ${updated?.id}. Run wrap_test with dryRun to verify the change.${generatedWarning(updated, sync)}`,
        );
      } catch (err: any) {
        return bridgeFailure(err);
      }
    },
  );

  server.tool(
    'wrap_delete',
    'Delete a saved wrapper by id. This removes the saved request and recipe; it does not affect the remote API.',
    { id: z.string().describe('Wrapper id to delete') },
    async ({ id }) => {
      try {
        const response = await callBridge('/wrap/wrappers', 'POST', { action: 'delete', id });
        if (!response.data?.success) {
          return toolError(errorText(response.data?.code, response.data?.error || `No wrapper named "${id}".`));
        }
        await refreshGeneratedTools();
        return toolSuccess(`Deleted ${id}.`);
      } catch (err: any) {
        return bridgeFailure(err);
      }
    },
  );

  server.tool(
    'wrap_run',
    'Execute a saved wrapper with flat semantic arguments. The saved request supplies the URL, headers, auth, and body shape; pass only the arguments declared by wrap_get. Returns readable Markdown and structured records. When the recipe declares pagination, the executor follows pages up to a cap and merges them into one result (the footer reports pages used); pass max_pages to widen or narrow it.',
    {
      id: z.string().describe('Wrapper id from wrap_list'),
      args: z.record(z.string(), z.unknown()).optional().describe('Flat arguments matching the wrapper inputSchema'),
      format: z.enum(['markdown', 'json', 'both']).optional().describe('markdown (default), json records, or both'),
      max_pages: z.coerce.number().optional().describe('Page cap for a paginated recipe (default 10, max 25)'),
    },
    async ({ id, args, format, max_pages }) => {
      try {
        const response = await callBridge('/wrap/run', 'POST', {
          id,
          args: asObject(args || {}) || {},
          format: format || 'markdown',
          maxPages: max_pages,
        });
        const data = response.data;
        if (!data) return toolError(`No response from the wrapper bridge (HTTP ${response.status}).`);

        const text = resultText(data, format || 'markdown');
        return data.ok === false ? toolError(text) : toolSuccess(text);
      } catch (err: any) {
        return bridgeFailure(err);
      }
    },
  );

  server.tool(
    'wrap_test',
    'Verify a wrapper without sending a live request. Dry-run previews the exact method, URL, headers, and body. Pass sample (a JSON response body) to check the recipe rendering instead. Defaults to dryRun.',
    {
      id: z.string().optional().describe('Saved wrapper id'),
      wrapper: z.record(z.string(), z.unknown()).optional().describe('Unsaved wrapper object to test'),
      args: z.record(z.string(), z.unknown()).optional().describe('Arguments for the dry-run request'),
      sample: z.unknown().optional().describe('Sample JSON response to render through the recipe'),
      dryRun: z.boolean().optional().describe('Preview only; defaults to true'),
    },
    async ({ id, wrapper, args, sample, dryRun }) => {
      try {
        const payload: Record<string, unknown> = {
          id,
          args: asObject(args || {}) || {},
          dryRun: dryRun !== false,
        };
        if (wrapper !== undefined) payload.wrapper = asObject(wrapper);
        if (sample !== undefined) payload.sample = asJson(sample);

        const response = await callBridge('/wrap/test', 'POST', payload);
        const data = response.data;
        if (!data) return toolError(`No response from the wrapper bridge (HTTP ${response.status}).`);

        const text = resultText(data, 'markdown');
        return data.ok === false ? toolError(text) : toolSuccess(text);
      } catch (err: any) {
        return bridgeFailure(err);
      }
    },
  );

  server.tool(
    'wrap_reload',
    'Re-read the wrapper manifest. The server is stateless, so this is mainly a compatibility alias for wrap_list after an external file change.',
    {},
    async () => {
      try {
        const response = await callBridge('/wrap/manifest');
        if (!response.ok) return toolError(errorText(response.data?.code, response.data?.error || `HTTP ${response.status}`));
        await refreshGeneratedTools();
        return toolSuccess(formatManifest(response.data));
      } catch (err: any) {
        return bridgeFailure(err);
      }
    },
  );

  // Register the generated tools that already qualify (S4). Best-effort: a missing
  // bridge just means no generated tools until the next wrapper mutation.
  await refreshGeneratedTools();

  return server;
}

async function start() {
  logWrap('Initializing Hyperbolic Rest MCP Server over stdio...', 'boot');
  const server = await createWrapMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logWrap('Connected to stdio transport. Listening for JSON-RPC messages.', 'boot');
}

start().catch((err) => {
  logWrap(`Fatal Hyperbolic Rest MCP Server Error: ${err?.stack || err}`, 'error');
  process.exit(1);
});
