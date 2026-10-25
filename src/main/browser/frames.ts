/**
 * Frame geometry: where each iframe actually sits on the page.
 *
 * An iframe is a separate document. `evaluateInFrames` can already *read* one, but a control
 * inside it has no top-level coordinates — so a click computed from a frame-local rect lands in
 * the wrong place (or nowhere). This module answers only the geometry question:
 *
 *   frame content-box origin (top-level viewport CSS px) + frame-local rect = top-level rect
 *
 * Done over CDP rather than the main document because:
 *   - a cross-origin iframe is still an element in its *parent* document, so `getBoundingClientRect`
 *     on the owner works even when the child cannot be touched;
 *   - the frame tree gives parentage, so nested frames compose instead of falling back to
 *     "in-frame activation";
 *   - `Page.getFrameTree` is the same source `evaluateInFrames` uses, so ids line up.
 *
 * Bounded and opt-in: four CDP commands per frame. Never call this on a hot path.
 */
import type { WebContents } from 'electron';
import { bump } from '../metrics.js';

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameInfo {
  frameId: string;
  parentFrameId?: string;
  /** 0 = main frame. */
  depth: number;
  url: string;
  name: string;
  /** Top-level viewport coordinates of the frame's content box. */
  rect: FrameRect;
  /** The part of `rect` that is inside the viewport, or null when fully outside. */
  visibleRect: FrameRect | null;
  /** Unreachable from the top document (different origin). */
  crossOrigin: boolean;
  /** Why this frame has no geometry, when that is the case. */
  error?: string;
}

const MAX_FRAMES = 16;

interface TreeFrame {
  id: string;
  parentId?: string;
  depth: number;
  url: string;
  name: string;
}

function flatten(tree: any, parentId: string | undefined = undefined, depth = 0, out: TreeFrame[] = []): TreeFrame[] {
  const frame = tree?.frame;
  if (frame?.id) {
    out.push({
      id: frame.id,
      parentId,
      depth,
      url: String(frame.url || ''),
      name: String(frame.name || ''),
    });
  }
  for (const child of tree?.childFrames || []) {
    flatten(child, frame?.id || parentId, depth + 1, out);
  }
  return out;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function intersect(rect: FrameRect, bounds: FrameRect): FrameRect | null {
  const left = Math.max(rect.x, bounds.x);
  const top = Math.max(rect.y, bounds.y);
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  if (right - left < 2 || bottom - top < 2) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * List the main frame and its children with top-level content-box rects.
 * Returns only the main frame when the debugger is not attached (no frame tree available).
 */
export async function listFrames(wc: WebContents, opts: { maxFrames?: number } = {}): Promise<FrameInfo[]> {
  if (!wc || wc.isDestroyed()) return [];
  const dbg = wc.debugger;
  if (!dbg?.isAttached()) return [];

  const maxFrames = Math.max(1, Math.min(opts.maxFrames ?? 8, MAX_FRAMES));

  try {
    await dbg.sendCommand('Page.enable').catch(() => undefined);
    await dbg.sendCommand('DOM.enable').catch(() => undefined);

    bump('cdp.frame');
    const tree = (await dbg.sendCommand('Page.getFrameTree')) as any;
    const treeFrames = flatten(tree?.frameTree).slice(0, maxFrames);
    if (!treeFrames.length) return [];

    const metrics = (await dbg.sendCommand('Page.getLayoutMetrics')) as any;
    const layout = metrics?.cssLayoutViewport || metrics?.layoutViewport || {};
    const viewport: FrameRect = {
      x: 0,
      y: 0,
      width: Number(layout.clientWidth) || 0,
      height: Number(layout.clientHeight) || 0,
    };

    const mainUrl = treeFrames[0]?.url || '';
    const mainOrigin = originOf(mainUrl);
    // Absolute origin per frame. Parents precede children in the tree, so one pass composes.
    const origins = new Map<string, { x: number; y: number }>();
    const out: FrameInfo[] = [];

    for (const frame of treeFrames) {
      if (frame.depth === 0) {
        origins.set(frame.id, { x: 0, y: 0 });
        out.push({
          frameId: frame.id,
          depth: 0,
          url: frame.url,
          name: frame.name,
          rect: { ...viewport },
          visibleRect: viewport.width > 0 && viewport.height > 0 ? { ...viewport } : null,
          crossOrigin: false,
        });
        continue;
      }

      const parentOrigin = frame.parentId ? origins.get(frame.parentId) : undefined;
      const base: FrameInfo = {
        frameId: frame.id,
        parentFrameId: frame.parentId,
        depth: frame.depth,
        url: frame.url,
        name: frame.name,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        visibleRect: null,
        crossOrigin: !!mainOrigin && originOf(frame.url) !== null && originOf(frame.url) !== mainOrigin,
      };

      if (!parentOrigin) {
        out.push({ ...base, error: 'parent frame has no geometry' });
        continue;
      }

      try {
        bump('cdp.frame');
        const owner = (await dbg.sendCommand('DOM.getFrameOwner', { frameId: frame.id })) as any;
        if (!owner?.backendNodeId) throw new Error('frame has no owner element');

        // Resolve the <iframe> in its parent's document and measure it there. This is the only
        // way to get a cross-origin frame's rect: the child is unreachable, its owner is not.
        const resolved = (await dbg.sendCommand('DOM.resolveNode', { backendNodeId: owner.backendNodeId })) as any;
        const objectId = resolved?.object?.objectId;
        if (!objectId) throw new Error('owner element could not be resolved');

        const measured = (await dbg.sendCommand('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: `function () {
            const r = this.getBoundingClientRect();
            return {
              x: r.left + (this.clientLeft || 0),
              y: r.top + (this.clientTop || 0),
              width: this.clientWidth || r.width,
              height: this.clientHeight || r.height,
              laidOut: r.width > 0 && r.height > 0,
            };
          }`,
          returnByValue: true,
        })) as any;

        const local = measured?.result?.value;
        if (!local?.laidOut) {
          out.push({ ...base, error: 'frame is not laid out' });
          origins.set(frame.id, { ...parentOrigin });
          continue;
        }

        const rect: FrameRect = {
          x: Math.round(parentOrigin.x + Number(local.x || 0)),
          y: Math.round(parentOrigin.y + Number(local.y || 0)),
          width: Math.round(Number(local.width) || 0),
          height: Math.round(Number(local.height) || 0),
        };
        origins.set(frame.id, { x: rect.x, y: rect.y });
        out.push({ ...base, rect, visibleRect: intersect(rect, viewport) });
      } catch (err: any) {
        out.push({ ...base, error: String(err?.message || err) });
        origins.set(frame.id, { ...parentOrigin });
      }
    }

    return out;
  } catch (err: any) {
    return [];
  }
}
