/**
 * Shadow-DOM-aware element resolution for the interaction path.
 *
 * `document.querySelector` cannot cross a shadow boundary, and neither can a CSS
 * selector — so on a page built from web components (login/signup forms, design-system
 * dialogs) a selector like `#email` or `faceplate-text-input` resolves to the *host*,
 * never the `<input>` that actually takes focus and text. The field notes for the
 * 2026-10-20 signup run are the worked example: `act({selector, action:"type"})` reported
 * success while the value never changed, because the click landed on the host's centre
 * (often a label) and the follow-up `el.focus()` was applied to the host.
 *
 * These helpers resolve a selector to the element a *mouse* would hit — the deepest
 * control painted at the host's centre, or the first control inside it — and report the
 * deepest focused element (`document.activeElement` is the host, `shadowRoot.activeElement`
 * is the real input).
 *
 * They are page-side source strings, evaluated through the host's `evaluate`.
 */

/** Shared helper functions, inlined into every script below. */
export const DEEP_DOM_HELPERS = `
function kqDeep(selector, root) {
  root = root || document;
  let direct = null;
  try { direct = root.querySelector(selector); } catch (e) { return null; }
  if (direct) return direct;
  const all = root.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.shadowRoot) {
      const hit = kqDeep(selector, el.shadowRoot);
      if (hit) return hit;
    }
  }
  return null;
}
function kqAtPoint(x, y) {
  let el = document.elementFromPoint(x, y);
  let guard = 0;
  while (el && el.shadowRoot && guard++ < 25) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}
function kqIsControl(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}
function kqIsAction(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute ? (el.getAttribute('role') || '') : '';
  return tag === 'a' || tag === 'button' || role === 'button' || role === 'link';
}
function kqFirstControl(root) {
  if (root.shadowRoot) {
    const inShadow = kqFirstControl(root.shadowRoot);
    if (inShadow) return inShadow;
  }
  const direct = root.querySelectorAll('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]');
  for (let i = 0; i < direct.length; i++) {
    if (!direct[i].disabled) return direct[i];
  }
  const all = root.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].shadowRoot) {
      const hit = kqFirstControl(all[i].shadowRoot);
      if (hit) return hit;
    }
  }
  return null;
}
function kqResolveControl(host) {
  if (!host) return null;
  if (kqIsControl(host) || kqIsAction(host)) return host;
  const r = host.getBoundingClientRect ? host.getBoundingClientRect() : null;
  if (r && r.width > 0 && r.height > 0) {
    // What an actual mouse would hit at the host's centre.
    const at = kqAtPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    if (at && kqIsControl(at)) return at;
  }
  // Contenteditable hosts / detached-at-centre cases: take the first control inside.
  return kqFirstControl(host) || host;
}
function kqComposedParent(node) {
  if (!node) return null;
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode ? node.getRootNode() : null;
  return root && root.host ? root.host : null;
}
function kqClosest(node, selector) {
  let el = node;
  let guard = 0;
  while (el && guard++ < 200) {
    if (el.matches && el.matches(selector)) return el;
    el = kqComposedParent(el);
  }
  return null;
}
function kqContainsComposed(ancestor, node) {
  let cur = node;
  let guard = 0;
  while (cur && guard++ < 200) {
    if (cur === ancestor) return true;
    cur = kqComposedParent(cur);
  }
  return false;
}
/**
 * Pick a point that actually belongs to the element. Large card links (Reddit posts, product tiles)
 * routinely have their geometric centre covered by a nested overlay/thumbnail, so clicking the centre
 * hits a sibling and nothing happens. Try the centre, then a few offsets, and require the hit to be
 * the element itself or a descendant of it.
 */
function kqSafePoint(el) {
  const r = el.getBoundingClientRect();
  // Work in the VISIBLE portion: a card taller than the viewport has its geometric centre
  // off-screen, where elementFromPoint returns null and every offset "fails".
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(r.left, 0);
  const right = Math.min(r.right, vw);
  const top = Math.max(r.top, 0);
  const bottom = Math.min(r.bottom, vh);
  const box = right > left && bottom > top ? { left: left, top: top, width: right - left, height: bottom - top } : { left: r.left, top: r.top, width: r.width, height: r.height };
  const offsets = [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.5, 0.18], [0.5, 0.82], [0.18, 0.5], [0.82, 0.5]];
  for (let i = 0; i < offsets.length; i++) {
    const x = Math.round(box.left + box.width * offsets[i][0]);
    const y = Math.round(box.top + box.height * offsets[i][1]);
    if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
    const hit = kqAtPoint(x, y);
    if (hit && (hit === el || kqContainsComposed(el, hit))) return { x: x, y: y, covered: false };
  }
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2), covered: true };
}
function kqActive() {  let el = document.activeElement;
  let guard = 0;
  while (el && el.shadowRoot && el.shadowRoot.activeElement && guard++ < 25) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}
function kqValue(el) {
  if (!el) return '';
  if (el.isContentEditable === true) return String(el.textContent || '');
  if (el.tagName && el.tagName.toLowerCase() === 'select') {
    const opt = el.options ? el.options[el.selectedIndex] : null;
    return opt ? String(opt.value || opt.textContent || '') : '';
  }
  return el.value === undefined || el.value === null ? '' : String(el.value);
}
function kqLabel(el) {
  if (!el || !el.getAttribute) return '';
  return String(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || '').trim().slice(0, 60);
}
function kqDescribe(el) {
  if (!el || !el.tagName) return null;
  const tag = el.tagName.toLowerCase();
  return {
    tag: tag,
    id: el.id || undefined,
    label: kqLabel(el) || undefined,
    valueLength: kqValue(el).length,
    control: kqIsControl(el),
  };
}
`;

export interface TargetLocator {
  markId?: number;
  selector?: string;
  point?: { x: number; y: number };
}

/** A page-side expression yielding the addressed element (shadow-aware for selectors). */
export function elementExpr(locator: TargetLocator): string {
  if (locator.markId !== undefined && locator.markId !== null) {
    return `kqDeep('[data-mark-id="${locator.markId}"]')`;
  }
  if (locator.selector) return `kqDeep(${JSON.stringify(locator.selector)})`;
  if (locator.point) return `kqAtPoint(${Math.round(locator.point.x)}, ${Math.round(locator.point.y)})`;
  return 'null';
}

export interface TargetBox {
  x: number;
  y: number;
  tag: string;
  hostTag: string;
  /** True when the resolved element is a text/value control rather than the host. */
  control: boolean;
  /** False when the selector resolved through a shadow root to a deeper element. */
  sameAsHost: boolean;
  text: string;
  /** Live viewport size — 0 means the tab was never laid out, so the box is meaningless. */
  vw: number;
  vh: number;
  /** Whether the resolved centre falls inside the viewport. */
  inViewport: boolean;
}

/**
 * Resolve a locator to the box of the **control** to act on, scrolling it into view.
 * `elementFromPoint`-free for point locators (a point is already a viewport coordinate,
 * and re-scrolling it would invalidate the caller's coordinates).
 */
export function targetBoxScript(locator: TargetLocator): string {
  const scroll = locator.point ? '' : 'try { host.scrollIntoView({ behavior: "auto", block: "center" }); } catch (e) {}';
  return `(() => {${DEEP_DOM_HELPERS}
  const host = ${elementExpr(locator)};
  if (!host) return null;
  ${scroll}
  const target = ${locator.point ? 'host' : 'kqResolveControl(host)'};
  if (!target) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const point = kqSafePoint(target);
  const x = point.x;
  const y = point.y;
  return {
    x: x,
    y: y,
    tag: (target.tagName || '').toLowerCase(),
    hostTag: (host.tagName || '').toLowerCase(),
    control: kqIsControl(target),
    sameAsHost: target === host,
    text: String(target.innerText || target.textContent || kqLabel(target) || '').trim().slice(0, 80),
    vw: vw,
    vh: vh,
    inViewport: x >= 0 && y >= 0 && x <= vw && y <= vh,
  };
})()`;
}

/**
 * Typed facts about the control a locator addresses — the same shape as the previous
 * light-DOM probe, but resolved through shadow roots, so a web-component field reports
 * `tag: "input"` (not the host) and its real value length.
 */
export function fieldFactsScript(locator: TargetLocator): string {
  return `(() => {${DEEP_DOM_HELPERS}
  const host = ${elementExpr(locator)};
  if (!host) return null;
  const el = ${locator.point ? 'host' : 'kqResolveControl(host)'};
  if (!el) return null;
  if (!kqIsControl(el)) return null;
  const tag = el.tagName.toLowerCase();
  const value = kqValue(el);
  return {
    tag: tag,
    type: el.getAttribute('type') || undefined,
    role: el.getAttribute('role') || undefined,
    name: kqLabel(el) || undefined,
    valueLength: value.length,
    isEmpty: value.length === 0,
    prefilled: value.length > 0,
    editable: !el.disabled && !el.readOnly,
    required: el.required === true,
    disabled: el.disabled === true,
    inShadowRoot: Boolean(el.getRootNode && el.getRootNode() !== document && el.getRootNode().host),
  };
})()`;
}

/**
 * Focus the resolved control and report where focus actually ended up.
 *
 * Applied to the **control**, never the custom-element host: `host.focus()` either
 * steals focus from the inner `<input>` or does nothing, and either way the following
 * keystrokes go nowhere. Returns the resulting deep active element so the caller can
 * see a focus failure instead of inferring it later.
 */
export function focusControlScript(locator: TargetLocator): string {
  return `(() => {${DEEP_DOM_HELPERS}
  const host = ${elementExpr(locator)};
  if (!host) return null;
  const el = kqResolveControl(host);
  if (!el || !kqIsControl(el)) return { focused: null, tag: el && el.tagName ? el.tagName.toLowerCase() : null };
  try { el.focus({ preventScroll: true }); } catch (e) {}
  const active = kqActive();
  return {
    focused: active === el,
    tag: (el.tagName || '').toLowerCase(),
    activeTag: active && active.tagName ? active.tagName.toLowerCase() : null,
    activeId: active && active.id ? active.id : null,
  };
})()`;
}

/** Page/window diagnostics including the **deepest** focused element. */export function diagnosticsScript(): string {
  return `(() => {${DEEP_DOM_HELPERS}
  const active = kqActive();
  return {
    w: window.innerWidth,
    h: window.innerHeight,
    active: active ? { tag: (active.tagName || '').toLowerCase(), id: active.id || undefined, label: kqLabel(active) || undefined } : null,
    hasFocus: document.hasFocus(),
  };
})()`;
}

/**
 * Install a one-shot input probe around a typing action: snapshot the addressed control's
 * value, then count the trusted key/input events that reach the page.
 *
 * This is the evidence that separates the two failure classes seen in the field — "our
 * input never arrived" (focus/window) from "the control received the keys and refused
 * them" (one-time-code fields, which revert on input). Only lengths and counters leave the
 * page; the value itself never does (so `secret` typing stays secret).
 */
export function inputProbeInstallScript(locator: TargetLocator): string {
  return `(() => {${DEEP_DOM_HELPERS}
  const prev = window.__kuangInputProbe;
  if (prev && prev.detach) prev.detach();
  const host = ${elementExpr(locator)};
  const el = host ? ${locator.point ? 'host' : 'kqResolveControl(host)'} : null;
  // A point inside a closed shadow root resolves to the custom-element host: events still reach
  // the page, but its value is unreadable. Do not pretend that is a failed keystroke.
  const observable = Boolean(el && (kqIsControl(el) || el.isContentEditable === true));
  const state = {
    target: el,
    value: kqValue(el),
    observable: observable,
    keydowns: 0,
    beforeinputs: 0,
    inputs: 0,
  };
  const listen = (type, key) => {
    const handler = (e) => { if (e.isTrusted) state[key]++; };
    document.addEventListener(type, handler, true);
    return [type, handler];
  };
  const bound = [listen('keydown', 'keydowns'), listen('beforeinput', 'beforeinputs'), listen('input', 'inputs')];
  state.detach = () => { for (const [type, handler] of bound) document.removeEventListener(type, handler, true); };
  window.__kuangInputProbe = state;
  return { installed: true, found: Boolean(el), control: el ? kqIsControl(el) : false, observable: observable, tag: el && el.tagName ? el.tagName.toLowerCase() : null };
})()`;
}

/** Read and remove the probe installed by {@link inputProbeInstallScript}. */
export function inputProbeReadScript(): string {
  return `(() => {${DEEP_DOM_HELPERS}
  const s = window.__kuangInputProbe;
  if (!s) return null;
  if (s.detach) s.detach();
  const el = s.target;
  const beforeLength = String(s.value || '').length;
  if (!el || !el.isConnected) {
    // The control was re-rendered mid-type (React/Lit swap): the after-value is
    // unknowable, so report no verdict rather than a false one.
    delete window.__kuangInputProbe;
    return { beforeLength: beforeLength, afterLength: null, changed: null, detached: true, keydowns: s.keydowns, beforeinputs: s.beforeinputs, inputs: s.inputs };
  }
  const after = kqValue(el);
  const out = {
    beforeLength: beforeLength,
    afterLength: after.length,
    changed: after !== s.value,
    observable: s.observable !== false,
    detached: false,
    keydowns: s.keydowns,
    beforeinputs: s.beforeinputs,
    inputs: s.inputs,
  };
  delete window.__kuangInputProbe;
  return out;
})()`;
}
