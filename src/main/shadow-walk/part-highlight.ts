/**
 * partHighlight — draw the exported parts of open web components for one screenshot.
 *
 * The lever is VISIBLE: it injects a stylesheet into the page, so the page (and a human watching)
 * can see it. The stylesheet is removed immediately after the capture; it is not persistent state.
 *
 * Only open roots are enumerable from page JS. Closed roots are covered by the sealed/force-open
 * paths, not by this visual aid.
 */
import type { WebContents } from 'electron';
import { bump } from '../metrics.js';
import { loadShadowWalkSettings } from './settings.js';
import { buildPartHighlightCss, type PartHost } from './part-highlight-css.js';

export type { PartHost } from './part-highlight-css.js';
export { buildPartHighlightCss } from './part-highlight-css.js';

const STYLE_ID = 'kuang-part-highlight';

const COLLECT_SCRIPT = `(() => {
  const out = new Map();
  const add = (tag, names) => {
    if (!tag) return;
    const key = tag.toLowerCase();
    if (!out.has(key)) out.set(key, new Set());
    for (const n of names) if (n) out.get(key).add(String(n).trim());
  };
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (!el.shadowRoot) continue;
      const tag = el.tagName.toLowerCase();
      const names = [];
      // Parts declared inside the shadow root, plus outer aliases from exportparts.
      for (const inner of el.shadowRoot.querySelectorAll('[part]')) {
        for (const p of (inner.getAttribute('part') || '').split(/\\s+/)) if (p) names.push(p);
      }
      for (const mapping of (el.getAttribute('exportparts') || '').split(',')) {
        const exported = mapping.split(':')[1];
        if (exported && exported.trim()) names.push(exported.trim());
      }
      for (const p of (el.getAttribute('part') || '').split(/\\s+/)) if (p) names.push(p);
      add(tag, names);
      walk(el.shadowRoot);
    }
  };
  walk(document);
  return [...out.entries()].map(([tag, parts]) => ({ tag, parts: [...parts] }));
})()`;

function insertScript(css: string): string {
  return `(() => {
    const id = ${JSON.stringify(STYLE_ID)};
    const old = document.getElementById(id);
    if (old) old.remove();
    if (!${JSON.stringify(css)}) return 0;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = ${JSON.stringify(css)};
    document.documentElement.appendChild(style);
    return 1;
  })()`;
}

export async function injectPartHighlight(wc: WebContents): Promise<number> {
  if (!wc || wc.isDestroyed()) return 0;
  try {
    const hosts = await wc.executeJavaScript(COLLECT_SCRIPT);
    const css = buildPartHighlightCss(Array.isArray(hosts) ? hosts : []);
    if (!css) return 0;
    await wc.executeJavaScript(insertScript(css));
    bump('parthighlight.inject');
    return (Array.isArray(hosts) ? hosts : []).length;
  } catch {
    return 0;
  }
}

export async function removePartHighlight(wc: WebContents): Promise<void> {
  if (!wc || wc.isDestroyed()) return;
  await wc
    .executeJavaScript(`(() => { const el = document.getElementById(${JSON.stringify(STYLE_ID)}); if (el) el.remove(); })()`)
    .catch(() => undefined);
}

/** Run a screenshot capture with exported parts outlined when the lever is on. */
export async function withPartHighlight<T>(wc: WebContents, fn: () => Promise<T>): Promise<T> {
  if (!loadShadowWalkSettings().shadow.partHighlight) return fn();
  await injectPartHighlight(wc);
  try {
    return await fn();
  } finally {
    await removePartHighlight(wc);
  }
}
