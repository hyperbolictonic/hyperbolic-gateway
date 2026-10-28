import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface McpHttpSession {
  id: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastUsedAt: number;
  closed: boolean;
}

/**
 * Bounded in-memory session registry.
 *
 * The host owns close semantics; this class only decides which sessions are
 * live and which have exceeded their idle limit.
 */
export class McpSessionStore {
  private readonly sessions = new Map<string, McpHttpSession>();
  private readonly maxSessions: number;
  private readonly idleTimeoutMs: number;
  private readonly onExpire: (session: McpHttpSession) => Promise<void>;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    maxSessions: number,
    idleTimeoutMs: number,
    onExpire: (session: McpHttpSession) => Promise<void>,
  ) {
    if (!Number.isInteger(maxSessions) || maxSessions < 1) {
      throw new Error('maxSessions must be a positive integer');
    }
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 1) {
      throw new Error('idleTimeoutMs must be a positive number');
    }
    this.maxSessions = maxSessions;
    this.idleTimeoutMs = idleTimeoutMs;
    this.onExpire = onExpire;
  }

  get size(): number {
    return this.sessions.size;
  }

  get(id: string): McpHttpSession | undefined {
    return this.sessions.get(id);
  }

  add(session: McpHttpSession): void {
    if (!session.id) throw new Error('cannot register a session without an id');
    if (this.sessions.size >= this.maxSessions) {
      throw new Error('session limit reached');
    }
    this.sessions.set(session.id, session);
  }

  touch(session: McpHttpSession, now = Date.now()): void {
    session.lastUsedAt = now;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  /** Testable deterministic sweep. Expired sessions are removed before closing. */
  sweep(now = Date.now()): void {
    for (const [id, session] of this.sessions) {
      if (session.closed) {
        this.sessions.delete(id);
        continue;
      }
      if (now - session.lastUsedAt <= this.idleTimeoutMs) continue;
      this.sessions.delete(id);
      void this.onExpire(session).catch(() => {
        // The host logger owns reporting; expiry must never throw into the timer.
      });
    }
  }

  start(): void {
    if (this.timer) return;
    const interval = Math.max(1000, Math.min(30_000, Math.floor(this.idleTimeoutMs / 2)));
    this.timer = setInterval(() => this.sweep(), interval);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  values(): McpHttpSession[] {
    return [...this.sessions.values()];
  }
}
