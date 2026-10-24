/**
 * Human takeover detection.
 *
 * The agent must never fight the person using the machine. Kuang drives the page with *trusted*
 * CDP input, so a synthetic click and a real one look identical to the DOM — the only reliable
 * discriminator is timing: everything the simulator dispatches is bracketed by `markSynthetic()`,
 * and any trusted event arriving outside that window is human.
 *
 * The page reports activity over the console channel (a magic prefix) because it needs to work in
 * each document without extra IPC plumbing; the tab listener already forwards console messages.
 */

export interface HumanActivity {
  kind: 'pointer' | 'key' | 'wheel' | 'touch';
  at: number;
  url?: string;
  /** Element description at the pointer, when the event carried one. */
  target?: string;
}

/** How long after our own dispatch a trusted event is still considered synthetic. */
export const SYNTHETIC_GRACE_MS = 180;

/**
 * Pure decision used by the monitor and by tests.
 * @param trusted  DOM `event.isTrusted`
 * @param at       event timestamp (Date.now on the page)
 * @param lastSyntheticAt last time the simulator dispatched input
 */
export function shouldCountAsHuman(trusted: boolean, at: number, lastSyntheticAt: number): boolean {
  if (!trusted) return false;
  if (!Number.isFinite(at)) return false;
  return at - lastSyntheticAt > SYNTHETIC_GRACE_MS;
}

/** Console prefix the page uses; anything else is ignored. */
export const HUMAN_CONSOLE_PREFIX = '__KUANG_HUMAN__:';

/** Self-contained listener. Idempotent: a second injection is a no-op. */
export function humanListenerScript(): string {
  return `(() => {
    if (window.__kuangHumanWired) return 'already';
    window.__kuangHumanWired = true;
    const describe = (el) => {
      if (!el || !el.tagName) return undefined;
      const name = (el.getAttribute && (el.getAttribute('aria-label') || el.innerText || '')) || '';
      return (el.tagName.toLowerCase() + (name ? ' "' + String(name).replace(/\\s+/g, ' ').trim().slice(0, 40) + '"' : '')).slice(0, 80);
    };
    const report = (kind, e) => {
      if (!e || e.isTrusted !== true) return; // synthetic page-script events are not a takeover
      try {
        console.log(${JSON.stringify(HUMAN_CONSOLE_PREFIX)} + JSON.stringify({
          kind: kind,
          at: Date.now(),
          url: location.href,
          target: kind === 'key' ? undefined : describe(e.target),
        }));
      } catch (err) {}
    };
    window.addEventListener('pointerdown', (e) => report('pointer', e), true);
    window.addEventListener('keydown', (e) => report('key', e), true);
    window.addEventListener('wheel', (e) => report('wheel', e), { capture: true, passive: true });
    window.addEventListener('touchstart', (e) => report('touch', e), { capture: true, passive: true });
    return 'wired';
  })()`;
}

export class HumanActivityMonitor {
  private lastSyntheticAt = 0;
  private lastHuman: HumanActivity | null = null;

  /** Called by the simulator around every synthetic dispatch. */
  public markSynthetic(at: number = Date.now()): void {
    this.lastSyntheticAt = at;
  }

  public getLastHuman(): HumanActivity | null {
    return this.lastHuman;
  }

  /**
   * Parse a console message; returns the activity when it is a genuine human event.
   * Returns null for anything else (including our own dispatches inside the grace window).
   */
  public ingest(message: string): HumanActivity | null {
    if (!message || !message.startsWith(HUMAN_CONSOLE_PREFIX)) return null;
    let payload: any;
    try {
      payload = JSON.parse(message.slice(HUMAN_CONSOLE_PREFIX.length));
    } catch {
      return null;
    }
    const at = Number(payload?.at) || Date.now();
    if (!shouldCountAsHuman(true, at, this.lastSyntheticAt)) return null;
    const activity: HumanActivity = {
      kind: payload?.kind === 'key' ? 'key' : payload?.kind === 'wheel' ? 'wheel' : payload?.kind === 'touch' ? 'touch' : 'pointer',
      at,
      url: typeof payload?.url === 'string' ? payload.url : undefined,
      target: typeof payload?.target === 'string' ? payload.target : undefined,
    };
    this.lastHuman = activity;
    return activity;
  }
}
