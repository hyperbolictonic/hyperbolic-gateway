import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpSessionStore, type McpHttpSession } from './session-store.ts';
import type {
  McpHttpHostOptions,
  McpHttpHostStatus,
  McpHttpLogger,
} from './types.ts';

const DEFAULT_MAX_SESSIONS = 4;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_HOST = '127.0.0.1';

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function normalizePath(path: string): string {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : withLeadingSlash;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendRpcError(response: ServerResponse, status: number, code: number, message: string): void {
  sendJson(response, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

function isInitializeMessage(body: unknown): boolean {
  return (
    !!body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    (body as { method?: unknown }).method === 'initialize'
  );
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const declared = Number(headerValue(request.headers['content-length']));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, 'Request body too large');
  }

  return await new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        fail(new HttpError(413, 'Request body too large'));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) {
        reject(new HttpError(400, 'Request body is empty'));
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new HttpError(400, 'Request body is not valid JSON'));
      }
    });
    request.on('error', (error) => fail(error));
  });
}

/**
 * A reusable Streamable HTTP MCP host.
 *
 * It owns the HTTP listener, authentication boundary, session registry, idle
 * expiry, and shutdown. The MCP server factory and auth policy are injected so
 * the same host can serve the browser, REST, or future tool surfaces.
 */
export class McpHttpHost {
  private readonly host: string;
  private readonly path: string;
  private readonly maxSessions: number;
  private readonly maxRequestBodyBytes: number;
  private readonly enableJsonResponse: boolean;
  private readonly allowSse: boolean;
  private readonly sessionIdGenerator: () => string;
  private readonly logger: McpHttpLogger;
  private readonly sessions: McpSessionStore;
  private readonly options: McpHttpHostOptions;
  private server: http.Server | null = null;
  private creatingSessions = 0;

  constructor(options: McpHttpHostOptions) {
    this.options = options;
    this.host = options.host || DEFAULT_HOST;
    this.path = normalizePath(options.path);
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxRequestBodyBytes = options.maxRequestBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.enableJsonResponse = options.enableJsonResponse ?? true;
    this.allowSse = options.allowSse ?? false;
    this.sessionIdGenerator = options.sessionIdGenerator ?? (() => crypto.randomUUID());
    this.logger = options.logger ?? (() => {});
    this.sessions = new McpSessionStore(
      this.maxSessions,
      options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      (session) => this.closeSession(session),
    );
  }

  async start(): Promise<void> {
    if (this.server) throw new Error('MCP HTTP host is already running');
    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.log('request_error', { message });
        sendRpcError(response, 500, -32603, 'Internal server error');
      });
    });
    server.on('clientError', (error, socket) => {
      this.log('client_error', { message: error.message });
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.options.port, this.host);
    });

    this.server = server;
    this.sessions.start();
    server.on('error', (error) => {
      this.log('server_error', { message: error.message });
    });
    this.log('host_started', { host: this.host, port: this.status().port, path: this.path });
  }

  async stop(): Promise<void> {
    this.sessions.stop();
    const sessions = this.sessions.values();
    await Promise.allSettled(sessions.map((session) => this.closeSession(session)));
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    this.log('host_stopped', { host: this.host, port: this.options.port, path: this.path });
  }

  status(): McpHttpHostStatus {
    const address = this.server?.address();
    const port = typeof address === 'object' && address ? address.port : this.options.port;
    return {
      running: Boolean(this.server),
      host: this.host,
      port,
      path: this.path,
      sessions: this.sessions.size,
    };
  }

  private log(event: string, detail?: Record<string, unknown>): void {
    try {
      this.logger(event, detail);
    } catch {
      // A diagnostics sink must never break request or shutdown paths.
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (requestUrl.pathname !== this.path) {
      sendRpcError(response, 404, -32601, 'Not found');
      return;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, { Allow: this.allowedMethods() });
      response.end();
      return;
    }

    if (!this.isAllowedMethod(request.method)) {
      response.setHeader('Allow', this.allowedMethods());
      sendRpcError(response, 405, -32600, 'Method not allowed');
      return;
    }

    const auth = this.options.authorize(request);
    if (!auth) {
      sendRpcError(response, 401, -32001, 'Unauthorized');
      return;
    }
    this.log('request_authorized', { subject: auth.subject, method: request.method, path: this.path });

    try {
      if (request.method === 'POST') {
        await this.handlePost(request, response);
        return;
      }
      if (request.method === 'DELETE') {
        await this.handleDelete(request, response);
        return;
      }
      await this.handleGet(request, response);
    } catch (error) {
      if (error instanceof HttpError) {
        sendRpcError(response, error.status, -32600, error.message);
        return;
      }
      throw error;
    }
  }

  private isAllowedMethod(method: string | undefined): boolean {
    if (method === 'POST' || method === 'DELETE') return true;
    return this.allowSse && method === 'GET';
  }

  private allowedMethods(): string {
    return this.allowSse ? 'GET, POST, DELETE' : 'POST, DELETE';
  }

  private async handlePost(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJsonBody(request, this.maxRequestBodyBytes);
    const sessionId = headerValue(request.headers['mcp-session-id']);
    if (!sessionId) {
      if (!isInitializeMessage(body)) {
        sendRpcError(response, 400, -32600, 'An initialize message is required to create a session');
        return;
      }
      if (this.sessions.size + this.creatingSessions >= this.maxSessions) {
        sendRpcError(response, 429, -32000, 'Too many remote sessions');
        return;
      }

      this.creatingSessions++;
      let session: McpHttpSession | undefined;
      try {
        session = await this.createSession();
        await session.transport.handleRequest(request, response, body);
        if (!session.id) throw new Error('MCP session was not initialized');
        this.sessions.touch(session);
      } catch (error) {
        if (session) await this.closeSession(session);
        throw error;
      } finally {
        this.creatingSessions--;
      }
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      sendRpcError(response, 404, -32001, 'Unknown or expired session');
      return;
    }
    this.sessions.touch(session);
    await session.transport.handleRequest(request, response, body);
  }

  private async handleDelete(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const sessionId = headerValue(request.headers['mcp-session-id']);
    if (!sessionId) {
      sendRpcError(response, 400, -32600, 'Mcp-Session-Id is required');
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      sendRpcError(response, 404, -32001, 'Unknown or expired session');
      return;
    }
    await session.transport.handleRequest(request, response);
    await this.closeSession(session);
  }

  private async handleGet(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const sessionId = headerValue(request.headers['mcp-session-id']);
    if (!sessionId) {
      sendRpcError(response, 400, -32600, 'Mcp-Session-Id is required');
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      sendRpcError(response, 404, -32001, 'Unknown or expired session');
      return;
    }
    this.sessions.touch(session);
    await session.transport.handleRequest(request, response);
  }

  private async createSession(): Promise<McpHttpSession> {
    let session: McpHttpSession | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: this.sessionIdGenerator,
      enableJsonResponse: this.enableJsonResponse,
      maxRequestBodySize: this.maxRequestBodyBytes,
      onsessioninitialized: (sessionId) => {
        if (!session) {
          this.log('session_init_without_owner', { sessionId });
          return;
        }
        session.id = sessionId;
        this.sessions.add(session);
        this.options.onSessionOpen?.(sessionId);
        this.log('session_opened', { sessionId });
      },
      onsessionclosed: (sessionId) => {
        this.sessions.remove(sessionId);
        this.log('session_closed_by_client', { sessionId });
      },
    });
    transport.onerror = (error) => {
      this.log('transport_error', { message: error.message, sessionId: session?.id || null });
    };
    transport.onclose = () => {
      if (session && !session.closed) {
        void this.closeSession(session);
        return;
      }
      if (session?.id) this.sessions.remove(session.id);
    };

    const server: McpServer = await this.options.createServer();
    session = {
      id: '',
      server,
      transport,
      lastUsedAt: Date.now(),
      closed: false,
    };
    try {
      await server.connect(transport);
    } catch (error) {
      await this.closeSession(session);
      throw error;
    }
    return session;
  }

  private async closeSession(session: McpHttpSession): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    if (session.id) this.sessions.remove(session.id);
    try {
      await session.transport.close();
    } catch (error) {
      this.log('transport_close_error', {
        sessionId: session.id || null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      await session.server.close();
    } catch (error) {
      this.log('server_close_error', {
        sessionId: session.id || null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (session.id) {
      this.options.onSessionClose?.(session.id);
      this.log('session_closed', { sessionId: session.id });
    }
  }
}

export function createMcpHttpHost(options: McpHttpHostOptions): McpHttpHost {
  return new McpHttpHost(options);
}
