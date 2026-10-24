/**
 * Frame-scoped evaluation.
 *
 * `webContents.executeJavaScript` only sees the main frame. Consent walls (Sourcepoint), embedded
 * checkouts and some widget forms live in cross-origin child frames, so the main-frame DOM scan
 * cannot answer them — which is why a CMP can be "detected" and still be unclickable.
 *
 * This walks the CDP frame tree and evaluates the same expression in each frame's own isolated
 * world. Deliberately opt-in and bounded: every frame costs two CDP commands, so callers choose
 * the frame budget and nobody runs this on a hot path.
 *
 * Reuse (Phase 2+): marks, consent, extract. Keep it dependency-free.
 */
import type { WebContents } from 'electron';
import { bump } from '../metrics.js';

export interface FrameEvalOptions {
  /** Frames to visit, breadth-first including the main frame (default 8). */
  maxFrames?: number;
  /** Per-command timeout (default 1500ms). */
  timeoutMs?: number;
  /** Include about:blank / empty frames (default false). */
  includeBlank?: boolean;
}

export interface FrameEvalResult {
  frameId: string;
  url?: string;
  name?: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface FrameCacheEntry {
  loaderId: string;
  contextId: number;
  pageEnabled: boolean;
}

/** Per-webContents cache: isolated worlds survive until the document is replaced. */
const frameCache = new WeakMap<WebContents, Map<string, FrameCacheEntry>>();

function cacheFor(wc: WebContents): Map<string, FrameCacheEntry> {
  let cache = frameCache.get(wc);
  if (!cache) {
    cache = new Map();
    frameCache.set(wc, cache);
    // A new document invalidates every context id for this webContents.
    wc.on('did-start-loading', () => cache!.clear());
  }
  return cache;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function flatten(tree: any, out: Array<{ id: string; url?: string; name?: string; loaderId?: string }> = []): typeof out {
  const frame = tree?.frame;
  if (frame?.id) out.push({ id: frame.id, url: frame.url, name: frame.name, loaderId: frame.loaderId });
  for (const child of tree?.childFrames || []) flatten(child, out);
  return out;
}

/**
 * Evaluate `expression` in the main frame and up to `maxFrames` child frames.
 * Never throws: a frame that fails (detached, sandboxed, timed out) is reported with `ok:false`.
 */
export async function evaluateInFrames(
  wc: WebContents,
  expression: string,
  options: FrameEvalOptions = {}
): Promise<FrameEvalResult[]> {
  if (!wc || wc.isDestroyed()) return [];
  const maxFrames = Math.max(1, Math.min(options.maxFrames ?? 8, 32));
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 1500, 10000));
  const includeBlank = options.includeBlank === true;

  const dbg = wc.debugger;
  // The app attaches the debugger for trusted CDP input; without it there is nothing to walk.
  if (!dbg?.isAttached()) return [];

  const cache = cacheFor(wc);
  const mainEntry = cache.get('__page__');
  const pageEnabled = mainEntry?.pageEnabled === true;

  try {
    if (!pageEnabled) {
      bump('cdp.frame');
      await withTimeout(dbg.sendCommand('Page.enable'), timeoutMs, 'Page.enable');
      cache.set('__page__', { loaderId: '', contextId: 0, pageEnabled: true });
    }
    bump('cdp.frame');
    const tree = (await withTimeout(dbg.sendCommand('Page.getFrameTree'), timeoutMs, 'Page.getFrameTree')) as any;
    const frames = flatten(tree?.frameTree).slice(0, maxFrames);
    const results: FrameEvalResult[] = [];

    for (const frame of frames) {
      const blank = !frame.url || frame.url === 'about:blank' || frame.url === 'about:srcdoc';
      if (blank && !includeBlank) {
        results.push({ frameId: frame.id, url: frame.url, name: frame.name, ok: false, error: 'blank frame skipped' });
        continue;
      }

      try {
        let entry = cache.get(frame.id);
        // A new loaderId means the document (and therefore the isolated world) is gone.
        if (!entry || (frame.loaderId && entry.loaderId && entry.loaderId !== frame.loaderId)) {
          const world = (await withTimeout(
            dbg.sendCommand('Page.createIsolatedWorld', {
              frameId: frame.id,
              worldName: 'kuang-probe',
              grantUniveralAccess: false,
            }),
            timeoutMs,
            'Page.createIsolatedWorld'
          )) as any;
          entry = { loaderId: frame.loaderId || '', contextId: Number(world?.executionContextId) || 0, pageEnabled: true };
          if (entry.contextId) cache.set(frame.id, entry);
        }
        if (!entry?.contextId) throw new Error('no execution context');

        const evaluated = (await withTimeout(
          dbg.sendCommand('Runtime.evaluate', {
            expression,
            contextId: entry.contextId,
            returnByValue: true,
            awaitPromise: true,
            userGesture: false,
          }),
          timeoutMs,
          'Runtime.evaluate'
        )) as any;

        if (evaluated?.exceptionDetails) {
          const detail = evaluated.exceptionDetails;
          results.push({
            frameId: frame.id,
            url: frame.url,
            name: frame.name,
            ok: false,
            error: detail?.exception?.description || detail?.text || 'frame exception',
          });
          continue;
        }
        results.push({ frameId: frame.id, url: frame.url, name: frame.name, ok: true, value: evaluated?.result?.value });
      } catch (err: any) {
        // A stale context is normal after a frame swaps document; drop it so the next call re-creates.
        cache.delete(frame.id);
        results.push({ frameId: frame.id, url: frame.url, name: frame.name, ok: false, error: String(err?.message || err) });
      }
    }
    return results;
  } catch (err: any) {
    return [{ frameId: 'main', ok: false, error: String(err?.message || err) }];
  }
}
