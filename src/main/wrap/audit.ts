/**
 * Redacted, append-only audit trail for outbound wrapper calls.
 *
 * It records what an operator needs to debug a wrapper — wrapper id, method,
 * host, status, bytes, duration, error code — and never headers, bodies, query
 * strings, or secret values.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface WrapAuditEntry {
  at: string;
  wrapper: string;
  host: string;
  method: string;
  status?: number;
  ok: boolean;
  bytes?: number;
  durationMs?: number;
  code?: string;
}

export class WrapAuditLog {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  append(entry: Omit<WrapAuditEntry, 'at'>): void {
    const row: WrapAuditEntry = { at: new Date().toISOString(), ...entry };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Best effort: an audit write must never fail a request.
    }
  }

  list(limit = 50): WrapAuditEntry[] {
    const count = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.floor(limit))) : 50;
    try {
      const lines = fs.readFileSync(this.file, 'utf8').split(/\r?\n/).filter(Boolean);
      return lines
        .slice(-count)
        .map((line) => {
          try {
            return JSON.parse(line) as WrapAuditEntry;
          } catch {
            return undefined;
          }
        })
        .filter((entry): entry is WrapAuditEntry => Boolean(entry));
    } catch {
      return [];
    }
  }
}
