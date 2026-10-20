import type { WebContents } from 'electron';
import type { HarvestedConstruct } from '../../shared/types.js';
import { APP_VERSION } from '../../shared/version.js';
import type { MarkItem } from '../marks/marks-overlay.js';

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
  clickElement(selector?: string, coordinates?: { x: number; y: number }): Promise<string>;
  typeText(text: string, selector?: string, opts?: { clearFirst?: boolean }): Promise<string>;
  moveMouseTo(target: { x: number; y: number }): Promise<void>;
  pressKey(key: string): Promise<string>;
  snapshotRenderedPage(opts: any): Promise<any>;
  getNetworkTraffic(filter?: any): any[];
  getPageInfo(): { url: string; title: string; isLoading: boolean; activeTabId?: string };
  revision(): number;
  windowFocused?(): boolean;
}

export type PrimitiveErrorCode = 'STALE_REF' | 'TIMEOUT' | 'NO_TARGET' | 'BAD_REQUEST' | 'NOT_SUPPORTED';

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
  as?: 'markdown' | 'text' | 'ax' | 'som' | 'list' | 'table' | 'app_data';
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
    let best = null; let bestScore = 0;
    const walk = (node, depth) => {
      if (!node || depth > 8) return;
      const kids = Array.from(node.children || []);
      if (kids.length >= 3) {
        const counts = {};
        for (const k of kids) { const s = sig(k); counts[s] = (counts[s] || 0) + 1; }
        for (const s of Object.keys(counts)) {
          const c = counts[s];
          if (c >= 3) {
            const score = c * 1000 - depth * 10 - Math.abs(kids.length - c);
            if (score > bestScore) { bestScore = score; best = { node: node, sig: s, count: c }; }
          }
        }
      }
      for (const k of kids) walk(k, depth + 1);
    };
    walk(root, 0);
    const container = best ? best.node : root;
    let children = Array.from(container.children || []);
    if (best) { const f = children.filter((el) => sig(el) === best.sig); if (f.length >= 3) children = f; }
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
    return { kind: 'list', container: best ? { sig: best.sig, matched: best.count } : { sig: null, matched: children.length }, count: out.length, rows: out };
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
    let best = null; let bestScore = 0;
    const walk = (node, depth) => {
      if (!node || depth > 8) return;
      const kids = Array.from(node.children || []);
      if (kids.length >= 3) {
        const counts = {};
        for (const k of kids) { const s = sig(k); counts[s] = (counts[s] || 0) + 1; }
        for (const s of Object.keys(counts)) {
          const c = counts[s];
          if (c >= 3) { const score = c * 1000 - depth * 10 - Math.abs(kids.length - c); if (score > bestScore) { bestScore = score; best = { node: node, sig: s, count: c }; } }
        }
      }
      for (const k of kids) walk(k, depth + 1);
    };
    walk(root, 0);
    const container = best ? best.node : root;
    let rows = Array.from(container.children || []);
    if (best) { const f = rows.filter((el) => sig(el) === best.sig); if (f.length >= 3) rows = f; }
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
    const pollMs = opts.pollMs && opts.pollMs > 0 ? opts.pollMs : 250;
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
    return this.pageText('markdown', this.host.revision(), { url: construct.url, title: construct.title }, construct.content, opts, {
      tokens: construct.estimatedTokens,
      markdownLength: construct.markdownLength,
    });
  }

  private pageText(as: string, revision: number, info: { url: string; title: string }, text: string, opts: ObserveOptions, extra: Record<string, any> = {}) {
    const total = text.length;
    const budget = opts.budget && opts.budget > 0 ? opts.budget : 0;
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
    return {
      count: limited.length,
      total: filtered.length,
      marks: limited,
      text: limited.map((m) => this.markLine(m)).join('\n'),
    };
  }

  public async act(opts: ActOptions): Promise<any> {
    const action = opts.action || 'click';
    const hasMark = opts.markId !== undefined && opts.markId !== null && !isNaN(Number(opts.markId));
    const selector = opts.selector ? String(opts.selector) : undefined;
    const px = opts.x !== undefined && !isNaN(Number(opts.x)) ? Number(opts.x) : undefined;
    const py = opts.y !== undefined && !isNaN(Number(opts.y)) ? Number(opts.y) : undefined;
    const hasCoords = px !== undefined && py !== undefined;

    if (action !== 'press' && !hasMark && !selector && !hasCoords) {
      throw new PrimitiveError('BAD_REQUEST', 'act needs a target: mark_id, selector, or x+y (only action="press" is targetless)');
    }

    const markId = hasMark ? Number(opts.markId) : undefined;
    const before = this.liteSnapshot();
    const secret = Boolean(opts.secret);
    const shownText = secret ? '[REDACTED]' : String(opts.text ?? '');

    // The address resolves to a human label plus, where one is needed, a live viewport
    // centre (hover, coordinate clicks, and the focus-click that precedes a coordinate type).
    let center: { x: number; y: number } | null = null;
    let address = '';
    let target: { id?: number; tag?: string; text?: string; selector?: string; center?: { x: number; y: number } } | null = null;

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
      } else if (selector) {
        const box = await this.resolveSelectorBox(selector);
        if (!box) throw new PrimitiveError('NO_TARGET', `Selector "${selector}" matched no visible element`, { selector });
        center = box.center;
        address = selector;
        target = { selector, tag: box.tag, text: box.text, center };
      } else if (hasCoords) {
        center = { x: px!, y: py! };
        address = `(${px}, ${py})`;
        target = { center };
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

    switch (action) {
      case 'click':
      case 'focus':
        if (hasMark) await this.host.clickMark(markId!);
        else await this.host.clickElement(selector, hasCoords ? center! : undefined);
        break;
      case 'hover':
        await this.host.moveMouseTo(center!);
        break;
      case 'type': {
        const text = String(opts.text ?? '');
        const clearFirst = opts.clearFirst === true;
        if (hasMark) {
          await this.host.typeMark(markId!, text, { secret, clearFirst });
        } else if (selector) {
          await this.host.typeText(text, selector, { clearFirst });
        } else {
          // Coordinate type: focus the point with a real click first, then type into whatever took focus.
          await this.host.clickElement(undefined, center!);
          await this.host.typeText(text, undefined, { clearFirst });
        }
        break;
      }
      case 'press':
        await this.host.pressKey(String(opts.text || 'Enter'));
        break;
      default:
        throw new PrimitiveError('NOT_SUPPORTED', `Unsupported act action "${action}"`);
    }

    let awaited: WaitResult | null = null;
    if (opts.await && opts.await.length) {
      awaited = await this.waitFor(opts.await, { timeoutMs: opts.timeoutMs });
      if (!awaited.ok) {
        // Zero-cost diagnostic: only runs on failure, so the happy path stays one round trip.
        try {
          const diag = await this.host.evaluate(
            '({ w: window.innerWidth, h: window.innerHeight, active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null })'
          );
          const hints: string[] = [];
          if (!diag?.w || !diag?.h) hints.push('page viewport is 0x0 (window hidden/minimised?) — synthetic input and viewport-scoped marks may not register; make the window visible');
          if (this.host.windowFocused && !this.host.windowFocused()) hints.push('the app window is not focused — Electron drops synthetic input (sendInputEvent) while another window owns focus; call bridge_health / focus the window');
          if (action === 'type' && diag?.active && target?.tag && String(diag.active).toUpperCase() !== target.tag.toUpperCase()) hints.push(`focus is on "${diag.active}", not the target <${target.tag}> — the click may have been occluded`);
          if (hints.length) (awaited as any).hint = hints.join('; ');
        } catch {}
      }
    }

    const after = this.liteSnapshot();
    return {
      ok: true,
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
    };
  }

  /** Resolve a CSS selector to its live viewport centre (scrolling it into view first). */
  private async resolveSelectorBox(selector: string): Promise<{ center: { x: number; y: number }; tag?: string; text?: string } | null> {
    const res = await this.host
      .evaluate(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          el.scrollIntoView({ behavior: 'auto', block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.tagName.toLowerCase(), text: (el.innerText || el.textContent || '').trim().slice(0, 80) };
        })()`
      )
      .catch(() => null);
    if (!res || typeof res.x !== 'number' || typeof res.y !== 'number') return null;
    return { center: { x: res.x, y: res.y }, tag: res.tag, text: res.text };
  }

  private liteSnapshot() {
    const info = this.host.getPageInfo();
    return { revision: this.host.revision(), url: info.url, title: info.title, marks: this.host.getMarks().length };
  }

  private markLine(m: MarkItem): string {
    const attrs = `${m.type ? ` type="${m.type}"` : ''}${m.role ? ` role=${m.role}` : ''}`;
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
