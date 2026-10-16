import type { WebContents } from 'electron';
import type { HumanizedInputSimulator } from '../telemetry/input-simulator.js';

export interface ShieldDismissResult {
  dismissed: boolean;
  targetText?: string;
  targetSelector?: string;
  coordinates?: { x: number; y: number };
  framework?: string;
  message: string;
}

export class ShieldBreaker {
  constructor(private simulator: HumanizedInputSimulator) {}

  /**
   * Scans the active WebContents DOM for GDPR, cookie consent, and modal barriers,
   * then physically moves the Bézier cursor and clicks the confirmation button.
   */
  public async dismissConsent(wc: WebContents): Promise<ShieldDismissResult> {
    const scanScript = `
      (() => {
        // High-confidence specific vendor rules
        const rules = [
          { framework: 'OneTrust', selector: '#onetrust-accept-btn-handler, button#onetrust-accept-btn-handler' },
          { framework: 'Cookiebot', selector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept' },
          { framework: 'Google', selector: '#L2AGLb, button[id*="L2AGLb"], form[action*="consent"] button' },
          { framework: 'TrustArc', selector: '.trustarc-agree-btn, #truste-consent-button' },
          { framework: 'Civic', selector: '#ccc-notify-accept, #ccc-recommended-settings' },
          { framework: 'Didomi', selector: '#didomi-notice-agree-button' },
          { framework: 'Quantcast', selector: '.qc-cmp2-summary-buttons button[mode="primary"]' },
          { framework: 'Generic A', selector: 'button[id*="cookie-accept" i], button[class*="cookie-accept" i]' },
          { framework: 'Generic B', selector: 'button[id*="accept-all" i], button[class*="accept-all" i]' },
          { framework: 'Generic C', selector: '[aria-label*="accept all" i], [aria-label*="accept cookies" i]' },
        ];

        for (const rule of rules) {
          try {
            const el = document.querySelector(rule.selector);
            if (el) {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
                return {
                  found: true,
                  framework: rule.framework,
                  selector: rule.selector,
                  text: el.textContent?.trim() || '',
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.top + rect.height / 2),
                };
              }
            }
          } catch (_) {}
        }

        // Broad text pattern matching on all buttons and role="button" elements
        try {
          const candidateElements = Array.from(document.querySelectorAll('button, [role="button"], a.btn, input[type="button"], input[type="submit"]'));
          const acceptPatterns = [
            /^\s*(accept all|i accept|accept cookies|allow all|allow all cookies|agree and continue|agree & continue|i agree|agree|accept|got it|ok)\s*$/i,
            /(accept all|allow all|accept cookies|agree & continue|agree and continue)/i,
          ];

          for (const el of candidateElements) {
            try {
              const text = (el.textContent || (el as HTMLInputElement).value || '').trim();
              if (!text || text.length > 40) continue;

              for (const pattern of acceptPatterns) {
                if (pattern.test(text)) {
                  const rect = el.getBoundingClientRect();
                  const style = window.getComputedStyle(el);
                  if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
                    return {
                      found: true,
                      framework: 'Heuristic Pattern Match',
                      text: text,
                      x: Math.round(rect.left + rect.width / 2),
                      y: Math.round(rect.top + rect.height / 2),
                    };
                  }
                }
              }
            } catch (_) {}
          }
        } catch (_) {}

        return { found: false };
      })()
    `;

    try {
      const result = await wc.executeJavaScript(scanScript);

      if (!result || !result.found) {
        return {
          dismissed: false,
          message: 'No active consent or modal barrier detected on active DOM.',
        };
      }

      // Physical Bézier cursor actuation to the coordinates
      await this.simulator.clickAt(wc, { x: result.x, y: result.y });

      // Clean up body overflow if locked
      await wc.executeJavaScript(`
        (() => {
          if (document.body.style.overflow === 'hidden') {
            document.body.style.overflow = 'auto';
          }
        })()
      `).catch(() => {});

      return {
        dismissed: true,
        framework: result.framework,
        targetSelector: result.selector,
        targetText: result.text,
        coordinates: { x: result.x, y: result.y },
        message: `Successfully dismissed ${result.framework} banner ("${result.text}") at (${result.x}, ${result.y})`,
      };
    } catch (err: any) {
      return {
        dismissed: false,
        message: `Error during shield breaker execution: ${err.message}`,
      };
    }
  }
}
