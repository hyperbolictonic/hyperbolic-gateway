import type { WebContents } from 'electron';
import type { HumanizedInputSimulator } from '../telemetry/input-simulator.js';
import { evaluateInFrames } from '../browser/frame-eval.js';

export interface ShieldDismissResult {
  dismissed: boolean;
  /** A consent wall was detected but no usable control matched — do not force it. */
  blocked?: boolean;
  targetText?: string;
  targetSelector?: string;
  coordinates?: { x: number; y: number };
  framework?: string;
  /** Which intent was clicked: the preferred one, or the fallback. */
  intent?: 'reject' | 'essential' | 'accept';
  /** Where the control lived: the top document, or a child frame. */
  frame?: 'main' | 'child';
  /** How the click was delivered (trusted input vs in-frame activation). */
  delivery?: 'cdp' | 'in-frame';
  message: string;
}

/**
 * How to answer a consent wall. This is a *preference*, not a licence to click anything that says
 * "Accept": 'essential' (default) tries the least-invasive real option first, then falls back.
 */
export type ConsentPolicy = 'essential' | 'reject' | 'accept';

/**
 * Vendor rules with both intents where the CMP exposes one. A real banner offers "Reject all" or
 * "Only necessary" far more often than the generic heuristics assume — clicking the human's least
 * invasive option is both more polite and more likely to actually stick (an "Accept all" that the
 * CMP re-renders is the classic on/off flicker).
 */
const VENDOR_RULES: Array<{ framework: string; reject?: string; accept: string }> = [
  {
    framework: 'OneTrust',
    reject: '#onetrust-reject-all-handler, button#onetrust-reject-all-handler',
    accept: '#onetrust-accept-btn-handler, button#onetrust-accept-btn-handler',
  },
  {
    framework: 'Cookiebot',
    reject: '#CybotCookiebotDialogBodyButtonDecline, #CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    accept: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept',
  },
  {
    framework: 'Google',
    reject: '#W0wltc, button[aria-label*="Reject all" i]',
    accept: '#L2AGLb, button[id*="L2AGLb"], form[action*="consent"] button',
  },
  { framework: 'TrustArc', reject: '.trustarc-decline-btn', accept: '.trustarc-agree-btn, #truste-consent-button' },
  { framework: 'Civic', reject: '#ccc-reject-settings', accept: '#ccc-notify-accept, #ccc-recommended-settings' },
  { framework: 'Didomi', reject: '#didomi-notice-disagree-button', accept: '#didomi-notice-agree-button' },
  {
    framework: 'Quantcast',
    reject: '.qc-cmp2-summary-buttons button[mode="secondary"]',
    accept: '.qc-cmp2-summary-buttons button[mode="primary"]',
  },
  {
    framework: 'Generic',
    reject:
      'button[id*="reject-all" i], button[class*="reject-all" i], button[id*="decline" i], [aria-label*="reject all" i], [aria-label*="decline" i]',
    accept:
      'button[id*="cookie-accept" i], button[class*="cookie-accept" i], button[id*="accept-all" i], button[class*="accept-all" i], [aria-label*="accept all" i], [aria-label*="accept cookies" i]',
  },
];

/** Text patterns for CMPs with no stable ids. Reject first, accept second. */
const REJECT_PATTERNS = [
  /^\s*(reject all|reject cookies|decline all|decline|refuse|deny|only necessary|only essential|essential only|necessary only|continue without accepting|continue without consent|disagree)\s*$/i,
  /(reject all|decline all|only necessary|essential only|continue without accepting)/i,
];
const ACCEPT_PATTERNS = [
  /^\s*(accept all|i accept|accept cookies|allow all|allow all cookies|agree and continue|agree & continue|i agree|agree|accept|got it|ok)\s*$/i,
  /(accept all|allow all|accept cookies|agree & continue|agree and continue)/i,
];

/** Marker left on the chosen control so the in-frame fallback can find it again. */
const MARK_ATTR = 'data-kuang-consent';

/**
 * Self-contained scan. Runs unchanged in the top document and in every child frame (an isolated
 * world sees the same DOM), which is what makes a Sourcepoint/Quantcast iframe answerable.
 */
function consentScanScript(order: Array<'reject' | 'accept'>): string {
  return `(() => {
    const rules = ${JSON.stringify(VENDOR_RULES)};
    const rejectPatterns = ${JSON.stringify(REJECT_PATTERNS.map((r) => r.source))};
    const acceptPatterns = ${JSON.stringify(ACCEPT_PATTERNS.map((r) => r.source))};
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const hit = (el, framework, intent) => {
      try { el.setAttribute(${JSON.stringify(MARK_ATTR)}, intent); } catch (e) {}
      const r = el.getBoundingClientRect();
      return {
        found: true,
        framework,
        intent,
        selector: el.id ? '#' + el.id : undefined,
        text: (el.textContent || el.value || '').trim().slice(0, 60),
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
      };
    };

    // 1. Vendor selectors, in the caller's intent order.
    for (const intent of ${JSON.stringify(order)}) {
      for (const rule of rules) {
        const sel = intent === 'reject' ? rule.reject : rule.accept;
        if (!sel) continue;
        for (const el of document.querySelectorAll(sel)) {
          if (!visible(el)) continue;
          return hit(el, rule.framework, intent);
        }
      }
    }

    // 2. Text patterns, scoped to dialog-like containers so an unrelated "OK" elsewhere does
    //    not get clicked. Only fall back to the whole document if no container matches.
    const scopes = [
      ...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="consent" i], [id*="consent" i], [class*="cookie" i], [id*="cookie" i], [class*="cmp" i], [id*="cmp" i]'),
    ];
    const containers = scopes.length ? scopes : [document.body];
    for (const intent of ${JSON.stringify(order)}) {
      const patterns = (intent === 'reject' ? rejectPatterns : acceptPatterns).map((p) => new RegExp(p, 'i'));
      for (const scope of containers) {
        for (const el of scope.querySelectorAll('button, [role="button"], a.btn, input[type="button"], input[type="submit"]')) {
          const text = (el.textContent || el.value || '').trim();
          if (!text || text.length > 40 || !visible(el)) continue;
          if (!patterns.some((re) => re.test(text))) continue;
          return hit(el, 'Heuristic Pattern Match', intent);
        }
      }
    }

    // 3. Report whether a wall is present even when no control matched.
    const wall = containers.find((scope) => {
      const rect = scope.getBoundingClientRect ? scope.getBoundingClientRect() : null;
      if (!rect || rect.width < 200 || rect.height < 120) return false;
      return /consent|cookie|privacy|gdpr|tracking/i.test(
        (scope.getAttribute('class') || '') + ' ' + (scope.id || '') + ' ' + (scope.getAttribute('aria-label') || '')
      );
    });
    return { found: false, wallPresent: !!wall, frameCount: document.querySelectorAll('iframe').length };
  })()`;
}

export class ShieldBreaker {
  constructor(private simulator: HumanizedInputSimulator) {}

  /**
   * Answer a consent wall the way a person would: pick a real control in the banner, click it once
   * with the visible cursor, and stop. Auto-removal (`forceRemove`) is a last resort and is only
   * used when the caller explicitly asked for it — never during background sweeps.
   */
  public async dismissConsent(
    wc: WebContents,
    options: { policy?: ConsentPolicy; forceRemove?: boolean } = {}
  ): Promise<ShieldDismissResult> {
    const policy: ConsentPolicy = options.policy || 'essential';
    const order: Array<'reject' | 'accept'> = policy === 'accept' ? ['accept', 'reject'] : ['reject', 'accept'];
    const scan = consentScanScript(order);

    try {
      // 1. Top document first: the common case, one evaluate, no frame traversal cost.
      const main = await wc.executeJavaScript(scan).catch(() => null);
      if (main?.found) return await this.clickMatch(wc, main, 'main');

      // 2. Child frames, only when the top document had nothing AND actually embeds something.
      //    Sourcepoint (Guardian) and some Quantcast setups render the whole banner inside a
      //    cross-origin iframe, which the main-frame scan can never see.
      if (main && main.frameCount > 0) {
        const frames = await evaluateInFrames(wc, scan, { maxFrames: 6, timeoutMs: 2000 }).catch(() => []);
        const child = frames.find((f) => f.ok && (f.value as any)?.found);
        if (child) {
          const match = child.value as any;
          const offset = await this.frameOffset(wc, child.url || '');
          if (offset) {
            return await this.clickMatch(wc, match, 'child', offset);
          }
          // Coordinates unavailable (nested frame, dynamic src): activate in-frame. This is a
          // synthetic click, so it is labelled as such — visible, honest, and still a real DOM event.
          const clicked = await this.clickMarkedInFrame(wc);
          if (clicked) {
            return {
              dismissed: true,
              framework: match.framework,
              intent: match.intent,
              frame: 'child',
              delivery: 'in-frame',
              targetText: match.text,
              message: `Answered ${match.framework} wall inside a child frame ("${match.text}", ${match.intent}) via in-frame activation (no layout offset available).`,
            };
          }
        }
      }

      if (main?.wallPresent && options.forceRemove) {
        await this.forceRemove(wc);
        return {
          dismissed: true,
          framework: 'forced removal',
          message: 'No consent control matched; the overlay was removed from the DOM (last resort).',
        };
      }
      return {
        dismissed: false,
        blocked: Boolean(main?.wallPresent),
        message: main?.wallPresent
          ? 'Consent wall detected, but no reject/accept control could be matched in the page or its frames — left for a human.'
          : 'No active consent or modal barrier detected on active DOM.',
      };
    } catch (err: any) {
      return {
        dismissed: false,
        message: `Error during shield breaker execution: ${err.message}`,
      };
    }
  }

  private async clickMatch(
    wc: WebContents,
    match: { x: number; y: number; framework: string; intent: 'reject' | 'accept'; text: string; selector?: string },
    frame: 'main' | 'child',
    offset: { x: number; y: number } = { x: 0, y: 0 }
  ): Promise<ShieldDismissResult> {
    const point = { x: offset.x + match.x, y: offset.y + match.y };
    await this.simulator.clickAt(wc, point);
    await wc
      .executeJavaScript(`(() => { if (document.body.style.overflow === 'hidden') document.body.style.overflow = 'auto'; })()`)
      .catch(() => {});
    return {
      dismissed: true,
      framework: match.framework,
      intent: match.intent,
      frame,
      delivery: 'cdp',
      targetText: match.text,
      targetSelector: match.selector,
      coordinates: point,
      message: `Answered ${match.framework} wall with "${match.text}" (${match.intent}) at (${point.x}, ${point.y})${frame === 'child' ? ' inside a child frame' : ''}`,
    };
  }

  /** Top-level rect of the iframe whose src matches the child frame's URL. */
  private async frameOffset(wc: WebContents, frameUrl: string): Promise<{ x: number; y: number } | null> {
    if (!frameUrl) return null;
    const raw = await wc
      .executeJavaScript(
        `(() => {
          const want = ${JSON.stringify(frameUrl)};
          const strip = (u) => String(u || '').replace(/\\/$/, '');
          for (const f of document.querySelectorAll('iframe')) {
            let src = '';
            try { src = f.src || ''; } catch (e) {}
            if (!src) continue;
            if (strip(src) === strip(want) || src.startsWith(want) || want.startsWith(src)) {
              const r = f.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) return { x: r.left, y: r.top };
            }
          }
          return null;
        })()`
      )
      .catch(() => null);
    return raw && typeof raw.x === 'number' ? { x: raw.x, y: raw.y } : null;
  }

  /** Fallback: click the marked control wherever it lives (the marker makes the frame self-select). */
  private async clickMarkedInFrame(wc: WebContents): Promise<boolean> {
    const frames = await evaluateInFrames(
      wc,
      `(() => { const el = document.querySelector('[${MARK_ATTR}]'); if (!el) return false; el.click(); return true; })()`,
      { maxFrames: 6, timeoutMs: 2000 }
    ).catch(() => []);
    return frames.some((f) => f.ok && f.value === true);
  }

  /** Last resort: hide the wall without answering it. Only reachable when explicitly requested. */
  private async forceRemove(wc: WebContents): Promise<void> {
    await wc
      .executeJavaScript(
        `(() => {
          const walk = (root) => {
            for (const el of root.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="consent" i], [id*="consent" i], [class*="cookie" i], [id*="cookie" i]')) {
              const r = el.getBoundingClientRect();
              if (r.width > 200 && r.height > 120) el.style.setProperty('display', 'none', 'important');
            }
          };
          walk(document);
          document.body.style.overflow = 'auto';
        })()`
      )
      .catch(() => {});
  }
}
