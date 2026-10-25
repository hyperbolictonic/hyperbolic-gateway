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
 *   - cross-site frames are out-of-process and absent from the tab's `Page.getFrameTree`, so
 *     `frame-tree.ts` merges the detached `iframe` targets first.
 *
 * Bounded and opt-in: a handful of CDP commands per frame. Never call this on a hot path.
 */
import type { WebContents } from 'electron';
import { discoverFrames } from './frame-tree.js';

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
  /** Hosted by a separate CDP target (cross-site / OOPIF). */
  oopif: boolean;
  /** Target that hosts an OOPIF frame, when `oopif`. */
  targetId?: string;
  /** Why this frame has no geometry, when that is the case. */
  error?: string;
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
  if (!wc.debugger?.isAttached()) return [];

  const maxFrames = Math.max(1, Math.min(opts.maxFrames ?? 8, 16));
  const ctx = await discoverFrames(wc, { maxFrames });
  if (!ctx.frames.length) {
    await ctx.release();
    return [];
  }

  try {
    const metrics = (await ctx.send(undefined, 'Page.getLayoutMetrics')) as any;
    const layout = metrics?.cssLayoutViewport || metrics?.layoutViewport || {};
    const viewport: FrameRect = {
      x: 0,
      y: 0,
      width: Number(layout.clientWidth) || 0,
      height: Number(layout.clientHeight) || 0,
    };

    const mainUrl = ctx.frames.find((f) => f.depth === 0)?.url || '';
    const mainOrigin = originOf(mainUrl);
    // Absolute origin per frame. Parents precede children, so one pass composes.
    const origins = new Map<string, { x: number; y: number }>();
    const out: FrameInfo[] = [];

    for (const frame of ctx.frames) {
      if (frame.depth === 0) {
        origins.set(frame.frameId, { x: 0, y: 0 });
        out.push({
          frameId: frame.frameId,
          depth: 0,
          url: frame.url,
          name: frame.name,
          rect: { ...viewport },
          visibleRect: viewport.width > 0 && viewport.height > 0 ? { ...viewport } : null,
          crossOrigin: false,
          oopif: false,
        });
        continue;
      }

      const parentOrigin = frame.parentFrameId ? origins.get(frame.parentFrameId) : undefined;
      const parentSession = frame.parentFrameId ? ctx.sessionFor(frame.parentFrameId) : undefined;
      const base: FrameInfo = {
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        depth: frame.depth,
        url: frame.url,
        name: frame.name,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        visibleRect: null,
        crossOrigin: !!mainOrigin && originOf(frame.url) !== null && originOf(frame.url) !== mainOrigin,
        oopif: frame.oopif,
        targetId: frame.targetId,
      };

      if (!parentOrigin) {
        out.push({ ...base, error: 'parent frame has no geometry' });
        continue;
      }

      try {
        const owner = (await ctx.send(parentSession, 'DOM.getFrameOwner', { frameId: frame.frameId })) as any;
        if (!owner?.backendNodeId) throw new Error('frame has no owner element');

        // Resolve the <iframe> in its parent's document and measure it there. This is the only
        // way to get a cross-site frame's rect: the child is unreachable, its owner is not.
        const resolved = (await ctx.send(parentSession, 'DOM.resolveNode', {
          backendNodeId: owner.backendNodeId,
        })) as any;
        const objectId = resolved?.object?.objectId;
        if (!objectId) throw new Error('owner element could not be resolved');

        const measured = (await ctx.send(parentSession, 'Runtime.callFunctionOn', {
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
          continue;
        }

        const rect: FrameRect = {
          x: Math.round(parentOrigin.x + Number(local.x || 0)),
          y: Math.round(parentOrigin.y + Number(local.y || 0)),
          width: Math.round(Number(local.width) || 0),
          height: Math.round(Number(local.height) || 0),
        };
        origins.set(frame.frameId, { x: rect.x, y: rect.y });
        out.push({ ...base, rect, visibleRect: intersect(rect, viewport) });
      } catch (err: any) {
        // No origin fallback: a child of a failed frame must fail too, not silently inherit.
        out.push({ ...base, error: String(err?.message || err) });
      }
    }

    return out;
  } catch {
    return [];
  } finally {
    await ctx.release();
  }
}
