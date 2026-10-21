/**
 * Deterministic guard around a decision call: validate the answer, drop the option that failed,
 * ask again with what's left, and stop with an honest "no decision" when nothing survives.
 *
 * Why this is mechanical (and allowed to live in Kuang): nothing here decides *what is right*.
 * It only checks facts Kuang already owns — is the chosen id in the list we offered, does that
 * component actually accept the operation, is the confidence above the bar, do the answers
 * contradict each other. A rejection removes exactly that option, so the next call cannot repeat
 * the same mistake. When the options run out, the result is `accepted:false, fallback:"agent"` —
 * the LLM keeps the last word, which is where judgement belongs.
 *
 * The loop costs one model call per attempt (Jev answers in ~200–500 ms), and each attempt is
 * reported so the HUD/ledger can show what was eliminated and why.
 */

import { runDecision, emitDecisionEvent, type DecisionResult } from './decision-client.js';

export interface DecisionGuard {
  /** Minimum confidence for a choice to be accepted (0–1). Omit to accept any confidence. */
  threshold?: number;
  /** Operations that may be accepted. Default: click, type_text, done, blocked. */
  operations?: string[];
  /** Components offered to the model, with their affordances. Used to reject impossible targets. */
  components?: Array<{ id: string | number; actions?: string[]; name?: string }>;
}

export interface GuardRejection {
  question: string;
  option: string;
  reason: string;
}

export interface GuardedDecision {
  ok: boolean;
  accepted: boolean;
  protocol?: string;
  model?: string;
  answers?: Record<string, any>;
  attempts: number;
  removed: Record<string, string[]>;
  rejections: GuardRejection[];
  reasons: string[];
  /** True when every candidate was eliminated without an acceptable answer. */
  exhausted?: boolean;
  /** Present when the caller must decide (the model could not produce an acceptable answer). */
  fallback?: 'agent' | 'human';
  /** Set when a sensitive gate stopped the call before the model (age verification, CAPTCHA). */
  gate?: 'age_verification' | 'captcha';
  latencyMs?: number;
  error?: DecisionResult['error'];
}

const DEFAULT_OPERATIONS = ['click', 'type_text', 'done', 'blocked'];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Remove one option from a choice question, in whichever shape the backend uses. */
function withoutOption(question: any, option: string): any {
  const next = clone(question);
  if (next.criteria && typeof next.criteria === 'object' && !Array.isArray(next.criteria)) {
    delete next.criteria[option];
  }
  if (Array.isArray(next.options)) {
    next.options = next.options.filter((o: string) => o !== option);
  }
  if (next.descriptions && typeof next.descriptions === 'object') {
    delete next.descriptions[option];
  }
  return next;
}

function optionCount(question: any): number {
  if (Array.isArray(question.options)) return question.options.length;
  if (question.criteria && typeof question.criteria === 'object') return Object.keys(question.criteria).length;
  return 0;
}

/**
 * Validate one answer set. Returns the offending (question, option) pairs so the caller can
 * remove exactly those, plus human-readable reasons for the record.
 */
export function validateAnswers(answers: Record<string, any>, guard: DecisionGuard): { ok: boolean; rejections: GuardRejection[] } {
  const rejections: GuardRejection[] = [];
  const threshold = typeof guard.threshold === 'number' ? guard.threshold : 0;
  const allowedOperations = guard.operations && guard.operations.length ? guard.operations : DEFAULT_OPERATIONS;

  const operation = answers?.operation?.choice;

  if (operation !== undefined && !allowedOperations.includes(operation)) {
    rejections.push({ question: 'operation', option: String(operation), reason: `"${operation}" is not an allowed operation` });
  }

  // Confidence gate on every choice answer.
  if (threshold > 0) {
    for (const [id, answer] of Object.entries(answers || {})) {
      if (answer && typeof answer === 'object' && 'choice' in answer) {
        const confidence = Number((answer as any).confidence ?? 0);
        if (confidence < threshold) {
          rejections.push({
            question: id,
            option: String((answer as any).choice),
            reason: `confidence ${confidence.toFixed(2)} is below the ${threshold.toFixed(2)} threshold`,
          });
        }
      }
    }
  }

  // A target must exist and accept the chosen operation.
  if (guard.components && guard.components.length) {
    for (const [id, answer] of Object.entries(answers || {})) {
      if (!/target/i.test(id) || !answer || typeof answer !== 'object' || !('choice' in answer)) continue;
      const chosen = String((answer as any).choice);
      const component = guard.components.find((c) => String(c.id) === chosen);
      if (!component) {
        rejections.push({ question: id, option: chosen, reason: `component ${chosen} was not in the offered list` });
        continue;
      }
      if (operation && component.actions && component.actions.length && operation !== 'done' && operation !== 'blocked') {
        if (!component.actions.includes(operation)) {
          rejections.push({
            question: id,
            option: chosen,
            reason: `component ${chosen} does not accept "${operation}" (actions: ${component.actions.join(', ')})`,
          });
        }
      }
    }
  }

  // Contradiction: claims the goal is met while also choosing another operation.
  const doneP = answers?.done?.noul ?? answers?.done?.probability;
  const isDone = typeof doneP === 'number' ? doneP >= 0.5 : answers?.done?.answer;
  if (isDone === true && operation !== undefined && operation !== 'done') {
    rejections.push({
      question: 'operation',
      option: String(operation),
      reason: `"done" question is true while the operation is "${operation}"`,
    });
  }

  return { ok: rejections.length === 0, rejections };
}

function summarizeQuestions(questions: Record<string, any>): Array<{ id: string; type?: string; instruction?: string }> {
  return Object.entries(questions || {}).map(([id, q]: [string, any]) => ({
    id,
    type: q?.type,
    instruction: typeof q?.instructions === 'string' ? q.instructions.slice(0, 120) : undefined,
  }));
}

/** Mirror the final verdict into the HUD, so an eliminated set is visible as such. */
function emitNoDecision(state: unknown, questions: Record<string, any>, reasons: string[], attempts: number, protocol?: string, model?: string) {
  emitDecisionEvent({
    ts: Date.now(),
    protocol: protocol as any,
    model,
    ok: false,
    latencyMs: undefined,
    error: { code: 'NO_DECISION', message: `${attempts} attempt(s): ${reasons.join('; ')}` },
    statePreview: (typeof state === 'string' ? state : JSON.stringify(state ?? '')).slice(0, 160),
    questions: summarizeQuestions(questions),
  });
}

/**
 * Ask, validate, eliminate, repeat. `maxAttempts` includes the first call (default 3).
 */
export async function decideGuarded(opts: {
  state: unknown;
  questions: Record<string, any>;
  model?: string;
  guard?: DecisionGuard;
  maxAttempts?: number;
}): Promise<GuardedDecision> {
  const guard = opts.guard || {};
  const maxAttempts = Math.max(1, Math.min(Number(opts.maxAttempts ?? 1), 5));
  const removed: Record<string, string[]> = {};
  const rejections: GuardRejection[] = [];
  const reasons: string[] = [];
  let questions = clone(opts.questions || {});
  const started = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runDecision({ state: opts.state, questions, model: opts.model });
    if (!result.ok) {
      // A sensitive gate is not a failed attempt: no model was called, no option is elimable.
      // Hand straight to the human.
      if (result.error?.code === 'HUMAN_REQUIRED') {
        return {
          ok: false,
          accepted: false,
          fallback: 'human',
          gate: result.gate,
          protocol: result.protocol,
          model: result.model,
          attempts: attempt,
          removed,
          rejections,
          reasons: [result.error.message, result.error.hint].filter(Boolean) as string[],
          latencyMs: Date.now() - started,
          error: result.error,
        };
      }
      return {
        ok: false,
        accepted: false,
        protocol: result.protocol,
        model: result.model,
        attempts: attempt,
        removed,
        rejections,
        reasons: [...reasons, result.error?.message || 'decision call failed'],
        latencyMs: Date.now() - started,
        error: result.error,
      };
    }

    const verdict = validateAnswers(result.answers || {}, guard);
    if (verdict.ok) {
      return {
        ok: true,
        accepted: true,
        protocol: result.protocol,
        model: result.model,
        answers: result.answers,
        attempts: attempt,
        removed,
        rejections,
        reasons,
        latencyMs: Date.now() - started,
      };
    }

    rejections.push(...verdict.rejections);
    for (const rejection of verdict.rejections) {
      reasons.push(rejection.reason);
      const question = questions[rejection.question];
      if (!question) continue;
      const next = withoutOption(question, rejection.option);
      questions[rejection.question] = next;
      (removed[rejection.question] ||= []).push(rejection.option);
      if (optionCount(next) < 1) {
        emitNoDecision(opts.state, opts.questions, [...reasons, `every option for "${rejection.question}" was eliminated`], attempt, result.protocol, result.model);
        return {
          ok: true,
          accepted: false,
          exhausted: true,
          fallback: 'agent',
          protocol: result.protocol,
          model: result.model,
          answers: result.answers,
          attempts: attempt,
          removed,
          rejections,
          reasons: [...reasons, `every option for "${rejection.question}" was eliminated`],
          latencyMs: Date.now() - started,
        };
      }
    }
  }

  emitNoDecision(opts.state, opts.questions, [...reasons, `${maxAttempts} attempt(s) produced no acceptable answer`], maxAttempts);
  return {
    ok: true,
    accepted: false,
    exhausted: true,
    fallback: 'agent',
    attempts: maxAttempts,
    removed,
    rejections,
    reasons: [...reasons, `${maxAttempts} attempt(s) produced no acceptable answer — the agent decides`],
    latencyMs: Date.now() - started,
  };
}
