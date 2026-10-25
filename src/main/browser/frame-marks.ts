/**
 * Frame control marks.
 *
 * Main-frame marks live in `data-mark-id="1..99"`. A child frame is a separate document with its
 * own DOM, so it gets its own block (`100 + child_index * 100`, 99 ids per frame). The registry
 * maps a stamped id back to the frame that owns it; resolution is live (scroll + measure), so a
 * mark click uses the element's current position rather than a stale coordinate.
 *
 * Same-site and OOPIF frames both go through `evaluateInFrames`, which already knows the right
 * session. This module is deliberately small; the frame scan in `browser-chassis.ts` stamps and
 * registers, and clicks resolve through here.
 */
import type { WebContents } from 'electron';
import type { MarkItem } from '../marks/marks-overlay.js';
import { evaluateInFrames } from './frame-eval.js';
import { listFrames } from './frames.js';

const registry = new WeakMap<WebContents, Map<number, string>>();

export function clearFrameMarks(wc: WebContents): void {
  registry.delete(wc);
}

export function registerFrameMarks(wc: WebContents, entries: Array<{ id: number; frameId: string }>): void {
  if (!wc || !entries.length) return;
  let map = registry.get(wc);
  if (!map) {
    map = new Map();
    registry.set(wc, map);
  }
  for (const entry of entries) {
    if (Number.isFinite(entry.id) && entry.id >= 100) map.set(Number(entry.id), entry.frameId);
  }
}

/**
 * Resolve a frame mark to a live page-space target. Returns null when the frame navigated, the
 * element disappeared, or the id was never registered.
 */
export async function resolveFrameMark(
  wc: WebContents,
  markId: number
): Promise<{ mark: MarkItem; currentCenter: { x: number; y: number } } | null> {
  const frameId = registry.get(wc)?.get(markId);
  if (!frameId) return null;

  const frames = await listFrames(wc, { maxFrames: 16 });
  const frame = frames.find((f) => f.frameId === frameId);
  if (!frame) return null;

  const script = `(() => {
    const el = document.querySelector('[data-mark-id="${Math.floor(markId)}"]');
    if (!el) return null;
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (e) {}
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      width: r.width,
      height: r.height,
      tag: (el.tagName || '').toLowerCase(),
      text: String(el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
    };
  })()`;

  const results = await evaluateInFrames(wc, script, { maxFrames: 16 });
  const result = results.find((r) => r.frameId === frameId);
  const local = result?.value as any;
  if (!result?.ok || !local || typeof local.x !== 'number') return null;

  const rect = {
    x: Math.round(frame.rect.x + Number(local.x) - Number(local.width || 0) / 2),
    y: Math.round(frame.rect.y + Number(local.y) - Number(local.height || 0) / 2),
    width: Math.round(Number(local.width) || 0),
    height: Math.round(Number(local.height) || 0),
  };
  const center = {
    x: Math.round(frame.rect.x + Number(local.x)),
    y: Math.round(frame.rect.y + Number(local.y)),
  };

  return {
    mark: {
      id: markId,
      tag: String(local.tag || '').toUpperCase(),
      text: String(local.text || ''),
      role: undefined,
      actions: ['click'],
      rect,
      center,
      frameId,
      frameUrl: frame.url,
    },
    currentCenter: center,
  };
}
