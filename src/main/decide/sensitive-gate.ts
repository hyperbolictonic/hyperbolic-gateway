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
  /age verification/i,
  /verify (?:your|the user'?s) age/i,
  /confirm (?:your|the user'?s) age/i,
  /are you (?:at least )?(?:18|21|over 18|18 or older)/i,
  /\b(?:18|21)\s*(?:\+|or (?:older|over))\b/i,
  /you must be (?:at least )?(?:18|21)/i,
  /adults? only|adult content|age[- ]restricted/i,
  /this (?:content|page|community) (?:is|contains) (?:for )?(?:adults|mature)/i,
];

const CAPTCHA_PATTERNS: RegExp[] = [
  /captcha/i,
  /verify (?:that )?you(?:'re| are) (?:a )?human/i,
  /are you a (?:robot|human)/i,
  /human verification/i,
];

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
 */
export function detectSensitiveGate(state: unknown): GateDetection | null {
  const text = typeof state === 'string' ? state : JSON.stringify(state ?? '');
  if (!text) return null;

  const age = matchingLines(text, AGE_PATTERNS);
  if (age.length) {
    return {
      kind: 'age_verification',
      evidence: age,
      reason:
        'Age verification detected. Confirming age is a statement only a human can make — do not click through it. Call request_human_intervention and let the human decide.',
    };
  }

  const captcha = matchingLines(text, CAPTCHA_PATTERNS);
  if (captcha.length) {
    return {
      kind: 'captcha',
      evidence: captcha,
      reason:
        'A CAPTCHA / human-verification challenge is present. Solving it is a human declaration — call request_human_intervention.',
    };
  }

  return null;
}
