import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type McpHttpExtraHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => boolean | Promise<boolean>;

/** The identity attached to a successful remote request. */
export interface McpHttpAuth {
  /** Opaque, non-secret subject label for logs and future policy. */
  subject: string;
}

export type McpHttpAuthorize = (request: IncomingMessage) => McpHttpAuth | null;

export type McpHttpLogger = (event: string, detail?: Record<string, unknown>) => void;

export interface McpHttpHostOptions {
  /** Loopback address to bind. Default 127.0.0.1. */
  host?: string;
  /** Port to bind. Use 0 in tests to get an ephemeral port. */
  port: number;
  /** Exact MCP path, for example /mcp/browser. */
  path: string;
  /** Create one stateless MCP server per initialized session. */
  createServer: () => McpServer | Promise<McpServer>;
  /** Required auth check, run before session creation and body parsing. */
  authorize: McpHttpAuthorize;
  /** Handle metadata/OAuth/application routes before the MCP path check. */
  handleExtraRequest?: McpHttpExtraHandler;
  /** Optional WWW-Authenticate value for a 401 response. */
  authChallenge?: (request: IncomingMessage) => string | undefined;
  /** Return direct JSON responses instead of SSE for POSTs. Default true. */
  enableJsonResponse?: boolean;
  /** Allow GET SSE streams. Default false. */
  allowSse?: boolean;
  /**
   * Create a fresh server and transport per POST with no Mcp-Session-Id.
   * This removes session caps/expiry at the cost of no per-session MCP state.
   */
  stateless?: boolean;
  /** Maximum concurrent sessions in stateful mode. Default 8. */
  maxSessions?: number;
  /** Idle session lifetime. Default 15 minutes. */
  idleTimeoutMs?: number;
  /** How long a session must be idle before it can be evicted at capacity. Default 30 seconds. */
  sessionEvictionGraceMs?: number;
  /** Maximum POST body. Default 1 MiB. */
  maxRequestBodyBytes?: number;
  /** Override session-id generation for focused tests. */
  sessionIdGenerator?: () => string;
  onSessionOpen?: (sessionId: string) => void;
  onSessionClose?: (sessionId: string) => void;
  logger?: McpHttpLogger;
}

export interface McpHttpHostStatus {
  running: boolean;
  host: string;
  port: number;
  path: string;
  sessions: number;
}
