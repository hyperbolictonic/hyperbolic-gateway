/**
 * Control facts — one description of an element, shared by marks, `find`, the decision guard and
 * recipes.
 *
 * The point of this module is that all four consumers ask the same question and get the same
 * answer: what is this thing, can a mouse actually hit it right now, and what does it accept?
 * Duplicating that logic is how `act` and `injectMarks` drift apart (one resolves a covered card,
 * the other skips it).
 *
 * Runs as a single injected expression: no per-element round trips, no framework dependency.
 */
import { COMPONENT_SIGNATURE_HELPERS, type ComponentSurface } from '../shadow-walk/component-signature.js';
export type ControlAction = 'click' | 'type' | 'hover' | 'select' | 'press' | 'scroll';

export interface ControlFacts {
  /** Mark id when the element was already stamped by Set-of-Marks. */
  id?: number;
  tag: string;
  role: string;
  name: string;
  value?: string;
  state: string[];
  actions: ControlAction[];
  /** Laid out and not display:none / visibility:hidden / opacity:0 / aria-hidden. */
  visible: boolean;
  /** True when a hit-test at the element's own centre lands on something else. */
  occluded: boolean;
  disabled: boolean;
  /** Nearest landmark-ish ancestor: header, nav, main, footer, dialog, aside, form, or "page". */
  region: string;
  regionName?: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Nearest custom-element host's exported surface, when requested. */
  component?: ComponentSurface;
}

export interface ControlFactsOptions {
  /** CSS selector; omitted = every interactive candidate on the page. */
  selector?: string;
  /** Mark ids to describe (overrides selector). Resolved from `data-mark-id` attributes. */
  ids?: number[];
  /** Cap the number of returned controls (default 200). */
  limit?: number;
  /** Include elements below/above the fold (default true). */
  includeOffscreen?: boolean;
  /** Skip the hit-test (cheaper, but `occluded` is then always false). */
  skipHitTest?: boolean;
  /**
   * Also scan open shadow roots. Matches the marks scanner, which treats a web component's
   * inner control as a first-class candidate. Off by default: most pages need neither the
   * extra walk nor the larger result set.
   */
  deep?: boolean;
  /**
   * Stamp each returned control with `data-mark-id` starting at this number. Used by the frame
   * scanner so an iframe control gets a stable id without colliding with main-frame marks.
   */
  markIdBase?: number;
  /** Attach the nearest custom-element host's exported surface. */
  component?: boolean;
}

/**
 * Shared in-page helpers. Kept as one string so the expression stays self-contained and cannot
 * accidentally depend on module scope inside the renderer.
 */
const HELPERS = `
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const accName = (el) => {
    let n = clean(el.getAttribute && el.getAttribute('aria-label'));
    if (n) return n;
    n = clean(el.innerText || el.textContent);
    if (n) return n.slice(0, 120);
    if (el.getAttribute) {
      for (const a of ['placeholder', 'title', 'alt', 'name', 'value']) {
        const v = el.getAttribute(a);
        if (v) return clean(v);
      }
    }
    return '';
  };
  const isVisible = (el, rect) => {
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    if (el.closest && el.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    return true;
  };
  const actionsFor = (el) => {
    const out = [];
    const tag = el.tagName;
    const role = (el.getAttribute && el.getAttribute('role') || '').toLowerCase();
    const type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase();
    if (el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')) return out;
    if (tag === 'INPUT') {
      if (['button', 'submit', 'reset', 'checkbox', 'radio', 'file'].includes(type)) out.push('click');
      else out.push('type');
      if (type === 'checkbox' || type === 'radio') out.push('click');
      out.push('hover');
      return out;
    }
    if (tag === 'TEXTAREA' || el.isContentEditable) { out.push('type', 'hover'); return out; }
    if (tag === 'SELECT') { out.push('select', 'click'); return out; }
    if (tag === 'A' || tag === 'BUTTON' || tag === 'SUMMARY' || role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem') {
      out.push('click', 'hover');
      return out;
    }
    out.push('click', 'hover');
    return out;
  };
  const regionOf = (el) => {
    const map = { HEADER: 'header', NAV: 'nav', MAIN: 'main', FOOTER: 'footer', ASIDE: 'aside', FORM: 'form', DIALOG: 'dialog', SECTION: 'section' };
    let node = el;
    while (node && node !== document.body) {
      const r = (node.getAttribute && node.getAttribute('role') || '').toLowerCase();
      if (r === 'dialog' || r === 'alertdialog') return { region: 'dialog', regionName: clean(node.getAttribute('aria-label') || '') || undefined };
      const name = map[node.tagName];
      if (name) {
        return { region: name, regionName: clean(node.getAttribute('aria-label') || '') || undefined };
      }
      node = node.parentElement;
    }
    return { region: 'page' };
  };
`;

/** Build the self-contained expression. Callers only ever pass plain JSON-able options. */
export function controlFactsExpression(opts: ControlFactsOptions = {}): string {
  const options = {
    selector: opts.selector,
    ids: Array.isArray(opts.ids) && opts.ids.length ? opts.ids.slice(0, 200) : undefined,
    limit: opts.limit && opts.limit > 0 ? Math.min(opts.limit, 500) : 200,
    includeOffscreen: opts.includeOffscreen !== false,
    skipHitTest: opts.skipHitTest === true,
    deep: opts.deep === true,
    markIdBase: Number.isFinite(opts.markIdBase) ? Number(opts.markIdBase) : undefined,
    component: opts.component === true,
  };
  return `(() => {
    const opts = ${JSON.stringify(options)};
    ${HELPERS}
    ${options.component ? COMPONENT_SIGNATURE_HELPERS : ''}
    const SEL = 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="combobox"],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"])';
    let nodes;
    const deepQuery = (root) => {
      if (!opts.deep) return Array.from(root.querySelectorAll(SEL));
      const roots = [];
      const walk = (r) => {
        roots.push(r);
        for (const el of r.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(root);
      const out = [];
      for (const r of roots) for (const el of r.querySelectorAll(SEL)) out.push(el);
      return out;
    };
    // A shadow control's hit-test returns the host, and contains() does not cross the boundary.
    const containsComposed = (a, b) => {
      let n = b;
      while (n) {
        if (n === a) return true;
        n = n.parentNode || n.host || null;
      }
      return false;
    };
    const hitAt = (x, y) => {
      let el = document.elementFromPoint(x, y);
      while (opts.deep && el && el.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
      }
      return el;
    };
    if (opts.ids && opts.ids.length) {
      nodes = opts.ids.map((id) => document.querySelector('[data-mark-id="' + id + '"]')).filter(Boolean);
    } else {
      const root = opts.selector ? document.querySelector(opts.selector) : document.body;
      if (!root) return { error: 'root not found', controls: [] };
      nodes = opts.selector && root.matches && root.matches(SEL) ? [root] : deepQuery(root);
    }
    const out = [];
    for (const el of nodes) {
      if (out.length >= opts.limit) break;
      const rect = el.getBoundingClientRect();
      if (!opts.includeOffscreen && (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth)) continue;
      const visible = isVisible(el, rect);
      // A disabled control still matters (the guard must be able to say "this cannot be clicked"),
      // so it is described with an empty action list rather than dropped.
      const actions = actionsFor(el);
      let occluded = false;
      if (visible && !opts.skipHitTest && rect.top < window.innerHeight && rect.bottom > 0) {
        // Centre of the visible portion (a tall element's geometric centre can be off-screen).
        const left = Math.max(rect.left, 0);
        const right = Math.min(rect.right, window.innerWidth);
        const top = Math.max(rect.top, 0);
        const bottom = Math.min(rect.bottom, window.innerHeight);
        if (right > left && bottom > top) {
          const hit = hitAt(Math.round((left + right) / 2), Math.round((top + bottom) / 2));
          occluded = !!(hit && hit !== el && !containsComposed(el, hit) && !containsComposed(hit, el));
        }
      }
      const { region, regionName } = regionOf(el);
      const markAttr = el.getAttribute('data-mark-id');
      let markId = markAttr && !isNaN(Number(markAttr)) ? Number(markAttr) : undefined;
      if (opts.markIdBase !== undefined) {
        markId = opts.markIdBase + out.length;
        el.setAttribute('data-mark-id', String(markId));
      }
      out.push({
        id: markId,
        tag: el.tagName.toLowerCase(),
        role: clean((el.getAttribute('role') || el.tagName).toLowerCase()),
        name: accName(el),
        value: el.value !== undefined && el.value !== '' ? clean(String(el.value)).slice(0, 80) : undefined,
        state: [
          el.disabled ? 'disabled' : '',
          el.getAttribute && el.getAttribute('aria-disabled') === 'true' ? 'aria-disabled' : '',
          el.checked ? 'checked' : '',
          el.getAttribute && el.getAttribute('aria-expanded') === 'true' ? 'expanded' : '',
          el.getAttribute && el.getAttribute('aria-required') === 'true' ? 'required' : '',
        ].filter(Boolean),
        actions,
        visible,
        occluded,
        disabled: !!(el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')),
        region,
        regionName,
        component: opts.component && typeof kqComponentSurface === 'function' ? (kqComponentSurface(el) || undefined) : undefined,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      });
    }
    return { url: location.href, count: out.length, controls: out };
  })()`;
}

/** Parse the expression result into typed facts, tolerating an adapter that returned a string. */
export function parseControlFacts(raw: unknown): { url?: string; controls: ControlFacts[] } {
  let value: any = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { controls: [] };
    }
  }
  const controls = Array.isArray(value?.controls) ? (value.controls as ControlFacts[]) : [];
  return { url: value?.url, controls };
}
