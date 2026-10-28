import type { IncomingMessage } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
  /** Return direct JSON responses instead of SSE for POSTs. Default true. */
  enableJsonResponse?: boolean;
  /** Allow GET SSE streams. Default false, and required for Quick Tunnel mode. */
  allowSse?: boolean;
  /** Maximum concurrent sessions. Default 4. */
  maxSessions?: number;
  /** Idle session lifetime. Default 15 minutes. */
  idleTimeoutMs?: number;
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
