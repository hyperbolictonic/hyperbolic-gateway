import type { WebContents } from 'electron';
import type { HarvestedConstruct } from '../../shared/types.js';
import { APP_VERSION } from '../../shared/version.js';
import type { MarkItem } from '../marks/marks-overlay.js';
import type { TransitionRecord, FieldFacts, TypingOutcome, TypingChannel } from '../telemetry/action-ledger.js';
import {
  targetBoxScript,
  fieldFactsScript,
  diagnosticsScript,
  inputProbeInstallScript,
  inputProbeReadScript,
  type TargetBox,
  type TargetLocator,
} from './dom-targeting.js';
import { detectSensitiveGate } from '../decide/sensitive-gate.js';
import { controlFactsExpression, parseControlFacts } from './control-facts.js';
import { textTargetExpression, parseTextTargets } from './text-target.js';
import type { SealedControl, SealedFindOptions, SealedFindResult } from '../shadow-walk/ax-controls.js';

/**
 * Primitives — the orthogonal observe / act / wait layer.
 *
 * These sit *above* the raw chassis verbs and below the MCP tool catalogue:
 *
 *   observe()  one snapshot model, projected as markdown | text | ax | som | list | table | app_data
 *   act()      one intent model (click/type/hover/press) that returns a delta and can await
 *   wait_for() one readiness model (selector/text/url/role/count/network_idle/stable/revision)
 *   extract()  structured reads (list / table / embedded app data)
 *   collect()  scroll-and-dedupe a virtualized list into rows
 *   find()     semantic lookup -> mark refs
 *   expect()   immediate assertion with evidence
 *   state()/diff()  cheap change detection
 *
 * Everything runs on the humanlike path (real pointer/keyboard events + the existing
 * Set-of-Marks `data-mark-id` stamps); no page DOM is mutated beyond that stamp.
 *
 * The host interface is implemented by `BrowserChassis`, which keeps this module free
 * of Electron/tab plumbing and independently unit-testable.
 */

export interface PrimitivesHost {
  webContents(): WebContents;
  log(level: 'info' | 'warn' | 'action', message: string): void;
  evaluate(script: string): Promise<any>;
  harvest(opts: { includeMarks?: boolean; includeOffscreen?: boolean }): Promise<HarvestedConstruct>;
  injectMarks(opts?: { includeOffscreen?: boolean }): Promise<MarkItem[]>;
  removeMarks(): Promise<void>;
  getMarks(): MarkItem[];
  getMarkTarget(id: number): Promise<{ mark: MarkItem; currentCenter: { x: number; y: number } } | null>;
  clickMark(id: number): Promise<string>;
  typeMark(id: number, text: string, opts?: { secret?: boolean; clearFirst?: boolean }): Promise<string>;
  /** Closed-shadow-root discovery. Optional so test hosts can omit the CDP surface. */
  findSealed?(opts: SealedFindOptions): Promise<SealedFindResult>;
  clickElement(selector?: string, coordinates?: { x: number; y: number }): Promise<string>;
  typeText(text: string, selector?: string, opts?: { clearFirst?: boolean }): Promise<string>;
  /** CDP text insertion — no key events. Fallback when keystrokes are provably ignored. */
  insertText(text: string): Promise<boolean>;
  /** Clipboard paste into the focused control, restoring the previous clipboard. */
  pasteText(text: string): Promise<boolean>;
  moveMouseTo(target: { x: number; y: number }): Promise<void>;
  pressKey(key: string): Promise<string>;
  snapshotRenderedPage(opts: any): Promise<any>;
  getNetworkTraffic(filter?: any): any[];
  getPageInfo(): { url: string; title: string; isLoading: boolean; activeTabId?: string };
  revision(): number;
  windowFocused?(): boolean;
  /**
   * Optional: persist an executed action's outcome (state, target, delta, hints) so a runner-side
   * decision model has a local dataset to learn from. Implemented by BrowserChassis → ActionLedger.
   */
  recordTransition?(record: TransitionRecord): void;
}

export type PrimitiveErrorCode = 'STALE_REF' | 'TIMEOUT' | 'NO_TARGET' | 'BAD_REQUEST' | 'NOT_SUPPORTED' | 'AMBIGUOUS';

/**
 * Default view size for `observe(as:"markdown")` when the caller gives no budget.
 * The full construct is retained and pageable with next_cursor; pass budget=0
 * to receive the whole thing in one response.
 */
export const DEFAULT_MARKDOWN_BUDGET = 25000;

export class PrimitiveError extends Error {
  public code: PrimitiveErrorCode;
  public detail?: any;
  constructor(code: PrimitiveErrorCode, message: string, detail?: any) {
    super(message);
    this.name = 'PrimitiveError';
    this.code = code;
    this.detail = detail;
  }
}

export interface WaitCondition {
  type:
    | 'selector'
    | 'gone'
    | 'text'
    | 'url'
    | 'role_name'
    | 'count'
    | 'network_idle'
    | 'stable'
    | 'revision';
  selector?: string;
  text?: string;
  pattern?: string;
  regex?: string;
  flags?: string;
  role?: string;
  name?: string;
  visible?: boolean;
  min?: number;
  max?: number;
  equals?: number;
  /** stable target: what must stop changing */
  target?: 'marks' | 'height' | 'text' | 'nodes';
  /** for network_idle: how long with no new request (ms) */
  quietMs?: number;
  /** for stable: how long the value must hold (ms) */
  holdMs?: number;
  /** for revision: minimum revision */
  version?: number;
}

export interface ConditionResult {
  type: string;
  ok: boolean;
  evidence?: string;
}

export interface WaitResult {
  ok: boolean;
  require: 'any' | 'all';
  waitedMs: number;
  attempts: number;
  results: ConditionResult[];
}

export interface PageState {
  revision: number;
  url: string;
  title: string;
  isLoading: boolean;
  marks: number;
  nodeCount: number;
  height: number;
  scrollY: number;
  textLen: number;
  textHash: number;
  ts: number;
}

export interface ObserveOptions {
  as?: 'markdown' | 'text' | 'ax' | 'som' | 'components' | 'list' | 'table' | 'app_data';
  region?: number | string;
  budget?: number;
  cursor?: string | number;
  includeOffscreen?: boolean;
  limit?: number;
}

export interface ExtractOptions {
  kind: 'list' | 'table' | 'tables' | 'app_data' | 'schema_org';
  ref?: number;
  selector?: string;
  /** schema_org only: filter to a single schema.org @type (case-insensitive, e.g. "Recipe"). */
  type?: string;
  limit?: number;
}

export interface CollectOptions {
  ref?: number;
  selector?: string;
  scroll?: 'container' | 'window';
  step?: number;
  delayMs?: number;
  maxScrolls?: number;
  max?: number;
}

export interface FindOptions {
  role?: string;
  name?: string;
  contains?: string;
  regex?: string;
  flags?: string;
  tag?: string;
  selector?: string;
  limit?: number;
  includeOffscreen?: boolean;
  /** Also search inside closed shadow roots (AX + pierced DOM; opt-in and rate-limited). */
  sealed?: boolean;
  /** Force a fresh sealed scan instead of using the short identity cache. */
  refresh?: boolean;
}

/**
 * A target can be addressed three ways, in order of preference:
 *   mark_id (set-of-marks badge, resilient to layout shifts) > selector > viewport x/y.
 */
export interface ActOptions {
  markId?: number;
  selector?: string;
  x?: number;
  y?: number;
  /** Anchor by visible text — for controls with no semantics (React cards, divs with handlers). */
  targetText?: string;
  /** Require an exact (trimmed) text match instead of substring. */
  targetExact?: boolean;
  action: 'click' | 'type' | 'hover' | 'press' | 'focus';
  text?: string;
  secret?: boolean;
  /** Clear the field before typing (select-all + delete) so a pre-filled value is replaced, not appended to. */
  clearFirst?: boolean;
  await?: WaitCondition[];
  timeoutMs?: number;
  dryRun?: boolean;
  includeOffscreen?: boolean;
}

const DOM_WAIT_TYPES = new Set(['selector', 'gone', 'text', 'url', 'role_name', 'find', 'count']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Page signature probe — one cheap round trip, no DOM mutation. */
const SIGNATURE_SCRIPT = `(() => {
  const t = (document.body && document.body.innerText) || '';
  let h = 0;
  for (let i = 0; i < t.length; i++) { h = (h * 31 + t.charCodeAt(i)) | 0; }
  return {
    url: location.href,
    title: document.title,
    nodeCount: document.getElementsByTagName('*').length,
    height: Math.max(document.documentElement.scrollHeight || 0, (document.body && document.body.scrollHeight) || 0),
    scrollY: Math.round(window.scrollY || 0),
    textLen: t.length,
    textHash: h,
    inputs: document.querySelectorAll('input,textarea,select').length,
    forms: document.querySelectorAll('form').length
  };
})()`;

const STABILITY_SCRIPT = `(() => {
  const t = (document.body && document.body.innerText) || '';
  return {
    height: Math.max(document.documentElement.scrollHeight || 0, (document.body && document.body.scrollHeight) || 0),
    text: t.length,
    nodes: document.getElementsByTagName('*').length
  };
})()`;

/** Shared helpers injected with every probe (kept as one string constant). */
const PROBE_HELPERS = `
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    if (el.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    return true;
  };
  const accName = (el) => {
    let n = clean(el.getAttribute && el.getAttribute('aria-label'));
    if (n) return n;
    n = clean(el.innerText || el.textContent);
    if (n) return n;
    if (el.getAttribute) {
      for (const a of ['placeholder', 'title', 'alt', 'name', 'value']) {
        const v = el.getAttribute(a);
        if (v) return clean(v);
      }
    }
    return '';
  };
  const resolveRoot = (ref, selector) => {
    if (ref !== null && ref !== undefined) return document.querySelector('[data-mark-id="' + ref + '"]');
    if (selector) return document.querySelector(selector);
    return document.body;
  };
`;

function buildWaitProbe(conditions: WaitCondition[]): string {
  return `(() => {
    const conds = ${JSON.stringify(conditions)};
    ${PROBE_HELPERS}
    return conds.map((c) => {
      try {
        if (c.type === 'selector') {
          const el = document.querySelector(c.selector);
          if (!el) return { type: c.type, ok: false, evidence: 'not found' };
          if (c.visible && !isVisible(el)) return { type: c.type, ok: false, evidence: 'present but hidden' };
          return { type: c.type, ok: true, evidence: clean(el.innerText || el.textContent).slice(0, 80) };
        }
        if (c.type === 'gone') {
          return { type: c.type, ok: !document.querySelector(c.selector), evidence: '' };
        }
        if (c.type === 'text') {
          const body = (document.body && document.body.innerText) || '';
          const ok = c.regex ? new RegExp(c.regex, c.flags || 'i').test(body) : body.indexOf(c.text) !== -1;
          return { type: c.type, ok: ok, evidence: ok ? 'found' : 'absent' };
        }
        if (c.type === 'url') {
          const u = location.href;
          const pat = c.pattern || c.text || '';
          const ok = c.regex ? new RegExp(c.regex).test(u) : u.indexOf(pat) !== -1;
          return { type: c.type, ok: ok, evidence: u.slice(0, 120) };
        }
        if (c.type === 'role_name' || c.type === 'find') {
          const role = (c.role || '').toLowerCase();
          const name = (c.name || c.text || '').toLowerCase();
          const nodes = document.querySelectorAll('[role],button,a[href],input,select,textarea,summary,[tabindex]');
          for (const el of nodes) {
            const r = (el.getAttribute('role') || el.tagName.toLowerCase()).toLowerCase();
            if (role && r !== role) continue;
            const n = accName(el).toLowerCase();
            if (name && n.indexOf(name) === -1) continue;
            if (!isVisible(el)) continue;
            return { type: c.type, ok: true, evidence: n.slice(0, 80) };
          }
          return { type: c.type, ok: false, evidence: 'no match' };
        }
        if (c.type === 'count') {
          const n = document.querySelectorAll(c.selector).length;
          let ok;
          if (c.equals !== undefined) ok = n === c.equals;
          else if (c.min !== undefined) ok = n >= c.min;
          else ok = n > 0;
          if (ok && c.max !== undefined) ok = n <= c.max;
          return { type: c.type, ok: ok, evidence: String(n) };
        }
        return { type: c.type, ok: false, evidence: 'unsupported-in-page' };
      } catch (e) {
        return { type: c.type, ok: false, evidence: 'error: ' + (e && e.message) };
      }
    });
  })()`;
}

/** Structured extraction probe: list / table / embedded app data. */
function buildExtractScript(opts: ExtractOptions): string {
  return `(() => {
    const opts = ${JSON.stringify(opts)};
    ${PROBE_HELPERS}
    const abs = (h) => { try { return new URL(h, location.href).href; } catch (e) { return h; } };
    const root = resolveRoot(opts.ref, opts.selector);
    if (!root) return { error: 'root not found', kind: opts.kind };
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 200;
    const sig = (el) => el.tagName + '|' + (typeof el.className === 'string' ? (el.className.split(/\\s+/).filter(Boolean)[0] || '') : '') + '|' + (el.getAttribute('role') || '') + '|' + el.children.length;
    const rowOf = (el) => {
      const a = el.matches && el.matches('a[href]') ? el : el.querySelector('a[href]');
      const markEl = el.getAttribute && el.getAttribute('data-mark-id') ? el : el.querySelector('[data-mark-id]');
      return {
        text: clean(el.innerText || el.textContent).slice(0, 400),
        href: a ? abs(a.getAttribute('href')) : undefined,
        aria: clean(el.getAttribute && el.getAttribute('aria-label')) || undefined,
        mark: markEl ? Number(markEl.getAttribute('data-mark-id')) : undefined
      };
    };

    if (opts.kind === 'app_data') {
      const maxChars = opts.limit && opts.limit > 0 ? opts.limit : 20000;
      const sources = [];
      const push = (name, text) => {
        if (!text) return;
        let data = null; let err = null;
        try { data = JSON.parse(text); } catch (e) { err = String(e && e.message); }
        sources.push({ source: name, bytes: text.length, parsed: data !== null, error: err || undefined, data: data !== null ? data : text.slice(0, maxChars) });
      };
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) push('__NEXT_DATA__', nextData.textContent);
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s, i) => push('ld+json#' + i, s.textContent));
      document.querySelectorAll('script[type="application/json"]').forEach((s) => push('application/json' + (s.id ? '#' + s.id : ''), s.textContent));
      for (const key of ['__NUXT__', '__INITIAL_STATE__', '__DATA__', '__APOLLO_STATE__', '__PRELOADED_STATE__']) {
        if (window[key] && typeof window[key] === 'object') { try { push(key, JSON.stringify(window[key])); } catch (e) {} }
      }
      let scanned = 0;
      for (const key of Object.keys(window)) {
        if (++scanned > 4000) break;
        if (!/^__.*(STATE|DATA|PROPS)__$/.test(key)) continue;
        const v = window[key];
        if (v && typeof v === 'object') { try { push(key, JSON.stringify(v)); } catch (e) {} }
      }
      return { kind: 'app_data', count: sources.length, sources: sources.slice(0, 20) };
    }

    if (opts.kind === 'schema_org') {
      const items = [];
      const typeCounts = {};
      const visit = (node) => {
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (!node || typeof node !== 'object') return;
        const t = node['@type'];
        if (t) {
          const tl = Array.isArray(t) ? t : [t];
          tl.forEach((tt) => { typeCounts[tt] = (typeCounts[tt] || 0) + 1; });
          items.push({ type: tl[0], types: tl, data: node });
        }
        if (node['@graph']) visit(node['@graph']);
      };
      let scanned = 0;
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        if (scanned++ >= 25) return;
        let parsed = null;
        try { parsed = JSON.parse(s.textContent); } catch (e) { return; }
        visit(parsed);
      });
      const want = (opts.type || '').toLowerCase();
      const filtered = want ? items.filter((it) => it.types.some((tt) => String(tt).toLowerCase() === want)) : items;
      return { kind: 'schema_org', count: filtered.slice(0, limit).length, total: filtered.length, types: Object.keys(typeCounts), items: filtered.slice(0, limit) };
    }

    if (opts.kind === 'tables') {
      const tables = [];
      const collect = (table) => {
        const headers = Array.from(table.querySelectorAll('thead th')).map((th) => clean(th.innerText));
        const bodyRows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.querySelector('td'));
        const rows = bodyRows.slice(0, limit).map((tr) => Array.from(tr.querySelectorAll('td,th')).map((td) => clean(td.innerText)));
        if (!rows.length && !headers.length) return;
        const hs = headers.length ? headers : (rows[0] ? rows[0].map((_, i) => 'col' + i) : []);
        const records = rows.map((cells) => { const o = {}; cells.forEach((c, i) => { o[hs[i] || ('col' + i)] = c; }); return o; });
        tables.push({ index: tables.length, headers: hs, count: rows.length, records: records });
      };
      Array.from(document.querySelectorAll('table')).forEach(collect);
      Array.from(document.querySelectorAll('[role="table"],[role="grid"]')).forEach((grid) => {
        if (grid.closest('table')) return;
        const headers = Array.from(grid.querySelectorAll('[role="columnheader"]')).map((h) => clean(h.innerText));
        const rows = Array.from(grid.querySelectorAll('[role="row"]')).map((r) => Array.from(r.querySelectorAll('[role="cell"],[role="gridcell"],[role="columnheader"]')).map((c) => clean(c.innerText))).filter((c) => c.length);
        if (!rows.length && !headers.length) return;
        const hs = headers.length ? headers : (rows[0] ? rows[0].map((_, i) => 'col' + i) : []);
        const records = rows.map((cells) => { const o = {}; cells.forEach((c, i) => { o[hs[i] || ('col' + i)] = c; }); return o; });
        tables.push({ index: tables.length, headers: hs, count: rows.length, records: records });
      });
      return { kind: 'tables', count: tables.length, tables: tables.slice(0, 20) };
    }

    if (opts.kind === 'table') {
      const table = root.tagName === 'TABLE' ? root : root.querySelector('table');
      if (table) {
        const headers = Array.from(table.querySelectorAll('thead th')).map((th) => clean(th.innerText));
        const bodyRows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.querySelector('td'));
        const rows = bodyRows.slice(0, limit).map((tr) => Array.from(tr.querySelectorAll('td,th')).map((td) => clean(td.innerText)));
        const hs = headers.length ? headers : rows[0].map((_, i) => 'col' + i);
        const records = rows.map((cells) => { const o = {}; cells.forEach((c, i) => { o[hs[i] || ('col' + i)] = c; }); return o; });
        return { kind: 'table', headers: hs, count: rows.length, rows: rows, records: records };
      }
      const headers = Array.from(root.querySelectorAll('[role="columnheader"]')).map((h) => clean(h.innerText));
      const rowEls = Array.from(root.querySelectorAll('[role="row"]'));
      const rows = rowEls.map((r) => Array.from(r.querySelectorAll('[role="cell"],[role="gridcell"],[role="columnheader"]')).map((c) => clean(c.innerText))).filter((c) => c.length);
      const hs = headers.length ? headers : (rows[0] ? rows[0].map((_, i) => 'col' + i) : []);
      const records = rows.map((cells) => { const o = {}; cells.forEach((c, i) => { o[hs[i] || ('col' + i)] = c; }); return o; });
      return { kind: 'table', headers: hs, count: rows.length, rows: rows.slice(0, limit), records: records.slice(0, limit) };
    }

    // list
    // Skip non-content subtrees: script clusters look exactly like a "repeating item container"
    // (N siblings, identical signature) and would otherwise win and return JS source instead of
    // rows. Seen on Skyscanner, which keeps ~700 inline scripts under <head>.
    const NON_CONTENT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'TITLE', 'SVG', 'IFRAME', 'CANVAS']);
    const isContent = (el) => el && !NON_CONTENT.has(el.tagName) && isVisible(el);
    // A result row is a *content-bearing* child. Requiring identical sibling signatures (the old
    // heuristic) breaks the moment one card is a sponsored ad or a "show more" divider, so score
    // by density of text-bearing children and prefer the deepest container that still wins.
    const isItem = (el) => isContent(el) && ((el.innerText || '').trim().length >= 25 || !!el.querySelector('a[href]'));
    let best = null; let bestScore = 0;
    const walk = (node, depth) => {
      if (!node || depth > 12 || NON_CONTENT.has(node.tagName)) return;
      const kids = Array.from(node.children || []);
      if (kids.length >= 3) {
        const items = kids.filter(isItem);
        if (items.length >= 3) {
          const score = items.length * 1000 + depth * 5 - Math.abs(kids.length - items.length) * 8;
          if (score > bestScore) { bestScore = score; best = { node: node, count: items.length }; }
        }
      }
      for (const k of kids) walk(k, depth + 1);
    };
    walk(root, 0);
    const container = best ? best.node : root;
    const children = Array.from(container.children || []).filter(isItem);
    const seen = {}; const out = [];
    for (const el of children) {
      const r = rowOf(el);
      if (!r.text && !r.href) continue;
      const key = r.text + '|' + (r.href || '');
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(r);
      if (out.length >= limit) break;
    }
    return { kind: 'list', container: best ? { matched: best.count } : { matched: children.length }, count: out.length, rows: out };
  })()`;
}

/** Scroll-and-dedupe probe for virtualized lists (single async call). */
function buildCollectScript(opts: CollectOptions): string {
  return `(async () => {
    const opts = ${JSON.stringify(opts)};
    ${PROBE_HELPERS}
    const abs = (h) => { try { return new URL(h, location.href).href; } catch (e) { return h; } };
    const root = resolveRoot(opts.ref, opts.selector);
    if (!root) return { error: 'root not found', kind: 'list' };
    const max = opts.max && opts.max > 0 ? opts.max : 300;
    const step = opts.step && opts.step > 0 ? opts.step : 600;
    const delayMs = opts.delayMs && opts.delayMs > 0 ? opts.delayMs : 250;
    const maxScrolls = opts.maxScrolls && opts.maxScrolls > 0 ? opts.maxScrolls : 30;
    const sig = (el) => el.tagName + '|' + (typeof el.className === 'string' ? (el.className.split(/\\s+/).filter(Boolean)[0] || '') : '') + '|' + (el.getAttribute('role') || '') + '|' + el.children.length;
    const rowOf = (el) => {
      const a = el.matches && el.matches('a[href]') ? el : el.querySelector('a[href]');
      const markEl = el.getAttribute && el.getAttribute('data-mark-id') ? el : el.querySelector('[data-mark-id]');
      return {
        text: clean(el.innerText || el.textContent).slice(0, 400),
        href: a ? abs(a.getAttribute('href')) : undefined,
        aria: clean(el.getAttribute && el.getAttribute('aria-label')) || undefined,
        mark: markEl ? Number(markEl.getAttribute('data-mark-id')) : undefined
      };
    };
    // Same non-content guard as extract(list): a wall of inline <script> siblings must never
    // win, and rows are scored by content density so one sponsored card cannot break the match.
    const NON_CONTENT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'TITLE', 'SVG', 'IFRAME', 'CANVAS']);
    const isContent = (el) => el && !NON_CONTENT.has(el.tagName) && isVisible(el);
    const isItem = (el) => isContent(el) && ((el.innerText || '').trim().length >= 25 || !!el.querySelector('a[href]'));
    let best = null; let bestScore = 0;
    const walk = (node, depth) => {
      if (!node || depth > 12 || NON_CONTENT.has(node.tagName)) return;
      const kids = Array.from(node.children || []);
      if (kids.length >= 3) {
        const items = kids.filter(isItem);
        if (items.length >= 3) {
          const score = items.length * 1000 + depth * 5 - Math.abs(kids.length - items.length) * 8;
          if (score > bestScore) { bestScore = score; best = { node: node, count: items.length }; }
        }
      }
      for (const k of kids) walk(k, depth + 1);
    };
    walk(root, 0);
    const container = best ? best.node : root;
    let rows = Array.from(container.children || []).filter(isItem);
    const target = opts.scroll === 'window' ? (document.scrollingElement || document.documentElement) : container;
    const seen = {}; const out = [];
    const read = () => {
      for (const el of rows) {
        const r = rowOf(el);
        if (!r.text && !r.href) continue;
        const key = r.text + '|' + (r.href || '');
        if (seen[key]) continue;
        seen[key] = 1;
        out.push(r);
      }
    };
    let scrolls = 0; let stall = 0;
    const startTop = target.scrollTop;
    for (let i = 0; i < maxScrolls && out.length < max; i++) {
      read();
      const before = out.length;
      try { target.scrollBy(0, step); } catch (e) {}
      await new Promise((r) => setTimeout(r, delayMs));
      rows = Array.from(container.children || []);
      if (best) { const f = rows.filter((el) => sig(el) === best.sig); if (f.length >= 3) rows = f; }
      read();
      scrolls = i + 1;
      if (out.length === before) { stall++; if (stall >= 3) break; } else { stall = 0; }
    }
    read();
    return {
      kind: 'list',
      count: out.length,
      scrolls: scrolls,
      diag: {
        startTop: startTop,
        scrollTop: target.scrollTop,
        scrollHeight: target.scrollHeight,
        clientHeight: target.clientHeight,
        children: (container.children || []).length,
        visibility: document.visibilityState,
        hasFocus: document.hasFocus(),
      },
      rows: out.slice(0, max),
    };
  })()`;
}

export class Primitives {
  private states: Map<number, PageState> = new Map();
  private stateOrder: number[] = [];
  private prevStable: Record<string, { value: number; since: number }> = {};

  constructor(private host: PrimitivesHost) {}

  // ---- state / diff --------------------------------------------------------

  public async pageState(): Promise<PageState> {
    const dom = await this.host.evaluate(SIGNATURE_SCRIPT).catch(() => ({} as any));
    const info = this.host.getPageInfo();
    const state: PageState = {
      revision: this.host.revision(),
      url: dom?.url || info.url || '',
      title: dom?.title || info.title || '',
      isLoading: Boolean(info.isLoading),
      marks: this.host.getMarks().length,
      nodeCount: dom?.nodeCount || 0,
      height: dom?.height || 0,
      scrollY: dom?.scrollY || 0,
      textLen: dom?.textLen || 0,
      textHash: dom?.textHash || 0,
      ts: Date.now(),
    };
    this.remember(state);
    return state;
  }

  private remember(state: PageState) {
    if (!this.states.has(state.revision)) this.stateOrder.push(state.revision);
    this.states.set(state.revision, state);
    while (this.stateOrder.length > 60) {
      const oldest = this.stateOrder.shift();
      if (oldest !== undefined) this.states.delete(oldest);
    }
  }

  public async diff(since?: number): Promise<any> {
    const to = await this.pageState();
    const target = since === undefined ? this.earliestRevision() : since;
    let from = this.states.get(target);
    if (!from) {
      let best: number | null = null;
      for (const rev of this.stateOrder) {
        if (rev <= target && (best === null || rev > best)) best = rev;
      }
      if (best !== null) from = this.states.get(best);
    }
    if (!from) {
      return { from: null, to, changed: true, changes: {}, note: 'no baseline state recorded for that revision' };
    }
    const changes: Record<string, { from: any; to: any }> = {};
    const keys: (keyof PageState)[] = ['url', 'title', 'marks', 'nodeCount', 'height', 'scrollY', 'textLen', 'textHash'];
    for (const k of keys) {
      if (from[k] !== to[k]) changes[k] = { from: from[k], to: to[k] };
    }
    return { from, to, changed: Object.keys(changes).length > 0, changes };
  }

  private earliestRevision(): number {
    return this.stateOrder.length ? this.stateOrder[0] : this.host.revision();
  }

  // ---- wait / expect -------------------------------------------------------

  public async waitFor(
    conditions: WaitCondition[],
    opts: { timeoutMs?: number; pollMs?: number; require?: 'any' | 'all' } = {}
  ): Promise<WaitResult> {
    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 15000;
    const pollMs = opts.pollMs && opts.pollMs > 0 ? opts.pollMs : 120;
    const requireMode: 'any' | 'all' = opts.require === 'all' ? 'all' : 'any';
    const list = (conditions || []).filter(Boolean);
    const started = Date.now();

    if (list.length === 0) {
      return { ok: true, require: requireMode, waitedMs: 0, attempts: 0, results: [] };
    }

    const domConditions = list.filter((c) => DOM_WAIT_TYPES.has(c.type));
    let attempts = 0;
    let results: ConditionResult[] = [];

    for (;;) {
      attempts++;
      const domResults: ConditionResult[] = domConditions.length
        ? await this.host
            .evaluate(buildWaitProbe(domConditions))
            .catch(() =>
              domConditions.map((c) => ({ type: c.type, ok: false, evidence: 'probe error' } as ConditionResult))
            )
        : [];

      let d = 0;
      let needsStability = false;
      for (const c of list) {
        if (c.type === 'stable') needsStability = true;
      }
      const stability = needsStability
        ? await this.host.evaluate(STABILITY_SCRIPT).catch(() => ({} as any))
        : {};

      results = list.map((c) => {
        if (DOM_WAIT_TYPES.has(c.type)) {
          const r = domResults[d++];
          return { type: c.type, ok: Boolean(r && r.ok), evidence: r?.evidence };
        }
        return this.evalHostCondition(c, stability);
      });

      const ok = requireMode === 'all' ? results.every((r) => r.ok) : results.some((r) => r.ok);
      const elapsed = Date.now() - started;
      if (ok) return { ok: true, require: requireMode, waitedMs: elapsed, attempts, results };
      if (elapsed >= timeoutMs) return { ok: false, require: requireMode, waitedMs: elapsed, attempts, results };
      await sleep(pollMs);
    }
  }

  public async expect(conditions: WaitCondition[]): Promise<WaitResult> {
    return this.waitFor(conditions, { timeoutMs: 1, pollMs: 1, require: 'all' });
  }

  private evalHostCondition(c: WaitCondition, stability: any): ConditionResult {
    if (c.type === 'network_idle') {
      const quietMs = c.quietMs && c.quietMs > 0 ? c.quietMs : 800;
      let idleMs = Number.MAX_SAFE_INTEGER;
      try {
        const recent = this.host.getNetworkTraffic({ limit: 1 });
        if (recent && recent.length) idleMs = Date.now() - (recent[0].requestTime || 0);
      } catch {}
      const ok = idleMs >= quietMs;
      return { type: c.type, ok, evidence: ok ? `${idleMs}ms idle` : `${idleMs}ms since last request` };
    }
    if (c.type === 'revision') {
      const rev = this.host.revision();
      const want = c.version ?? 0;
      return { type: c.type, ok: rev >= want, evidence: `revision ${rev} (wanted >= ${want})` };
    }
    if (c.type === 'stable') {
      const target = c.target || 'marks';
      const holdMs = c.holdMs && c.holdMs > 0 ? c.holdMs : 400;
      const value =
        target === 'marks'
          ? this.host.getMarks().length
          : target === 'height'
            ? Number(stability?.height || 0)
            : target === 'nodes'
              ? Number(stability?.nodes || 0)
              : Number(stability?.text || 0);
      const now = Date.now();
      const prev = this.prevStable[target];
      if (!prev || prev.value !== value) {
        this.prevStable[target] = { value, since: now };
        return { type: c.type, ok: false, evidence: `${target}=${value} (changed)` };
      }
      const heldFor = now - prev.since;
      return { type: c.type, ok: heldFor >= holdMs, evidence: `${target}=${value} held ${heldFor}ms` };
    }
    return { type: c.type, ok: false, evidence: 'unsupported host condition' };
  }

  // ---- observe -------------------------------------------------------------

  public async observe(opts: ObserveOptions = {}): Promise<any> {
    const as = opts.as || 'markdown';
    const info = this.host.getPageInfo();
    const revision = this.host.revision();

    if (as === 'list' || as === 'table' || as === 'app_data') {
      const extracted = await this.extract({ kind: as, ref: typeof opts.region === 'number' ? opts.region : undefined, selector: typeof opts.region === 'string' ? opts.region : undefined, limit: opts.limit });
      return { as, revision, url: info.url, title: info.title, ...extracted, text: this.renderExtract(extracted) };
    }

    if (as === 'som') {
      const marks = await this.host.injectMarks({ includeOffscreen: opts.includeOffscreen === true });
      const rows = marks.map((m) => this.markLine(m));
      return { as, revision, url: info.url, title: info.title, marks, count: marks.length, text: rows.join('\n') };
    }

    if (as === 'components') {
      // The decision-ready view: role, name, value, affordances and region per component,
      // with only the actions the element actually accepts. Built on the same shadow-aware
      // mark collection as `som`, so web components are included. Mark ids stay valid, so a
      // decision ("click #8") executes through `act(mark_id)`.
      const marks = await this.host.injectMarks({ includeOffscreen: opts.includeOffscreen === true });
      const components = marks.map((m) => ({
        id: m.id,
        role: (m.role || m.tag).toLowerCase(),
        tag: m.tag.toLowerCase(),
        name: m.text || '',
        value: m.value,
        state: m.state ? m.state.split(',').filter(Boolean) : [],
        actions: m.actions || [],
        region: m.region || 'page',
        regionName: m.regionName,
        rect: m.rect,
      }));
      const text = this.componentsText(components);
      return this.pageText(as, revision, info, text, opts, { components, count: components.length });
    }

    if (as === 'ax') {
      const snap = await this.host.snapshotRenderedPage({ format: 'ax_tree' });
      return this.pageText(as, revision, info, snap?.content || '', opts, { nodeCount: snap?.stats?.nodeCount });
    }

    if (as === 'text') {
      const rootExpr =
        typeof opts.region === 'number'
          ? `document.querySelector('[data-mark-id="${opts.region}"]')`
          : typeof opts.region === 'string'
            ? `document.querySelector(${JSON.stringify(opts.region)})`
            : 'document.body';
      const text =
        (await this.host
          .evaluate(`(() => { const r = ${rootExpr}; if (!r) return ''; return (r.innerText || r.textContent || ''); })()`)
          .catch(() => '')) || '';
      return this.pageText(as, revision, info, text, opts);
    }

    // markdown (default)
    const construct = await this.host.harvest({ includeMarks: true, includeOffscreen: opts.includeOffscreen === true });
    return this.pageText(
      'markdown',
      this.host.revision(),
      { url: construct.url, title: construct.title },
      construct.content,
      opts,
      {
        tokens: construct.estimatedTokens,
        markdownLength: construct.markdownLength,
        extractedChars: construct.extractedChars,
        pageChars: construct.pageChars,        reader: construct.reader,
        shadowRoots: construct.shadowRoots,
      },
      DEFAULT_MARKDOWN_BUDGET
    );
  }

  private pageText(
    as: string,
    revision: number,
    info: { url: string; title: string },
    text: string,
    opts: ObserveOptions,
    extra: Record<string, any> = {},
    defaultBudget = 0
  ) {
    const total = text.length;
    // An explicit budget of 0 means "everything"; an omitted budget uses the
    // projection's default view (markdown is capped so a 400k-char page does not
    // land in context unasked — and, unlike before, the remainder is pageable).
    const budget = opts.budget === undefined || opts.budget === null
      ? defaultBudget
      : opts.budget > 0
        ? opts.budget
        : 0;
    let offset = 0;
    if (opts.cursor !== undefined && opts.cursor !== null && opts.cursor !== '') {
      const n = typeof opts.cursor === 'number' ? opts.cursor : parseInt(String(opts.cursor), 10);
      if (!isNaN(n) && n > 0) offset = Math.min(n, total);
    }
    let slice = text;
    let nextCursor: string | null = null;
    let truncated = false;
    if (budget > 0 && offset + budget < total) {
      let end = offset + budget;
      const nl = text.indexOf('\n', end);
      if (nl !== -1 && nl - end < budget) end = nl;
      slice = text.slice(offset, end);
      nextCursor = String(end);
      truncated = true;
    } else if (offset > 0) {
      slice = text.slice(offset);
    }
    return {
      as,
      revision,
      url: info.url,
      title: info.title,
      text: slice,
      total,
      offset,
      next_cursor: nextCursor,
      truncated,
      ...extra,
    };
  }

  public async extract(opts: ExtractOptions): Promise<any> {
    const script = buildExtractScript({
      kind: opts.kind,
      ref: opts.ref,
      selector: opts.selector,
      type: opts.type,
      limit: opts.limit,
    });
    const res = await this.host.evaluate(script).catch((e) => ({ error: String(e?.message || e), kind: opts.kind }));
    this.host.log('action', `MCP Directive: extract(${opts.kind})${opts.type ? ` type=${opts.type}` : ''}${opts.ref !== undefined ? ` ref=#${opts.ref}` : ''}${opts.selector ? ` selector=${opts.selector}` : ''}`);
    return res;
  }

  private renderExtract(data: any): string {
    if (!data || data.error) return `(no data: ${data?.error || 'empty'})`;
    if (data.kind === 'table') {
      const lines: string[] = [data.headers ? '| ' + data.headers.join(' | ') + ' |' : ''];
      for (const row of data.rows || []) lines.push('| ' + row.join(' | ') + ' |');
      return lines.filter(Boolean).join('\n');
    }
    if (data.kind === 'app_data') {
      return (data.sources || []).map((s: any) => `${s.source} (${s.bytes}B, parsed=${s.parsed})`).join('\n');
    }
    return (data.rows || []).map((r: any, i: number) => `${i + 1}. ${r.text}${r.href ? ` -> ${r.href}` : ''}`).join('\n');
  }

  public async collectAll(opts: CollectOptions = {}): Promise<any> {
    const script = buildCollectScript({
      ref: opts.ref,
      selector: opts.selector,
      scroll: opts.scroll || 'container',
      step: opts.step,
      delayMs: opts.delayMs,
      maxScrolls: opts.maxScrolls,
      max: opts.max,
    });
    const res = await this.host.evaluate(script).catch((e) => ({ error: String(e?.message || e) }));
    this.host.log('action', `MCP Directive: collect_all(${opts.ref !== undefined ? `ref=#${opts.ref}` : opts.selector || 'auto'}) -> ${res?.count ?? 0} rows`);
    return res;
  }

  // ---- find / act ----------------------------------------------------------

  public async find(opts: FindOptions = {}): Promise<any> {
    // Sealed discovery is guarded before marks are injected: a refused call must not mutate the
    // page first. It is also independent of the mark table, so doing it first is cheaper on refusal.
    let sealedInfo: SealedFindResult | undefined;
    if (opts.sealed) {
      if (!this.host.findSealed) {
        throw new PrimitiveError('NOT_SUPPORTED', 'Sealed shadow-root discovery is not available in this build.');
      }
      sealedInfo = await this.host.findSealed({
        role: opts.role,
        name: opts.name,
        contains: opts.contains,
        regex: opts.regex,
        flags: opts.flags,
        tag: opts.tag,
        selector: opts.selector,
        limit: opts.limit,
        includeOffscreen: opts.includeOffscreen,
        refresh: opts.refresh,
      });
    }

    const marks = await this.host.injectMarks({ includeOffscreen: opts.includeOffscreen !== false });
    let selectorIds: Set<number> | null = null;
    if (opts.selector) {
      const ids: number[] = await this.host
        .evaluate(
          `(() => { const out = []; document.querySelectorAll('[data-mark-id]').forEach((el) => { try { if (el.matches(${JSON.stringify(opts.selector)})) out.push(Number(el.getAttribute('data-mark-id'))); } catch (e) {} }); return out; })()`
        )
        .catch(() => []);
      selectorIds = new Set(ids || []);
    }
    const re = opts.regex ? new RegExp(opts.regex, opts.flags || 'i') : null;
    const want = (opts.contains || opts.name || '').toLowerCase();
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 25;

    const filtered = marks.filter((m) => {
      if (selectorIds && !selectorIds.has(m.id)) return false;
      if (opts.tag && m.tag.toLowerCase() !== opts.tag.toLowerCase()) return false;
      if (opts.role) {
        const role = (m.role || '').toLowerCase();
        const implied = m.tag.toLowerCase() === 'a' ? 'link' : m.tag.toLowerCase() === 'button' ? 'button' : '';
        if (role !== opts.role.toLowerCase() && implied !== opts.role.toLowerCase()) return false;
      }
      const hay = `${m.text || ''} ${m.value || ''}`.toLowerCase();
      if (want && hay.indexOf(want) === -1) return false;
      if (re && !re.test(`${m.text || ''} ${m.value || ''}`)) return false;
      return true;
    });

    const limited = filtered.slice(0, limit);

    // Enrich with live control facts (one injected expression for the whole match set): the agent
    // needs to know whether a match is actually hittable — an occluded card looks identical in the
    // marks table to a clickable one, and clicking it silently does nothing.
    let factsById = new Map<number, { visible: boolean; occluded: boolean; disabled: boolean; region: string }>();
    if (limited.length) {
      const raw = await this.host
        .evaluate(controlFactsExpression({ ids: limited.map((m) => m.id), skipHitTest: false }))
        .catch(() => null);
      for (const fact of parseControlFacts(raw).controls) {
        if (fact.id === undefined) continue;
        factsById.set(fact.id, {
          visible: fact.visible,
          occluded: fact.occluded,
          disabled: fact.disabled,
          region: fact.region,
        });
      }
    }

    const lines = limited.map((m) => {
      const facts = factsById.get(m.id);
      // `disabled` is already printed from the mark's own state; only add what the marks table
      // cannot know (live occlusion / hidden state).
      const flags = facts ? [facts.occluded ? 'occluded' : '', facts.visible ? '' : 'hidden'].filter(Boolean) : [];
      return this.markLine(m) + (flags.length ? ` {${flags.join(', ')}}` : '');
    });

    let sealed: SealedControl[] | undefined;
    if (sealedInfo) {
      sealed = sealedInfo.controls;
    }

    const sealedLines = (sealed || []).map((control) => {
      const cx = Math.round(control.rect.x + control.rect.width / 2);
      const cy = Math.round(control.rect.y + control.rect.height / 2);
      const flags = [control.inViewport ? '' : 'offscreen', control.disabled ? 'disabled' : ''].filter(Boolean);
      return `[sealed] <${control.role}> "${control.name}" @ (${cx}, ${cy})${flags.length ? ` {${flags.join(', ')}}` : ''}`;
    });

    const text = [lines.join('\n'), sealedLines.join('\n')].filter(Boolean).join('\n');
    const result: any = {
      count: limited.length,
      total: filtered.length,
      marks: limited.map((m) => ({ ...m, facts: factsById.get(m.id) })),
      text,
    };
    if (sealedInfo) {
      result.sealed = sealedInfo.controls;
      result.sealedTotal = sealedInfo.total;
      result.sealedCached = sealedInfo.cached;
      result.sealedNotes = sealedInfo.notes;
    }
    return result;
  }

  public async act(opts: ActOptions): Promise<any> {
    const action = opts.action || 'click';
    const hasMark = opts.markId !== undefined && opts.markId !== null && !isNaN(Number(opts.markId));
    const selector = opts.selector ? String(opts.selector) : undefined;
    const px = opts.x !== undefined && !isNaN(Number(opts.x)) ? Number(opts.x) : undefined;
    const py = opts.y !== undefined && !isNaN(Number(opts.y)) ? Number(opts.y) : undefined;
    const hasCoords = px !== undefined && py !== undefined;
    const targetText = opts.targetText ? String(opts.targetText).replace(/\s+/g, ' ').trim() : undefined;
    const hasText = !!targetText;

    if (action !== 'press' && !hasMark && !selector && !hasCoords && !hasText) {
      throw new PrimitiveError(
        'BAD_REQUEST',
        'act needs a target: mark_id, selector, x+y, or target_text (only action="press" is targetless)'
      );
    }

    const markId = hasMark ? Number(opts.markId) : undefined;
    const startedAt = Date.now();
    const before = this.liteSnapshot();
    const secret = Boolean(opts.secret);
    const shownText = secret ? '[REDACTED]' : String(opts.text ?? '');

    // The address resolves to a human label plus, where one is needed, a live viewport
    // centre (hover, coordinate clicks, and the focus-click that precedes a coordinate type).
    let center: { x: number; y: number } | null = null;
    let address = '';
    let target: { id?: number; tag?: string; text?: string; selector?: string; center?: { x: number; y: number }; field?: FieldFacts } | null = null;

    if (action !== 'press') {
      if (hasMark) {
        let hit = await this.host.getMarkTarget(markId!);
        if (!hit && opts.includeOffscreen !== false) {
          // Mark registry may be cold (fresh tab / no scan yet) — refresh once.
          await this.host.injectMarks({ includeOffscreen: true });
          hit = await this.host.getMarkTarget(markId!);
        }
        if (!hit) {
          throw new PrimitiveError('STALE_REF', `Mark #${markId} could not be resolved. Re-run observe/find to refresh refs.`, { markId });
        }
        center = hit.currentCenter;
        address = `#${markId}`;
        target = { id: hit.mark.id, tag: hit.mark.tag, text: secret ? '[REDACTED]' : hit.mark.text, center };
        const markFacts = await this.probeField({ markId: markId! });
        if (markFacts) target.field = markFacts;
      } else if (hasText) {
        const rawTargets = await this.host
          .evaluate(textTargetExpression(targetText!, { exact: opts.targetExact === true, max: 8 }))
          .catch(() => null);
        const found = parseTextTargets(rawTargets);
        if (!found.matches.length) {
          throw new PrimitiveError('NO_TARGET', `No visible element contains "${targetText}"`, { targetText });
        }
        if (found.matches.length > 1) {
          throw new PrimitiveError(
            'AMBIGUOUS',
            `"${targetText}" matches ${found.matches.length} elements — pass a longer string or a mark id`,
            { targetText, candidates: found.matches.slice(0, 5) }
          );
        }
        const match = found.matches[0];
        center = { x: match.x, y: match.y };
        address = `text "${match.text}"`;
        target = { tag: match.tag, text: match.text, center };
        const pointFacts = await this.probeField({ point: center });
        if (pointFacts) target.field = pointFacts;
      } else if (selector) {
        const box = await this.resolveTargetBox({ selector });
        if (!box) throw new PrimitiveError('NO_TARGET', `Selector "${selector}" matched no visible element`, { selector });
        center = { x: box.x, y: box.y };
        address = selector;
        target = { selector, tag: box.tag, text: box.text, center };
        const selFacts = await this.probeField({ selector });
        if (selFacts) target.field = selFacts;
      } else if (hasCoords) {
        center = { x: px!, y: py! };
        address = `(${px}, ${py})`;
        target = { center };
        const pointFacts = await this.probeField({ point: center });
        if (pointFacts) target.field = pointFacts;
      }
    }

    if (opts.dryRun) {
      return {
        ok: true,
        dryRun: true,
        action,
        markId,
        address,
        target,
        wouldType: action === 'type' ? shownText : undefined,
      };
    }

    this.host.log('action', `MCP Directive: act(${action}, ${address || '(targetless)'}${action === 'type' ? `, "${shownText}"` : action === 'press' ? `, "${opts.text || ''}"` : ''}${action === 'type' && opts.clearFirst ? ', clear_first' : ''})`);

    /** Typing verdict, when the action was a type and the target resolved to a control. */
    let typing: TypingOutcome | null = null;

    switch (action) {
      case 'click':
      case 'focus':
        if (hasMark) await this.host.clickMark(markId!);
        else await this.host.clickElement(selector, hasCoords || hasText ? center! : undefined);
        break;
      case 'hover':
        await this.host.moveMouseTo(center!);
        break;
      case 'type': {
        const text = String(opts.text ?? '');
        const clearFirst = opts.clearFirst === true;
        const locator: TargetLocator = hasMark ? { markId: markId! } : selector ? { selector } : { point: center! };
        // Snapshot the control's value and start counting the trusted key/input events
        // that actually reach the page. This is what turns a silent no-op into a verdict.
        if (text.length > 0) await this.host.evaluate(inputProbeInstallScript(locator)).catch(() => null);

        if (hasMark) {
          await this.host.typeMark(markId!, text, { secret, clearFirst });
        } else if (selector) {
          await this.host.typeText(text, selector, { clearFirst });
        } else {
          // Coordinate type: focus the point with a real click first, then type into whatever took focus.
          await this.host.clickElement(undefined, center!);
          await this.host.typeText(text, undefined, { clearFirst });
        }

        if (text.length > 0) {
          const probe = await this.host.evaluate(inputProbeReadScript()).catch(() => null);
          typing = this.verdictForTyping(probe, text.length, clearFirst);

          // Input-method ladder. Keys are the humanlike default; only when real keystrokes
          // provably reached the page and changed nothing do we try the other channels
          // (CDP insertText, then clipboard paste), re-verifying each. Some web-component
          // fields filter `keydown` entirely, and those accept insertion or paste.
          if (typing && typing.landed === false && typing.keydowns > 0) {
            // Preserve the evidence from the keystroke attempt: each fallback channel gets a fresh
            // probe, and its own counters would otherwise erase the proof that keys *did* arrive
            // (a paste produces no keydowns at all).
            const keyAttempt = typing;
            const attempted: TypingChannel[] = ['keys'];
            for (const channel of ['insertText', 'paste'] as const) {
              await this.host.evaluate(inputProbeInstallScript(locator)).catch(() => null);
              const sent = channel === 'insertText' ? await this.host.insertText(text) : await this.host.pasteText(text);
              const probe2 = await this.host.evaluate(inputProbeReadScript()).catch(() => null);
              if (!sent) continue;
              const verdict = this.verdictForTyping(probe2, text.length, false);
              if (!verdict) continue;
              attempted.push(channel);
              typing = {
                ...verdict,
                channel,
                keydowns: Math.max(verdict.keydowns, keyAttempt.keydowns),
                attempted,
              };
              if (verdict.landed) break;
            }
          }
        }
        break;
      }
      case 'press':
        await this.host.pressKey(String(opts.text || 'Enter'));
        break;
      default:
        throw new PrimitiveError('NOT_SUPPORTED', `Unsupported act action "${action}"`);
    }

    // Clicking through an age/CAPTCHA wall is a claim only a human can make. We do not refuse —
    // a human may have explicitly asked for it — but the result says so plainly.
    const gateWarning = action === 'click' ? await this.gateWarningFor(target?.text || '') : undefined;

    let awaited: WaitResult | null = null;
    if (opts.await && opts.await.length) {
      awaited = await this.waitFor(opts.await, { timeoutMs: opts.timeoutMs });
      if (!awaited.ok) {
        // Zero-cost diagnostic: only runs on failure, so the happy path stays one round trip.
        try {
          const diag = await this.host.evaluate(diagnosticsScript());
          const hints: string[] = [];
          if (!diag?.w || !diag?.h) hints.push('page viewport is 0x0 (window hidden/minimised?) — synthetic input and viewport-scoped marks may not register; make the window visible');
          if (this.host.windowFocused && !this.host.windowFocused()) hints.push('the app window is not focused — Electron drops synthetic input (sendInputEvent) while another window owns focus; call bridge_health / focus the window');
          const active = diag?.active;
          if (action === 'type' && active?.tag && target?.tag && active.tag !== target.tag) {
            hints.push(`focus is on <${active.tag}${active.label ? ` "${active.label}"` : ''}>, not the target <${target.tag}> — the click may have been occluded`);
          }
          if (action === 'type' && !active) hints.push('nothing is focused in the page — the click did not land on a focusable control');
          if (hints.length) (awaited as any).hint = hints.join('; ');
        } catch {}
      }
    }

    const after = this.liteSnapshot();
    const durationMs = Date.now() - startedAt;

    // The verdict the tool used to omit entirely: `type` reported success whether or not
    // anything was typed. A provable no-op is now a structured failure, not a summary.
    const typingFailed = typing !== null && typing.landed === false;
    const typingHint = typingFailed
      ? this.typingHint(typing!)
      : typing?.unobservable
        ? 'Keystrokes were delivered, but the control is inside a closed shadow root, so its value cannot be verified from page JS. Confirm the effect through the UI instead of retrying.'
        : undefined;
    const ok = !typingFailed;
    const hints = [(awaited as any)?.hint, typingHint, gateWarning].filter(Boolean).join('; ') || undefined;

    // Record the transition: this is the dataset a runner-side decision model learns from.
    // Never the typed text — only its length, plus whether it landed.
    this.host.recordTransition?.({
      ts: Date.now(),
      action,
      addressMode: hasMark ? 'mark_id' : selector ? 'selector' : hasCoords ? 'coords' : 'none',
      address,
      target: target || undefined,
      url: after.url,
      revisionBefore: before.revision,
      revisionAfter: after.revision,
      marksBefore: before.marks,
      marksAfter: after.marks,
      urlChanged: before.url !== after.url,
      marksChanged: before.marks !== after.marks,
      ok,
      awaitOk: awaited ? awaited.ok : undefined,
      hints,
      durationMs,
      typed: action === 'type' ? { chars: String(opts.text ?? '').length, secret, landed: typing ? typing.landed : undefined } : undefined,
      typing: typing || undefined,
      clearFirst: action === 'type' ? opts.clearFirst === true : undefined,
    });

    const result: any = {
      ok,
      action,
      markId,
      address,
      target,
      typed: action === 'type' ? shownText : undefined,
      delta: {
        urlChanged: before.url !== after.url,
        beforeUrl: before.url,
        afterUrl: after.url,
        revisionBefore: before.revision,
        revisionAfter: after.revision,
        marksBefore: before.marks,
        marksAfter: after.marks,
      },
      awaited,
      durationMs,
    };

    if (typing) result.typing = typing;
    if (gateWarning) result.warning = gateWarning;
    if (typingFailed) {
      result.error = {
        code: 'TYPE_NO_EFFECT',
        message: `Typing had no effect on ${target?.tag ? `<${target.tag}>` : 'the target'} (value length ${typing!.beforeLength} → ${typing!.afterLength}).`,
        hint: typingHint,
      };
    }

    return result;
  }

  /**
   * Turn the input probe into a verdict.
   *
   * `landed: false` means the field's value did not change and no trusted key events reached
   * the page — the silent no-op this tool used to report as success. The event counters
   * separate the two causes so the hint can name the right remedy:
   *
   *   no events at all      → the input never arrived (focus/window), fix the target
   *   events, value unmoved → the control rejects synthetic input (OTP/one-time-code), hand over
   */
  private verdictForTyping(probe: any, typedChars: number, clearFirst: boolean): TypingOutcome | null {
    if (!probe) return null;
    const base = {
      beforeLength: Number(probe.beforeLength || 0),
      afterLength: probe.afterLength === null || probe.afterLength === undefined ? null : Number(probe.afterLength),
      changed: probe.changed === null || probe.changed === undefined ? null : Boolean(probe.changed),
      keydowns: Number(probe.keydowns || 0),
      beforeinputs: Number(probe.beforeinputs || 0),
      inputs: Number(probe.inputs || 0),
      detached: probe.detached === true,
    };
    // Re-rendered mid-type (React/Lit swapped the node): no verdict is possible.
    if (base.detached || base.afterLength === null) return { ...base, landed: null };
    // A closed-shadow target exposes events but not its value; the keystrokes may be fine.
    if (probe.observable === false) return { ...base, landed: null, unobservable: true };

    const noEventsAtAll = base.keydowns === 0 && base.beforeinputs === 0 && base.inputs === 0;
    // clear_first + retyping the identical value leaves the length unchanged but is not a no-op.
    const identicalRetype = clearFirst && base.afterLength > 0 && base.afterLength === typedChars;
    const landed = noEventsAtAll ? false : base.changed === true || identicalRetype;
    return { ...base, landed, channel: 'keys', attempted: ['keys'] };
  }

  /**
   * Warn when a click target looks like an age/CAPTCHA gate control. Only the page copy decides
   * whether a gate is present — the target's own label merely triggers the (single) page read, so
   * ordinary "Continue" buttons on normal pages cost one extra evaluate at worst.
   */
  private async gateWarningFor(targetText: string): Promise<string | undefined> {
    if (!targetText || !/verify|continue|enter|age|birthday|18|captcha|robot|human|i'?m/i.test(targetText)) return undefined;
    const pageText = await this.host
      .evaluate('(document.body ? document.body.innerText : "").slice(0, 1500)')
      .catch(() => '');
    const gate = detectSensitiveGate(pageText, { url: this.host.getPageInfo().url });
    if (!gate) return undefined;
    const kind = gate.kind === 'age_verification' ? 'age-verification' : 'CAPTCHA';
    return `"${targetText.slice(0, 60)}" sits behind a ${kind} wall. If a human has not resolved the hand-off, stop and call request_human_intervention.`;
  }

  private typingHint(t: TypingOutcome): string {    if (t.keydowns === 0) {
      return 'No trusted key events reached the page — focus was not on the target (the click may have been occluded) or the app window is not focused. Re-check with act(action:"focus") or bridge_health.';
    }
    if (t.channel && t.channel !== 'keys') {
      return `The control rejected every input channel — keystrokes, CDP text insertion and clipboard paste (value ${t.beforeLength} → ${t.afterLength}, keydowns ${t.keydowns}). It enforces its own input rules (a code field or a masked widget); call request_human_intervention rather than retrying.`;
    }
    return `The control received ${t.keydowns} key event(s) and ${t.beforeinputs} beforeinput event(s) but its value did not change — it rejects synthetic input. One-time-code/OTP inputs and some framework-controlled fields behave this way; call request_human_intervention instead of retrying.`;
  }

  /**
   * Resolve a locator to the box of the control to act on, scrolling it into view.
   * Shadow-aware: a selector naming a custom-element host resolves to the inner control
   * a mouse would hit (see dom-targeting.ts).
   */
  private async resolveTargetBox(locator: TargetLocator): Promise<TargetBox | null> {
    const res = (await this.host.evaluate(targetBoxScript(locator)).catch(() => null)) as TargetBox | null;
    if (!res || typeof res.x !== 'number' || typeof res.y !== 'number') return null;
    // A tab that has never been laid out reports a 0x0 viewport and geometry that has
    // nothing to do with the page (this produced a silent click at (31, 0) on a fixture
    // whose button was at (231, 90)). Fail loudly instead of acting on nonsense.
    if (res.vw === 0 || res.vh === 0) {
      throw new PrimitiveError(
        'NO_TARGET',
        'The page viewport is 0x0, so no target can be resolved — the tab has not been laid out yet (the window may be hidden or minimised). Make the window visible and retry.',
        { selector: locator.selector }
      );
    }
    return res;
  }

  /**
   * Typed facts about the form control an action addressed (null when the target isn't a control).
   *
   * This is what lets a decision layer answer *"should I pass clear_first?"* (`prefilled`) or triage a
   * click that appeared to do nothing (`disabled`) from **data** instead of guessing. Surfaced in the
   * `act` result as `target.field`, including on `dry_run` — so it can be pre-flighted without acting.
   *
   * Resolution is shadow-aware, so a web-component field reports its real `<input>` (and real value
   * length) rather than the custom-element host, which is not input-like and would probe as `null`.
   */
  private async probeField(locator: TargetLocator): Promise<FieldFacts | null> {
    const facts = await this.host.evaluate(fieldFactsScript(locator)).catch(() => null);
    return facts && typeof facts.tag === 'string' ? (facts as FieldFacts) : null;
  }

  private liteSnapshot() {
    const info = this.host.getPageInfo();
    return { revision: this.host.revision(), url: info.url, title: info.title, marks: this.host.getMarks().length };
  }

  /**
   * Compact, region-grouped rendering of the component table. One line per component:
   *   [8] button   "Create account" {click}
   *   [7] textbox  "Email" · empty {type}
   * Read top-down, it is the page's affordances — no markup, no screenshot.
   */
  private componentsText(components: Array<{ id: number; role: string; name: string; value?: string; state: string[]; actions: string[]; region: string; regionName?: string }>): string {
    const groups = new Map<string, string[]>();
    for (const c of components) {
      const key = c.regionName ? `${c.region} · ${c.regionName}` : c.region;
      const bits = [`[${c.id}] ${c.role}`.padEnd(20), `"${c.name}"`];
      if (c.value) bits.push(`· ${c.value}`);
      if (c.state.length) bits.push(`[${c.state.join(', ')}]`);
      if (c.actions.length) bits.push(`{${c.actions.join(', ')}}`);
      const line = bits.join(' ');
      const bucket = groups.get(key);
      if (bucket) bucket.push(line);
      else groups.set(key, [line]);
    }
    const lines: string[] = [];
    for (const [region, rows] of groups) {
      if (lines.length) lines.push('');
      lines.push(`## ${region}`);
      lines.push(...rows);
    }
    return lines.join('\n');
  }

  private markLine(m: MarkItem): string {    const attrs = `${m.type ? ` type="${m.type}"` : ''}${m.role ? ` role=${m.role}` : ''}`;
    const extras: string[] = [];
    if (m.value) extras.push(`value="${m.value}"`);
    if (m.state) extras.push(m.state.replace(/,/g, ', '));
    return `[#${m.id}] <${m.tag}${attrs}> "${m.text || ''}"${extras.length ? ` {${extras.join(', ')}}` : ''}`;
  }

  // ---- network -------------------------------------------------------------

  public trafficSince(since: number, pattern?: string, limit = 100): any[] {
    const all = this.host.getNetworkTraffic({ urlPattern: pattern, limit: 250 }) || [];
    return all.filter((r: any) => (r.requestTime || 0) >= since).slice(0, limit);
  }

  public exportHar(opts: { limit?: number; pattern?: string } = {}): any {
    const requests = (this.host.getNetworkTraffic({ urlPattern: opts.pattern, limit: opts.limit && opts.limit > 0 ? opts.limit : 250 }) || []) as any[];
    const info = this.host.getPageInfo();
    const entries = requests
      .slice()
      .sort((a, b) => (a.requestTime || 0) - (b.requestTime || 0))
      .map((r) => ({
        startedDateTime: new Date(r.requestTime || Date.now()).toISOString(),
        time: r.responseDurationMs || 0,
        request: {
          method: r.method,
          url: r.url,
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: Object.entries(r.requestHeaders || {}).map(([name, value]) => ({ name, value: String(value) })),
          queryString: [],
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          status: r.status || 0,
          statusText: r.statusText || '',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: Object.entries(r.responseHeaders || {}).map(([name, value]) => ({ name, value: String(value) })),
          content: { size: (r.bodyPreview || '').length, mimeType: r.mimeType || '', text: r.bodyPreview || '' },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: { send: 0, wait: r.responseDurationMs || 0, receive: 0 },
      }));
    return {
      log: {
        version: '1.2',
        creator: { name: 'Mark Eleven Cyberdeck', version: APP_VERSION },
        pages: [{ startedDateTime: new Date().toISOString(), id: 'page_1', title: info.title || '', pageTimings: {} }],
        entries,
      },
    };
  }
}
