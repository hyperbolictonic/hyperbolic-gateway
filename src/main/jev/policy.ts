/**
 * JEV hard-funnel policy.
 *
 * Pure decision logic, kept separate from the primitives so it can be tested
 * without Electron. Only unscoped, unbounded content reads are refused:
 *
 * - an explicit override (`full`) always passes and is counted;
 * - a scoped read (`region`) or a bounded read (`budget > 0`, `cursor`) passes;
 * - `budget: 0` means "the whole construct", so it counts as unbounded;
 * - small pages are exempt (the index would not save anything).
 */

export type FunnelReason =
  | 'not-enforced'
  | 'not-content'
  | 'override'
  | 'region'
  | 'cursor'
  | 'budget'
  | 'small-page'
  | 'unscoped';

export interface FunnelInput {
  enforce: boolean;
  as: string;
  region?: unknown;
  budget?: number;
  cursor?: unknown;
  full?: boolean;
  pageTokens: number;
  /** Pages at or below this size are exempt. */
  minTokens?: number;
}

export interface FunnelDecision {
  allowed: boolean;
  reason: FunnelReason;
}

export const DEFAULT_FUNNEL_MIN_TOKENS = 1500;

const hasValue = (value: unknown): boolean => value !== undefined && value !== null && value !== '';
const isPositiveNumber = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export function decideFunnel(input: FunnelInput): FunnelDecision {
  if (!input.enforce) return { allowed: true, reason: 'not-enforced' };
  if (input.as !== 'markdown' && input.as !== 'text') return { allowed: true, reason: 'not-content' };
  if (input.full === true) return { allowed: true, reason: 'override' };
  if (hasValue(input.region)) return { allowed: true, reason: 'region' };
  if (hasValue(input.cursor)) return { allowed: true, reason: 'cursor' };
  if (isPositiveNumber(input.budget)) return { allowed: true, reason: 'budget' };
  const minTokens = input.minTokens ?? DEFAULT_FUNNEL_MIN_TOKENS;
  if (input.pageTokens > 0 && input.pageTokens <= minTokens) return { allowed: true, reason: 'small-page' };
  return { allowed: false, reason: 'unscoped' };
}

/**
 * Loop breaker: after two refusals for the same URL inside the window, the next
 * read is served instead of refused (and recorded as a bypass). A naive agent
 * should not burn its whole turn budget on a wall.
 */
export class FunnelBreaker {
  private readonly state = new Map<string, { refusals: number; firstAt: number }>();
  private readonly windowMs: number;
  private readonly limit: number;

  constructor(windowMs = 60_000, limit = 2) {
    this.windowMs = windowMs;
    this.limit = limit;
  }

  /** True when this URL has already been refused `limit` times inside the window. */
  shouldRelease(url: string, now: number = Date.now()): boolean {
    const entry = this.state.get(url);
    if (!entry) return false;
    if (now - entry.firstAt > this.windowMs) {
      this.state.delete(url);
      return false;
    }
    return entry.refusals >= this.limit;
  }

  recordRefusal(url: string, now: number = Date.now()): void {
    const entry = this.state.get(url);
    if (!entry || now - entry.firstAt > this.windowMs) {
      this.state.set(url, { refusals: 1, firstAt: now });
      return;
    }
    entry.refusals += 1;
  }

  reset(url?: string): void {
    if (url) this.state.delete(url);
    else this.state.clear();
  }

  snapshot(): Array<{ url: string; refusals: number; firstAt: number }> {
    return [...this.state.entries()].map(([url, entry]) => ({ url, ...entry }));
  }
}
