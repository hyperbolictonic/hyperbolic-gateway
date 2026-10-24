import type { WebContents } from 'electron';
import type { HumanizedInputSimulator } from '../telemetry/input-simulator.js';

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
  {
    framework: 'Didomi',
    reject: '#didomi-notice-disagree-button',
    accept: '#didomi-notice-agree-button',
  },
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

export class ShieldBreaker {
  constructor(private simulator: HumanizedInputSimulator) {}

  /**
   * Answer a consent wall the way a person would: pick a real control in the banner, click it once
   * with the visible cursor, and stop. Auto-removal (`forceRemove`) is a last resort and is only
   * used when the caller explicitly asked for it — never during background sweeps.
   */
  public async dismissConsent(wc: WebContents, options: { policy?: ConsentPolicy; forceRemove?: boolean } = {}): Promise<ShieldDismissResult> {
    const policy: ConsentPolicy = options.policy || 'essential';
    const order: Array<'reject' | 'accept'> = policy === 'accept' ? ['accept', 'reject'] : ['reject', 'accept'];

    const scanScript = `
      (() => {
        const rules = ${JSON.stringify(VENDOR_RULES)};
        const rejectPatterns = ${JSON.stringify(REJECT_PATTERNS.map((r) => r.source))};
        const acceptPatterns = ${JSON.stringify(ACCEPT_PATTERNS.map((r) => r.source))};
        const visible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const hit = (el, framework, intent) => ({
          found: true,
          framework,
          intent,
          selector: el.id ? '#' + el.id : undefined,
          text: (el.textContent || el.value || '').trim().slice(0, 60),
          x: Math.round(el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2),
          y: Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2),
        });

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
        return { found: false, wallPresent: !!wall };
      })()
    `;

    try {
      const result = await wc.executeJavaScript(scanScript);

      if (!result || !result.found) {
        if (result?.wallPresent && options.forceRemove) {
          await this.forceRemove(wc);
          return {
            dismissed: true,
            framework: 'forced removal',
            message: 'No consent control matched; the overlay was removed from the DOM (last resort).',
          };
        }
        return {
          dismissed: false,
          blocked: Boolean(result?.wallPresent),
          message: result?.wallPresent
            ? 'Consent wall detected, but no reject/accept control could be matched — left for a human.'
            : 'No active consent or modal barrier detected on active DOM.',
        };
      }

      // One physical click, exactly where a person would click.
      await this.simulator.clickAt(wc, { x: result.x, y: result.y });

      await wc.executeJavaScript(`
        (() => {
          if (document.body.style.overflow === 'hidden') document.body.style.overflow = 'auto';
        })()
      `).catch(() => {});

      return {
        dismissed: true,
        framework: result.framework,
        intent: result.intent,
        targetSelector: result.selector,
        targetText: result.text,
        coordinates: { x: result.x, y: result.y },
        message: `Answered ${result.framework} wall with "${result.text}" (${result.intent}) at (${result.x}, ${result.y})`,
      };
    } catch (err: any) {
      return {
        dismissed: false,
        message: `Error during shield breaker execution: ${err.message}`,
      };
    }
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
