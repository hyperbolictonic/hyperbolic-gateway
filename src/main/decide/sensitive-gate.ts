/**
 * Sensitive gates — situations where the correct action is **a human**, never a click.
 *
 * This runs *before* any decision model is asked, for two reasons:
 *   1. It must not depend on the model's confidence. A 0.98 "blocked" is still a decision, and the
 *      rule here is "do not decide at all".
 *   2. It must not spend a call, eliminate options, or retry. There is no option to eliminate:
 *      the gate is not a step to get past, it is a boundary.
 *
 * Age verification is the motivating case: clicking "I am 18", "Verify", or "Not Now" on an age
 * gate is an assertion about a human that software must not make. Captchas get the same treatment
 * (solving one is someone else's declaration), while ordinary forms — a birthday field in a signup
 * flow — do not match: the patterns below are gate copy, not field labels.
 */

export type SensitiveGate = 'age_verification' | 'captcha';

export interface GateDetection {
  kind: SensitiveGate;
  /** Lines/copy that triggered the rule, for the record and for the human. */
  evidence: string[];
  reason: string;
}

const AGE_PATTERNS: RegExp[] = [
  // Verb-anchored gate copy only: a post that merely contains "18+" or "adult content" must not
  // stop automation. Every pattern here is something a wall says to the visitor.
  /verify (?:your|the user'?s) (?:age|birthday|date of birth)/i,
  /confirm (?:your|the user'?s) (?:age|birthday)/i,
  /birthday to continue/i,
  /age verification/i,
  /are you (?:at least )?(?:18|21)\b/i,
  /must be (?:at least )?(?:18|21)\b/i,
  /adults? only/i,
  /age[- ]restricted/i,
  /(?:18|21)\+\s*(?:only|required|content)/i,
];

// Deliberately not bare "captcha"/"robot": documentation, news and forum copy mention those words
// constantly. A gate announces a *challenge*, not the concept.
const CAPTCHA_PATTERNS: RegExp[] = [
  /recaptcha|hcaptcha|turnstile/i,
  /verify (?:that )?you(?:'re| are) (?:a )?human/i,
  /i'?m not a robot/i,
  /human verification/i,
];

/** Our own app pages and blank tabs are never gates, whatever their copy says. */
function isAppPage(url?: string): boolean {
  if (!url) return false;
  return /^(?:mark-eleven|about|chrome|devtools|file):/i.test(url);
}

function matchingLines(text: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (patterns.some((p) => p.test(trimmed))) hits.push(trimmed.slice(0, 160));
    if (hits.length >= 3) break;
  }
  return hits;
}

/**
 * Inspect the state Kuang is about to send. `state` may be the composed page text or the component
 * table; both contain the visible copy, which is where a gate announces itself.
 *
 * Only the **first 1200 characters** are scanned: gate copy is what a wall puts in front of you,
 * while a page that merely *discusses* age gates mentions them further in. `url` lets the caller
 * exclude app-internal pages (the manual documents reCAPTCHA, which would otherwise look like a gate).
 */
export function detectSensitiveGate(state: unknown, opts: { url?: string } = {}): GateDetection | null {
  if (isAppPage(opts.url)) return null;
  const raw = typeof state === 'string' ? state : JSON.stringify(state ?? '');
  if (!raw) return null;
  const text = raw.slice(0, 1200);

  const age = matchingLines(text, AGE_PATTERNS);
  if (age.length) {
    return {
      kind: 'age_verification',
      evidence: age,
      reason:
        'Age verification detected — this needs a human, not a decision. Do not click through it; complete it in the browser (the hand-off has been raised), then click DONE.',
    };
  }

  const captcha = matchingLines(text, CAPTCHA_PATTERNS);
  if (captcha.length) {
    return {
      kind: 'captcha',
      evidence: captcha,
      reason:
        'A CAPTCHA / human-verification challenge is present — this needs a human, not a decision. Solve it in the browser (the hand-off has been raised), then click DONE.',
    };
  }

  return null;
}
