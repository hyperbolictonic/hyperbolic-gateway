/**
 * The wrapper surface every executor implements.
 *
 * `WrapBridge`, the IPC layer and the MCP server see this shape, not a concrete
 * class, so a second core can be introduced behind the same contract.
 */

import type { WrapFormat, WrapRunResult } from './types.ts';
import type { WrapStore } from './store.ts';

export interface WrapRunOptions {
  format?: WrapFormat;
  includeRaw?: boolean;
  maxPages?: number;
}

export interface WrapTestInput {
  id?: string;
  wrapper?: unknown;
  args?: unknown;
  sample?: unknown;
  dryRun?: boolean;
  format?: WrapFormat;
  maxPages?: number;
  includeRaw?: boolean;
}

export interface WrapCore {
  readonly store: WrapStore;
  status(): { wrappers: number; allowPrivateHosts: boolean };
  run(id: string, args: unknown, options?: WrapRunOptions): Promise<WrapRunResult>;
  preview(id: string, args: unknown): Promise<WrapRunResult>;
  test(input: WrapTestInput): Promise<WrapRunResult>;
}
