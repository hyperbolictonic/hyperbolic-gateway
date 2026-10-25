/**
 * Sealed shadow-root discovery.
 *
 * A closed shadow root cannot be read from page JavaScript, by design. It is still in the
 * renderer's accessibility tree, and the DOM agent can describe it when asked to pierce shadow
 * roots — so this module answers one question: *which interactive controls live under a closed
 * root, and where are they on screen?*
 *
 * Deliberate limits:
 *   - It runs only when `find(sealed:true)` asks. Nothing here is called on navigation or idle.
 *   - One AX tree + one pierce per frame set, cached by document revision and held for a few
 *     seconds. A repeat call re-measures only the matched nodes.
 *   - Results carry coordinates and roles, never a mark id and never an input value.
 *   - Full scans are rate-limited; a loop cannot turn the browser into a scanner.
 *
 * Per-frame geometry:
 *   - Same-process frames: `DOM.getBoxModel` already returns top-level viewport pixels.
 *   - OOPIF: its session measures relative to that target's root viewport, so the root frame's
 *     top-level rect is added. Nested OOPIFs compose the same way.
 */
import type { WebContents } from 'electron';
import { bump } from '../metrics.js';
import { listFrames, type FrameInfo } from '../browser/frames.js';
import { normalizeSurface, type ComponentSurface } from './component-signature.js';
import { loadShadowWalkSettings } from './settings.js';

export interface SealedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SealedControl {
  role: string;
  name: string;
  rect: SealedRect;
  actions: string[];
  source: 'ax';
  frameId: string;
  frameUrl?: string;
  inViewport: boolean;
  disabled?: boolean;
  focusable?: boolean;
  focused?: boolean;
  /** Host exported surface, when the control belongs to a custom-element host. */
  component?: ComponentSurface;
}

export interface SealedFindOptions {
  role?: string;
  name?: string;
  contains?: string;
  regex?: string;
  flags?: string;
  tag?: string;
  selector?: string;
  limit?: number;
  includeOffscreen?: boolean;
  /** Bypass the identity cache (use after a DOM change that did not bump the revision). */
  refresh?: boolean;
  /** Chassis revision, so a click invalidates the cached identity list. */
  revision?: number;
}

export interface SealedFindResult {
  controls: SealedControl[];
  /** Matches before the limit / offscreen filter. */
  total: number;
  cached: boolean;
  frames: number;
  scannedAt: number;
  notes: string[];
}

export class SealedRateLimitError extends Error {
  public code = 'SEALED_RATE_LIMITED';
  public retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`Sealed discovery is rate-limited (6 scans/minute per tab); retry in ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = 'SealedRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'slider',
  'spinbutton',
]);

const TYPE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);

const CACHE_TTL_MS = 5000;
const RATE_WINDOW_MS = 60000;
const RATE_LIMIT = 6;
const MAX_LIMIT = 40;
const MAX_FRAMES = 8;
const MAX_TARGETS = 8;

interface Identity {
  backendNodeId: number;
  frameIndex: number;
  role: string;
  name: string;
  nodeName: string;
  actions: string[];
  disabled: boolean;
  focusable: boolean;
  focused: boolean;
  order: number;
  component?: ComponentSurface;
}

interface CacheEntry {
  key: string;
  at: number;
  identities: Identity[];
  notes: string[];
  frames: number;
}

interface TargetSession {
  targetId: string;
  sessionId: string;
}

const caches = new WeakMap<WebContents, CacheEntry>();
const rates = new WeakMap<WebContents, number[]>();

function property(node: any, name: string): any {
  const found = (node?.properties || []).find((p: any) => p?.name === name);
  return found?.value?.value;
}

function actionsFor(role: string, focusable: boolean): string[] {
  if (TYPE_ROLES.has(role)) return ['click', 'type'];
  if (INTERACTIVE_ROLES.has(role)) return ['click'];
  return focusable ? ['focus'] : [];
}

function lower(value: any): string {
  return String(value ?? '').toLowerCase();
}

function viewportOf(metrics: any): SealedRect {
  const layout = metrics?.cssLayoutViewport || metrics?.layoutViewport || {};
  return {
    x: 0,
    y: 0,
    width: Number(layout.clientWidth) || 0,
    height: Number(layout.clientHeight) || 0,
  };
}

/** Walk a DOM tree (already pierced) and index everything under a closed shadow root. */
function collectClosed(root: any): {
  ids: Set<number>;
  info: Map<number, { nodeName: string; order: number; host?: any }>;
} {
  const ids = new Set<number>();
  const info = new Map<number, { nodeName: string; order: number; host?: any }>();
  let order = 0;
  const walk = (node: any, insideClosed: boolean, host: any) => {
    if (!node) return;
    if (insideClosed && node.backendNodeId) {
      ids.add(Number(node.backendNodeId));
      info.set(Number(node.backendNodeId), {
        nodeName: String(node.nodeName || '').toUpperCase(),
        order: order++,
        host,
      });
    }
    for (const child of node.children || []) walk(child, insideClosed, host);
    for (const shadow of node.shadowRoots || []) {
      const closed = shadow.shadowRootType === 'closed';
      // The host of a closed root is the node that owns it; nested hosts replace it for their
      // own descendants.
      walk(shadow, insideClosed || closed, closed ? node : host);
    }
  };
  walk(root, false, undefined);
  return { ids, info };
}

function attributesOf(node: any): Record<string, string> {
  const out: Record<string, string> = {};
  const attrs = node?.attributes || [];
  for (let i = 0; i + 1 < attrs.length; i += 2) out[String(attrs[i])] = String(attrs[i + 1]);
  return out;
}

/**
 * Find interactive controls inside closed shadow roots.
 *
 * Never throws for an ordinary page (missing debugger, frame not attributable); rate limiting is the
 * one deliberate refusal, so an agent loop gets a retry hint instead of silently scanning forever.
 */
export async function findSealedControls(
  wc: WebContents,
  options: SealedFindOptions = {}
): Promise<SealedFindResult> {
  const empty = (notes: string[] = []): SealedFindResult => ({
    controls: [],
    total: 0,
    cached: false,
    frames: 0,
    scannedAt: Date.now(),
    notes,
  });

  if (!wc || wc.isDestroyed()) return empty(['No active tab.']);
  if (!wc.debugger?.isAttached()) return empty(['The CDP debugger is not attached to the active tab.']);
  if (options.selector) {
    const err: any = new Error(
      'Selector filtering is not available for sealed controls; use name, role, tag or contains.'
    );
    err.code = 'NOT_SUPPORTED';
    throw err;
  }

  const frames = await listFrames(wc, { maxFrames: MAX_FRAMES });
  if (!frames.length) return empty(['No frame tree available for the active tab.']);

  const main = frames.find((f) => f.depth === 0);
  if (!main) return empty(['The frame list has no main frame.']);

  const settings = loadShadowWalkSettings();
  const componentsEnabled = settings.shadow.componentSurface;
  const key = [
    main.loaderId || main.url,
    frames.map((f) => `${f.frameId}:${f.depth}:${f.url}`).join(','),
    options.revision ?? 0,
    componentsEnabled ? 'components' : 'plain',
  ].join('|');

  const cache = caches.get(wc);
  let identities: Identity[];
  let notes: string[] = [];
  let cached = false;

  if (!options.refresh && cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    identities = cache.identities;
    notes = cache.notes;
    cached = true;
    bump('sealed.cacheHit');
  } else {
    const now = Date.now();
    const recent = (rates.get(wc) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      throw new SealedRateLimitError(RATE_WINDOW_MS - (now - recent[0]));
    }
    recent.push(now);
    rates.set(wc, recent);

    const dbg = wc.debugger;
    const sessions = new Map<string, TargetSession>();
    const opened: string[] = [];
    const axEnabled = new Set<string | undefined>();
    const cssEnabled = new Set<string | undefined>();
    const surfaceCache = new Map<number, ComponentSurface>();
    const docCache = new Map<string, any>();

    const send = async (sessionId: string | undefined, method: string, params: Record<string, unknown> = {}) => {
      return sessionId
        ? ((await dbg.sendCommand(method as any, params as any, sessionId)) as any)
        : ((await dbg.sendCommand(method as any, params as any)) as any);
    };

    const sessionFor = (frame: FrameInfo | undefined): string | undefined => {
      if (!frame?.oopif || !frame.targetId) return undefined;
      return sessions.get(frame.targetId)?.sessionId;
    };

    const surfaceFor = async (host: any, session: string | undefined): Promise<ComponentSurface | undefined> => {
      const backend = Number(host?.backendNodeId);
      if (!backend) return undefined;
      const cached = surfaceCache.get(backend);
      if (cached) return cached;

      const attrs = attributesOf(host);
      let cssVars: string[] = [];
      try {
        if (!cssEnabled.has(session)) {
          await send(session, 'CSS.enable');
          cssEnabled.add(session);
        }
        if (host.nodeId) {
          const computed = await send(session, 'CSS.getComputedStyleForNode', { nodeId: host.nodeId });
          cssVars = (computed?.computedStyle || [])
            .map((item: any) => String(item?.name || ''))
            .filter((name: string) => name.startsWith('--'))
            .sort();
        }
      } catch {
        // part/exportparts are still useful without computed custom properties.
      }

      const surface = normalizeSurface({
        tag: host.nodeName,
        defined: true,
        part: String(attrs.part || '').split(/\s+/).filter(Boolean),
        exportparts: String(attrs.exportparts || '').split(','),
        cssVars,
      });
      surfaceCache.set(backend, surface);
      return surface;
    };

    try {
      // Attach each OOPIF target once. The same session is reused for every frame it hosts.
      for (const frame of frames) {
        if (!frame.oopif || !frame.targetId || sessions.has(frame.targetId)) continue;
        if (sessions.size >= MAX_TARGETS) break;
        bump('cdp.frame');
        const attached = await send(undefined, 'Target.attachToTarget', {
          targetId: frame.targetId,
          flatten: true,
        });
        if (!attached?.sessionId) continue;
        opened.push(attached.sessionId);
        sessions.set(frame.targetId, { targetId: frame.targetId, sessionId: attached.sessionId });
        await send(attached.sessionId, 'Page.enable').catch(() => undefined);
        await send(attached.sessionId, 'DOM.enable').catch(() => undefined);
      }

      const metrics = await send(undefined, 'Page.getLayoutMetrics').catch(() => null);
      const viewport = viewportOf(metrics);

      const docs = new Map<number, any>();
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        try {
          if (frame.depth === 0) {
            if (!docCache.has('main')) {
              bump('cdp.pierce');
              docCache.set('main', (await send(undefined, 'DOM.getDocument', { depth: -1, pierce: true })).root);
            }
            docs.set(i, docCache.get('main'));
            continue;
          }

          const parent = frames.find((f) => f.frameId === frame.parentFrameId);
          const parentSession = sessionFor(parent);
          const owner = await send(parentSession, 'DOM.getFrameOwner', { frameId: frame.frameId });
          if (!owner?.backendNodeId) {
            notes.push(`Frame ${frame.url || frame.frameId} has no owner element.`);
            continue;
          }

          // A same-process child document is reachable through the frame owner's contentDocument;
          // that includes its closed shadow roots. A cross-process child returns no contentDocument,
          // so its own target's document is the root.
          const described = await send(parentSession, 'DOM.describeNode', {
            backendNodeId: owner.backendNodeId,
            depth: -1,
            pierce: true,
          });
          const contentDocument = described?.node?.contentDocument;
          if (contentDocument) {
            docs.set(i, contentDocument);
            continue;
          }

          const ownSession = sessionFor(frame);
          const docKey = ownSession || `frame:${frame.frameId}`;
          if (!docCache.has(docKey)) {
            bump('cdp.pierce');
            docCache.set(docKey, (await send(ownSession, 'DOM.getDocument', { depth: -1, pierce: true })).root);
          }
          docs.set(i, docCache.get(docKey));
        } catch (err: any) {
          notes.push(`Frame ${frame.url || frame.frameId}: ${String(err?.message || err)}`);
        }
      }

      identities = [];
      let order = 0;
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const root = docs.get(i);
        if (!root) continue;
        const session = sessionFor(frame);

        try {
          if (!axEnabled.has(session)) {
            await send(session, 'Accessibility.enable');
            axEnabled.add(session);
          }
          bump('cdp.ax');
          const ax = await send(session, 'Accessibility.getFullAXTree', { frameId: frame.frameId });
          const closed = collectClosed(root);
          for (const node of ax?.nodes || []) {
            const backend = Number(node?.backendDOMNodeId);
            if (!backend || !closed.ids.has(backend)) continue;
            if (node.ignored) continue;
            const role = lower(node.role?.value);
            if (!INTERACTIVE_ROLES.has(role)) continue;

            const dom = closed.info.get(backend);
            const focusable = property(node, 'focusable') === true;
            const component = componentsEnabled && dom?.host ? await surfaceFor(dom.host, session) : undefined;
            identities.push({
              backendNodeId: backend,
              frameIndex: i,
              role,
              name: String(node.name?.value || ''),
              nodeName: dom?.nodeName || '',
              actions: actionsFor(role, focusable),
              disabled: property(node, 'disabled') === true,
              focusable,
              focused: property(node, 'focused') === true,
              order: order++,
              component,
            });
          }
        } catch (err: any) {
          notes.push(`Frame ${frame.url || frame.frameId}: ${String(err?.message || err)}`);
        }
      }

      bump('sealed.scan');
      bump('sealed.nodes', identities.length);
      if (!identities.length) notes.push('No controls were found inside closed shadow roots.');
      caches.set(wc, { key, at: Date.now(), identities, notes, frames: frames.length });
    } catch (err) {
      throw err;
    } finally {
      // Release the AX domain promptly; the page cannot see it, but leaving it on is still state.
      for (const session of axEnabled) {
        await send(session, 'Accessibility.disable').catch(() => undefined);
      }
      for (const session of cssEnabled) {
        await send(session, 'CSS.disable').catch(() => undefined);
      }
      for (const sessionId of opened) {
        await dbg.sendCommand('Target.detachFromTarget', { sessionId } as any).catch(() => undefined);
      }
    }
  }

  const limit = Math.max(1, Math.min(options.limit ?? 25, MAX_LIMIT));
  const want = lower(options.name || options.contains || '');
  const re = options.regex ? new RegExp(options.regex, options.flags || 'i') : null;
  const filtered = identities.filter((id) => {
    if (options.role && id.role !== lower(options.role)) return false;
    if (options.tag && id.nodeName !== String(options.tag).toUpperCase()) return false;
    if (want && !lower(id.name).includes(want)) return false;
    if (re && !re.test(id.name)) return false;
    return true;
  });

  const targetRootOffsets = new Map<string, { x: number; y: number }>();
  for (const frame of frames) {
    // `listFrames` is depth-ordered, so the first frame per target is that target's root.
    if (frame.oopif && frame.targetId && !targetRootOffsets.has(frame.targetId)) {
      targetRootOffsets.set(frame.targetId, { x: frame.rect.x, y: frame.rect.y });
    }
  }

  const dbg = wc.debugger;
  const send = async (sessionId: string | undefined, method: string, params: Record<string, unknown> = {}) => {
    return sessionId
      ? ((await dbg.sendCommand(method as any, params as any, sessionId)) as any)
      : ((await dbg.sendCommand(method as any, params as any)) as any);
  };
  const sessions = new Map<string, string>();
  const openedNow: string[] = [];
  try {
    for (const frame of frames) {
      if (!frame.oopif || !frame.targetId || sessions.has(frame.targetId)) continue;
      const attached = await send(undefined, 'Target.attachToTarget', { targetId: frame.targetId, flatten: true });
      if (!attached?.sessionId) continue;
      sessions.set(frame.targetId, attached.sessionId);
      openedNow.push(attached.sessionId);
      await send(attached.sessionId, 'Page.enable').catch(() => undefined);
      await send(attached.sessionId, 'DOM.enable').catch(() => undefined);
    }

    const out: SealedControl[] = [];
    const viewport = viewportOf(await send(undefined, 'Page.getLayoutMetrics').catch(() => null));
    for (const id of filtered) {
      if (out.length >= limit) break;
      const frame = frames[id.frameIndex];
      if (!frame) continue;
      const session = frame.oopif && frame.targetId ? sessions.get(frame.targetId) : undefined;
      let model: any;
      try {
        const raw = await send(session, 'DOM.getBoxModel', { backendNodeId: id.backendNodeId });
        model = raw?.model || raw;
      } catch {
        continue;
      }
      const quad = model?.content;
      if (!Array.isArray(quad) || quad.length < 8) continue;
      const xs = [quad[0], quad[2], quad[4], quad[6]].map(Number);
      const ys = [quad[1], quad[3], quad[5], quad[7]].map(Number);
      const offset = frame.oopif && frame.targetId ? targetRootOffsets.get(frame.targetId) : undefined;
      const rect: SealedRect = {
        x: Math.min(...xs) + (offset?.x || 0),
        y: Math.min(...ys) + (offset?.y || 0),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
      if (rect.width <= 0 || rect.height <= 0) continue;
      const inViewport =
        rect.x < viewport.width &&
        rect.y < viewport.height &&
        rect.x + rect.width > 0 &&
        rect.y + rect.height > 0;
      if (options.includeOffscreen === false && !inViewport) continue;
      out.push({
        role: id.role,
        name: id.name,
        rect,
        actions: id.actions,
        source: 'ax',
        frameId: frame.frameId,
        frameUrl: frame.url,
        inViewport,
        disabled: id.disabled || undefined,
        focusable: id.focusable || undefined,
        focused: id.focused || undefined,
        component: id.component,
      });
    }

    if (out.length < filtered.length) {
      notes.push(`${filtered.length - out.length} sealed match(es) not returned (limit or not measurable).`);
    }

    return {
      controls: out,
      total: filtered.length,
      cached,
      frames: frames.length,
      scannedAt: Date.now(),
      notes,
    };
  } finally {
    for (const sessionId of openedNow) {
      await dbg.sendCommand('Target.detachFromTarget', { sessionId } as any).catch(() => undefined);
    }
  }
}
