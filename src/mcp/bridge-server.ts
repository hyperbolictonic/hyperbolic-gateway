import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBridgeMcpServer, normalizeIncomingParams, logMcp, flushLogSync } from './browser-mcp.js';

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

async function start() {
  logMcp('Initializing Hyperbolic Browser MCP Server over stdio...', 'boot');
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
  logMcp(`Fatal Hyperbolic Browser MCP Server Error: ${err?.stack || err}`, 'error');
  flushLogSync();
  process.exit(1);
});
