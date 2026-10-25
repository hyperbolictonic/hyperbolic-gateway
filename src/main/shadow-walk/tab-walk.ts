/**
 * Tab walk: enter a closed shadow root the way a keyboard user does.
 *
 * A closed root cannot be focused from page JS, but it is still in the sequential focus order.
 * This module starts on a host element, presses trusted `Tab` (or `Shift+Tab`) a bounded number
 * of times, and reads the accessibility tree after each step to see which node actually received
 * focus. It stops when focus leaves the host's subtree, the step budget is spent, or the page
 * gives up focus.
 *
 * Human-like by construction: one real key event per step, a 90-140 ms dwell, no bursts. It does
 * not click, does not inject scripts, and restores focus to the host if the walk fails.
 *
 * The AX tree is the only reliable focus oracle here: `document.activeElement` retargets to the
 * host of a closed root, while AX reports the inner button/textbox as `focused:true`.
 */
import type { WebContents } from 'electron';
import { bump } from '../metrics.js';

export interface TabWalkOptions {
  /** Light-DOM host to start from. */
  selector?: string;
  /** Or a viewport point that hits the host (useful when there is no stable selector). */
  x?: number;
  y?: number;
  direction?: 'forward' | 'backward';
  maxSteps?: number;
  /** Return focus to the host when the walk fails (default true). */
  restore?: boolean;
}

export interface TabWalkStep {
  index: number;
  role: string;
  name: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Time from the key dispatch to the AX read for this step. */
  gapMs: number;
}

export interface TabWalkResult {
  started: boolean;
  steps: TabWalkStep[];
  landed: boolean;
  restored: boolean;
  reason: 'left-host' | 'max-steps' | 'no-focus' | 'not-focusable' | 'no-debugger' | 'no-target';
  hostTag?: string;
  medianStepGapMs?: number;
}

const INTERACTIVE = new Set([
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

const MAX_STEPS = 12;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function prop(node: any, name: string): any {
  const found = (node?.properties || []).find((p: any) => p?.name === name);
  return found?.value?.value;
}

function roleOf(node: any): string {
  return String(node?.role?.value || '').toLowerCase();
}

/** RootWebArea also claims `focused:true`; it is never the control the user is on. */
function focusedNode(ax: any): any | null {
  const candidates = (ax?.nodes || []).filter(
    (n: any) => !n.ignored && prop(n, 'focused') === true && roleOf(n) !== 'rootwebarea'
  );
  if (!candidates.length) return null;
  return candidates.find((n: any) => INTERACTIVE.has(roleOf(n))) || candidates[0];
}

function collectBackendIds(node: any, out = new Set<number>()): Set<number> {
  if (!node) return out;
  if (node.backendNodeId) out.add(Number(node.backendNodeId));
  for (const child of node.children || []) collectBackendIds(child, out);
  for (const shadow of node.shadowRoots || []) collectBackendIds(shadow, out);
  return out;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Walk sequential focus from a host.
 * `pressKey` is supplied by the chassis so the same humanized transport is used as `act`.
 */
export async function runTabWalk(
  wc: WebContents,
  options: TabWalkOptions,
  pressKey: (key: string) => Promise<void>
): Promise<TabWalkResult> {
  const fail = (reason: TabWalkResult['reason']): TabWalkResult => ({
    started: false,
    steps: [],
    landed: false,
    restored: false,
    reason,
  });

  if (!wc || wc.isDestroyed()) throw Object.assign(new Error('No active tab.'), { code: 'NO_TARGET' });
  const dbg = wc.debugger;
  if (!dbg?.isAttached()) return fail('no-debugger');

  const maxSteps = Math.max(1, Math.min(options.maxSteps ?? 8, MAX_STEPS));
  const direction = options.direction === 'backward' ? 'backward' : 'forward';
  const key = direction === 'backward' ? 'Shift+Tab' : 'Tab';

  if (!options.selector && (options.x === undefined || options.y === undefined)) {
    throw Object.assign(new Error('focus_walk needs a selector or x+y for the host element.'), { code: 'BAD_REQUEST' });
  }

  bump('tabwalk.walks');
  await dbg.sendCommand('DOM.enable');
  await dbg.sendCommand('Page.enable').catch(() => undefined);

  let hostBackend: number | undefined;
  let hostTag: string | undefined;
  try {
    if (options.selector) {
      const doc = (await dbg.sendCommand('DOM.getDocument', { depth: 0 })) as any;
      const queried = (await dbg.sendCommand('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: options.selector,
      })) as any;
      if (!queried?.nodeId) return fail('no-target');
      const described = (await dbg.sendCommand('DOM.describeNode', { nodeId: queried.nodeId })) as any;
      hostBackend = Number(described?.node?.backendNodeId) || undefined;
      hostTag = String(described?.node?.nodeName || '').toLowerCase();
    } else {
      const hit = (await dbg.sendCommand('DOM.getNodeForLocation', {
        x: Number(options.x),
        y: Number(options.y),
        includeUserAgentShadowDOM: false,
      })) as any;
      hostBackend = Number(hit?.backendNodeId) || undefined;
      if (hostBackend) {
        const described = (await dbg.sendCommand('DOM.describeNode', { backendNodeId: hostBackend })) as any;
        hostTag = String(described?.node?.nodeName || '').toLowerCase();
      }
    }
  } catch (err: any) {
    throw Object.assign(new Error(`Could not resolve the focus host: ${err?.message || err}`), { code: 'NO_TARGET' });
  }

  if (!hostBackend) return fail('no-target');

  // The host's subtree, closed roots included. `describeNode(pierce)` sees what page JS cannot.
  let inside = new Set<number>();
  try {
    const described = (await dbg.sendCommand('DOM.describeNode', {
      backendNodeId: hostBackend,
      depth: -1,
      pierce: true,
    })) as any;
    inside = collectBackendIds(described?.node);
  } catch {
    return fail('no-target');
  }

  try {
    await dbg.sendCommand('DOM.focus', { backendNodeId: hostBackend });
  } catch {
    // Some hosts (notably with delegatesFocus) reject DOM.focus even though focus() works.
    try {
      const resolved = (await dbg.sendCommand('DOM.resolveNode', { backendNodeId: hostBackend })) as any;
      const objectId = resolved?.object?.objectId;
      if (!objectId) throw new Error('host could not be resolved');
      await dbg.sendCommand('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function () { this.focus(); }',
        returnByValue: true,
      });
    } catch {
      return { ...fail('not-focusable'), hostTag };
    }
  }

  const send = async (method: string, params: Record<string, unknown> = {}) => dbg.sendCommand(method as any, params as any);
  let axEnabled = false;
  const steps: TabWalkStep[] = [];
  let reason: TabWalkResult['reason'] = 'max-steps';

  try {
    await send('Accessibility.enable');
    axEnabled = true;

    // A delegatesFocus host is already on its inner control the moment it is focused. That is a
    // real landing, not a Tab step, so record it before the first key press.
    bump('cdp.ax');
    const initialAx = await send('Accessibility.getFullAXTree');
    const initial = focusedNode(initialAx);
    const initialBackend = Number(initial?.backendDOMNodeId);
    if (
      initial &&
      initialBackend &&
      initialBackend !== hostBackend &&
      inside.has(initialBackend) &&
      INTERACTIVE.has(roleOf(initial))
    ) {
      let rect = { x: 0, y: 0, width: 0, height: 0 };
      try {
        const raw = await send('DOM.getBoxModel', { backendNodeId: initialBackend });
        const model = (raw as any)?.model || raw;
        const quad = model?.content;
        if (Array.isArray(quad) && quad.length >= 8) {
          const xs = [quad[0], quad[2], quad[4], quad[6]].map(Number);
          const ys = [quad[1], quad[3], quad[5], quad[7]].map(Number);
          rect = {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          };
        }
      } catch {}
      steps.push({ index: 0, role: roleOf(initial), name: String(initial.name?.value || ''), rect, gapMs: 0 });
    }

    for (let i = 0; i < maxSteps; i++) {
      const startedAt = Date.now();
      await pressKey(key);
      // A keyboard user pauses between keys; this also gives AX a chance to update.
      await sleep(90 + Math.floor(Math.random() * 50));

      bump('cdp.ax');
      const ax = await send('Accessibility.getFullAXTree');
      const focused = focusedNode(ax);
      if (!focused) {
        reason = 'no-focus';
        break;
      }

      const backend = Number(focused.backendDOMNodeId);
      if (!backend || !inside.has(backend)) {
        reason = 'left-host';
        break;
      }

      let rect = { x: 0, y: 0, width: 0, height: 0 };
      try {
        const raw = await send('DOM.getBoxModel', { backendNodeId: backend });
        const model = (raw as any)?.model || raw;
        const quad = model?.content;
        if (Array.isArray(quad) && quad.length >= 8) {
          const xs = [quad[0], quad[2], quad[4], quad[6]].map(Number);
          const ys = [quad[1], quad[3], quad[5], quad[7]].map(Number);
          rect = {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          };
        }
      } catch {
        // A focused node without a box is still a valid focus step; keep the step with a zero rect.
      }

      steps.push({
        index: i + 1,
        role: roleOf(focused),
        name: String(focused.name?.value || ''),
        rect,
        gapMs: Date.now() - startedAt,
      });
      bump('tabwalk.steps');
    }
  } finally {
    if (axEnabled) await send('Accessibility.disable').catch(() => undefined);
  }

  const landed = steps.length > 0;
  let restored = false;
  if (!landed && options.restore !== false) {
    try {
      await dbg.sendCommand('DOM.focus', { backendNodeId: hostBackend });
      restored = true;
    } catch {
      try {
        const resolved = (await dbg.sendCommand('DOM.resolveNode', { backendNodeId: hostBackend })) as any;
        const objectId = resolved?.object?.objectId;
        if (!objectId) throw new Error('host could not be resolved');
        await dbg.sendCommand('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: 'function () { this.focus(); }',
          returnByValue: true,
        });
        restored = true;
      } catch {
        restored = false;
      }
    }
  }

  return {
    started: true,
    steps,
    landed,
    restored,
    reason,
    hostTag,
    medianStepGapMs: median(steps.map((s) => s.gapMs)),
  };
}
