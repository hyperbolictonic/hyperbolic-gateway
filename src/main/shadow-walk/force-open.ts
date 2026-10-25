/**
 * Force-open — the one intentionally detectable lever.
 *
 * `attachShadow({mode:'closed'})` is a boundary, not an accident. A page that relies on it can
 * still be inspected by CDP, but its own scripts cannot see the root. This patch changes that
 * boundary for the *next document*:
 *
 *   attachShadow({mode:'closed'}) -> attachShadow({mode:'open'})
 *
 * It is plain and honest: no `toString` forgery, no property-descriptor tricks. A page can detect
 * it structurally (`host.shadowRoot !== null`) and by reading `attachShadow.toString()`. That is
 * why it is off by default, needs a confirm, and shows a red chip while armed.
 *
 * It is injected with `Page.addScriptToEvaluateOnNewDocument`, so it affects future navigations,
 * never the document that was already running when the lever was flipped. Removing it stops future
 * documents; the current document stays patched until it reloads.
 */
import type { WebContents } from 'electron';
import { bump } from '../metrics.js';

const PATCH_SOURCE = `(() => {
  const proto = Element.prototype;
  const original = proto.attachShadow;
  if (typeof original !== 'function') return;
  proto.attachShadow = function (init) {
    if (init && init.mode === 'closed') {
      init = Object.assign({}, init, { mode: 'open' });
    }
    return original.call(this, init);
  };
})();`;

interface ArmedEntry {
  identifier: string;
}

const armed = new WeakMap<WebContents, ArmedEntry>();

export function isForceOpenArmed(wc: WebContents | null | undefined): boolean {
  return !!wc && armed.has(wc);
}

export interface ForceOpenSyncResult {
  armed: boolean;
  changed: boolean;
  error?: string;
}

/**
 * Arm or disarm the document-start patch for one tab.
 * Returns `changed` so a caller that armed a tab before its first load can reload it once.
 */
export async function syncForceOpen(wc: WebContents, shouldArm: boolean): Promise<ForceOpenSyncResult> {
  if (!wc || wc.isDestroyed()) return { armed: false, changed: false, error: 'no webContents' };

  const current = armed.get(wc);
  if (shouldArm === !!current) return { armed: !!current, changed: false };

  const dbg = wc.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Page.enable').catch(() => undefined);

    if (shouldArm) {
      const result = (await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: PATCH_SOURCE,
        runImmediately: false,
      })) as any;
      if (!result?.identifier) throw new Error('CDP returned no script identifier');
      armed.set(wc, { identifier: String(result.identifier) });
      bump('forceopen.arm');
      return { armed: true, changed: true };
    }

    if (current) {
      await dbg.sendCommand('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: current.identifier,
      });
      armed.delete(wc);
      bump('forceopen.disarm');
      return { armed: false, changed: true };
    }
    return { armed: false, changed: false };
  } catch (err: any) {
    return { armed: !!armed.get(wc), changed: false, error: String(err?.message || err) };
  }
}

export interface ForceOpenDetection {
  armed: boolean;
  applied: boolean;
  detectable: boolean;
  evidence: {
    hostShadowRootIsNull: boolean;
    attachShadowLooksNative: boolean;
    attachShadowSource: string;
  };
  note: string;
}

/** Ask the current document what a fingerprinting script would see. */
export async function detectForceOpen(wc: WebContents): Promise<ForceOpenDetection> {
  const armedNow = isForceOpenArmed(wc);
  if (!wc || wc.isDestroyed()) {
    return {
      armed: armedNow,
      applied: false,
      detectable: false,
      evidence: { hostShadowRootIsNull: true, attachShadowLooksNative: true, attachShadowSource: '' },
      note: 'No active tab.',
    };
  }

  try {
    const evidence = await wc.executeJavaScript(`(() => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'closed' });
      const source = Function.prototype.toString.call(Element.prototype.attachShadow);
      return {
        hostShadowRootIsNull: host.shadowRoot === null,
        attachShadowLooksNative: /native code/.test(source),
        attachShadowSource: String(source).slice(0, 160),
      };
    })()`);

    const applied = evidence?.hostShadowRootIsNull === false;
    const detectable = applied || evidence?.attachShadowLooksNative === false;
    return {
      armed: armedNow,
      applied,
      detectable,
      evidence: {
        hostShadowRootIsNull: evidence?.hostShadowRootIsNull !== false,
        attachShadowLooksNative: evidence?.attachShadowLooksNative !== false,
        attachShadowSource: String(evidence?.attachShadowSource || ''),
      },
      note: applied
        ? 'The page can see a closed root on a freshly created host: this document is force-opened.'
        : armedNow
          ? 'The patch is armed for the next document; reload to apply it to this one.'
          : 'No force-open patch in this document (closed roots stay closed).',
    };
  } catch (err: any) {
    return {
      armed: armedNow,
      applied: false,
      detectable: false,
      evidence: { hostShadowRootIsNull: true, attachShadowLooksNative: true, attachShadowSource: '' },
      note: `Detection failed: ${String(err?.message || err)}`,
    };
  }
}
