/**
 * Text-anchored targeting.
 *
 * Some of the most-clickable things on the web have no semantics at all: React cards are a plain
 * <div> with an onClick prop three levels up, no role, no href, no `onclick` attribute. Guessing a
 * "card-like" selector produces either nothing or a giant wrapper whose centre is a *different*
 * widget (a trending list, an ad slot), and clicking that is worse than failing.
 *
 * A human clicks the words. This resolves the deepest visible element whose own text matches,
 * which gives a point inside the real content — and the click bubbles to whatever handler the
 * framework attached. Deterministic, no layout guessing.
 */
import type { WebContents } from 'electron';

export interface TextTargetOptions {
  /** Exact (trimmed) match instead of substring. Default false. */
  exact?: boolean;
  /** Case sensitive. Default false. */
  caseSensitive?: boolean;
  /** Maximum candidates to return (default 8). */
  max?: number;
}

export interface TextTargetMatch {
  text: string;
  tag: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Index among the returned matches (0 = first in document order). */
  index: number;
}

export interface TextTargetResult {
  query: string;
  matches: TextTargetMatch[];
  /** True when one match is unambiguous enough to click. */
  unique: boolean;
}

const TAGS = 'a,button,div,span,p,li,td,th,section,article,header,footer,h1,h2,h3,h4,h5,h6,label,strong,em';

/**
 * Deepest visible element whose trimmed text matches. "Deepest" matters: a card <div> and its
 * title <span> both match, and the span's centre is the pixels a person would aim at.
 */
export function textTargetExpression(query: string, options: TextTargetOptions = {}): string {
  const opts = {
    query: String(query),
    exact: options.exact === true,
    caseSensitive: options.caseSensitive === true,
    max: Math.max(1, Math.min(options.max ?? 8, 25)),
  };
  return `(() => {
    const opts = ${JSON.stringify(opts)};
    const raw = opts.query.replace(/\\s+/g, ' ').trim();
    const needle = opts.caseSensitive ? raw : raw.toLowerCase();
    if (!needle) return { query: raw, matches: [], unique: false };
    const matches = [];
    const seen = new Set();
    const els = document.querySelectorAll(${JSON.stringify(TAGS)});
    for (const el of els) {
      if (matches.length >= opts.max) break;
      const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      if (!text) continue;
      if (text.length > 400) continue; // a wrapper, not the content
      const hay = opts.caseSensitive ? text : text.toLowerCase();
      const hit = opts.exact ? hay === needle : hay.indexOf(needle) !== -1;
      if (!hit) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      if (el.closest('[aria-hidden="true"], [hidden], [inert]')) continue;
      // Prefer the deepest node: skip any element that has a child matching the same text.
      const childHit = Array.from(el.children).some((c) => {
        const ct = (c.innerText || '').replace(/\\s+/g, ' ').trim();
        const ch = opts.caseSensitive ? ct : ct.toLowerCase();
        return ct && (opts.exact ? ch === needle : ch.indexOf(needle) !== -1);
      });
      if (childHit) continue;
      const key = text + '|' + Math.round(rect.left) + '|' + Math.round(rect.top);
      if (seen.has(key)) continue;
      seen.add(key);
      // Visible portion centre (tall elements can extend past the viewport).
      const left = Math.max(rect.left, 0);
      const right = Math.min(rect.right, window.innerWidth);
      const top = Math.max(rect.top, 0);
      const bottom = Math.min(rect.bottom, window.innerHeight);
      if (right <= left || bottom <= top) continue;
      matches.push({
        text: text.slice(0, 80),
        tag: el.tagName.toLowerCase(),
        x: Math.round((left + right) / 2),
        y: Math.round((top + bottom) / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        index: matches.length,
      });
    }
    return { query: raw, matches, unique: matches.length === 1 };
  })()`;
}

export function parseTextTargets(raw: unknown): TextTargetResult {
  let value: any = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { query: '', matches: [], unique: false };
    }
  }
  const matches = Array.isArray(value?.matches) ? (value.matches as TextTargetMatch[]) : [];
  return { query: String(value?.query || ''), matches, unique: value?.unique === true };
}

/** Convenience for callers that already hold a WebContents. */
export async function resolveTextTargets(
  wc: WebContents,
  query: string,
  options: TextTargetOptions = {}
): Promise<TextTargetResult> {
  if (!wc || wc.isDestroyed()) return { query, matches: [], unique: false };
  const raw = await wc.executeJavaScript(textTargetExpression(query, options)).catch(() => null);
  return parseTextTargets(raw);
}
