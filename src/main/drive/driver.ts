/**
 * `drive` — the observe → decide → act loop, in code.
 *
 * This is the latency win from jev-ultrafast: one decision-model call per step instead of an
 * agent turn per step. It is deliberately **plumbing, not policy**:
 *
 *   - it never interprets the goal; the caller supplies it and the questions are fixed
 *   - it never generates text: when the chosen operation is `type_text`, it needs a value the
 *     caller supplied, otherwise it stops and asks (`needs_input`)
 *   - it never acts on a rejected decision (guard + elimination per step)
 *   - it stops on a sensitive gate; the human hand-off is raised by the caller
 *   - it stops on `done`, `blocked`, exhausted candidates, a failed action, or `maxSteps`
 *
 * Every step is returned in a transcript, and the existing ledger records the individual `act`
 * calls, so a run is auditable after the fact.
 */
import type { Primitives } from '../primitives/primitives.js';
import { decideGuarded } from '../decide/decision-guard.js';

export type DriveStatus =
  | 'done'
  | 'blocked'
  | 'human_required'
  | 'needs_input'
  | 'needs_agent'
  | 'failed'
  | 'max_steps'
  | 'error';

export interface DriveStep {
  step: number;
  operation: string;
  target?: number;
  targetName?: string;
  /** Component anchor from the host's exported surface. */
  signature?: string;
  /** Characters typed — never the text itself. */
  typedChars?: number;
  ok: boolean;
  urlChanged?: boolean;
  warning?: string;
  note?: string;
}

export interface DriveResult {
  status: DriveStatus;
  goal: string;
  steps: DriveStep[];
  message: string;
  /** Present for `needs_input`: which field needs a value, and what to pass. */
  field?: { id: number; name: string; tag?: string };
  /** Present for `human_required`. */
  gate?: 'age_verification' | 'captcha';
  reasons?: string[];
  url?: string;
  title?: string;
  dryRun?: boolean;
  durationMs: number;
}

export interface DriveOptions {
  goal: string;
  /** Field name (or component id) → text to type. Jev decides *where*; you supply *what*. */
  values?: Record<string, string>;
  maxSteps?: number;
  threshold?: number;
  maxAttempts?: number;
  dryRun?: boolean;
  /** Page text for gate detection + context (default true). */
  includePageText?: boolean;
}

const OPERATIONS = {
  click: 'Actuate a control: submit, dismiss, choose an option, follow a link, sort — INCLUDING clicking a suggestion from an open autocomplete list after typing.',
  type_text: 'Type a value into a text field or editable control. If a suggestion list is already open, prefer clicking the matching suggestion instead.',
  done: 'The goal is already satisfied by what is visible.',
  blocked: 'A wall (CAPTCHA, consent, login, payment) prevents progress.',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function criteriaFor(components: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of components.slice(0, 40)) {
    out[String(c.id)] = `${c.role}${c.name ? `: ${c.name}` : ''}`.slice(0, 100);
  }
  return out;
}

function lookupValue(values: Record<string, string> | undefined, component: any): string | undefined {
  if (!values) return undefined;
  const id = String(component.id);
  if (values[id] !== undefined) return values[id];
  const name = (component.name || '').trim();
  if (name && values[name] !== undefined) return values[name];
  // Case-insensitive name match, then a contains match, so callers needn't be exact.
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(values)) {
    const k = key.trim().toLowerCase();
    if (k === lower) return value;
  }
  for (const [key, value] of Object.entries(values)) {
    const k = key.trim().toLowerCase();
    if (k.length > 2 && (lower.includes(k) || k.includes(lower))) return value;
  }
  return undefined;
}

/**
 * Run the loop until a stop condition. Never throws: every failure is a typed status.
 */
export async function driveTask(primitives: Primitives, opts: DriveOptions): Promise<DriveResult> {
  const started = Date.now();
  const maxSteps = Math.max(1, Math.min(Number(opts.maxSteps ?? 10), 25));
  const threshold = typeof opts.threshold === 'number' ? opts.threshold : 0.45;
  const maxAttempts = Math.max(1, Math.min(Number(opts.maxAttempts ?? 2), 3));
  const steps: DriveStep[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    const comps = await primitives.observe({ as: 'components' });
    const components: any[] = comps.components || [];
    const url = comps.url;
    const title = comps.title;

    if (!components.length) {
      return { status: 'blocked', goal: opts.goal, steps, message: 'No interactive components on the page.', url, title, durationMs: Date.now() - started };
    }

    const clickable = components.filter((c) => (c.actions || []).includes('click') && c.name);
    const typeable = components.filter((c) => (c.actions || []).includes('type'));

    let pageText = '';
    if (opts.includePageText !== false) {
      const text = await primitives.observe({ as: 'text', budget: 2500 }).catch(() => null);
      pageText = typeof text?.text === 'string' ? text.text : '';
    }

    const lastStep = steps[steps.length - 1];
    const lastActionLine = lastStep
      ? `Last action: ${lastStep.operation === 'type_text' ? `typed ${lastStep.typedChars || 0} characters into` : 'clicked'} "${lastStep.targetName || `#${lastStep.target}`}". If that opened a suggestion list or a menu, choose the matching item with click; otherwise continue toward the goal.`
      : '';

    const state = [
      `Goal: ${opts.goal}`,
      title ? `Page: ${title}` : '',
      lastActionLine,
      'Visible components:',
      ...components.slice(0, 40).map((c) => `[${c.id}] ${c.role} "${c.name || ''}"${c.value ? ` value "${c.value}"` : ''} {${(c.actions || []).join(',')}}`),
      pageText ? `\nVisible page text:\n${pageText.slice(0, 2500)}` : '',
    ].filter(Boolean).join('\n');

    const questions: Record<string, any> = {
      operation: { type: 'choice', instructions: 'What is the next operation to reach the goal?', criteria: OPERATIONS },
      done: { type: 'noul', instructions: 'Is the goal already satisfied by the visible state?' },
    };
    if (clickable.length) {
      questions.click_target = { type: 'choice', instructions: 'Which component should be clicked?', criteria: criteriaFor(clickable) };
    }
    if (typeable.length) {
      questions.type_text_target = { type: 'choice', instructions: 'Which component should be typed into?', criteria: criteriaFor(typeable) };
    }

    const decision = await decideGuarded({
      state,
      questions,
      guard: { threshold, components: components.map((c) => ({ id: c.id, actions: c.actions, name: c.name })) },
      maxAttempts,
      pageUrl: url,
    } as any);

    if (!decision.ok && (decision as any).gate) {
      return {
        status: 'human_required',
        goal: opts.goal,
        steps,
        message: decision.reasons?.[0] || 'A human is required.',
        gate: (decision as any).gate,
        reasons: decision.reasons,
        url,
        title,
        durationMs: Date.now() - started,
      };
    }
    if (!decision.accepted) {
      return {
        status: 'needs_agent',
        goal: opts.goal,
        steps,
        message: decision.reasons?.join('; ') || 'The decision model could not choose an acceptable action.',
        reasons: decision.reasons,
        url,
        title,
        durationMs: Date.now() - started,
      };
    }

    const operation = String((decision.answers as any)?.operation?.choice || '');
    const targetAnswer = (decision.answers as any)?.[`${operation}_target`];
    const targetId = targetAnswer?.choice !== undefined ? Number(targetAnswer.choice) : undefined;
    const component = targetId !== undefined ? components.find((c) => Number(c.id) === targetId) : undefined;
    const targetName = component?.name;
    const signature = component?.signature;

    if (operation === 'done') {
      return { status: 'done', goal: opts.goal, steps, message: 'The model reports the goal is satisfied.', url, title, durationMs: Date.now() - started };
    }
    if (operation === 'blocked') {
      return {
        status: 'blocked',
        goal: opts.goal,
        steps,
        message: 'The model reports a wall (no deterministic gate matched, so the agent decides what to do).',
        url,
        title,
        durationMs: Date.now() - started,
      };
    }
    if (operation !== 'click' && operation !== 'type_text') {
      return { status: 'needs_agent', goal: opts.goal, steps, message: `Unsupported operation "${operation}".`, url, title, durationMs: Date.now() - started };
    }
    if (!component) {
      return {
        status: 'needs_agent',
        goal: opts.goal,
        steps,
        message: `The model chose ${operation} on component ${String(targetId)} (answers: ${Object.keys((decision.answers as any) || {}).join(', ')}) but it is no longer present.`,
        url,
        title,
        durationMs: Date.now() - started,
      };
    }

    let text: string | undefined;
    if (operation === 'type_text') {
      text = lookupValue(opts.values, component);
      if (text === undefined) {
        return {
          status: 'needs_input',
          goal: opts.goal,
          steps,
          message: `The next step is to type into "${component.name || `#${component.id}`}". Supply a value for it and call drive again.`,
          field: { id: Number(component.id), name: component.name || '', tag: component.tag },
          url,
          title,
          durationMs: Date.now() - started,
        };
      }
    }

    if (opts.dryRun) {
      steps.push({ step, operation, target: Number(component.id), targetName, signature, typedChars: text?.length, ok: true, note: 'dry run' });
      return {
        status: 'needs_agent',
        goal: opts.goal,
        steps,
        message: `Dry run: would ${operation === 'type_text' ? `type ${text!.length} chars into` : 'click'} "${component.name || `#${component.id}`}".`,
        url,
        title,
        dryRun: true,
        durationMs: Date.now() - started,
      };
    }

    const acted: any = await primitives
      .act({
        markId: Number(component.id),
        action: operation === 'type_text' ? 'type' : 'click',
        text,
        clearFirst: operation === 'type_text',
      } as any)
      .catch((err: any) => ({ ok: false, error: { code: 'ACTION_FAILED', message: String(err?.message || err) } }));

    const urlChanged = Boolean(acted?.delta?.urlChanged);
    const ok = acted?.ok === true;
    steps.push({
      step,
      operation,
      target: Number(component.id),
      targetName,
      signature,
      typedChars: text?.length,
      ok,
      urlChanged,
      warning: acted?.warning,
      note: ok ? undefined : acted?.error?.code,
    });

    if (!ok) {
      // One retry for a click that provably did nothing; then stop rather than flail.
      if (step < maxSteps && reactedWouldRetry(acted)) {
        continue;
      }
      return {
        status: 'failed',
        goal: opts.goal,
        steps,
        message: acted?.error?.message || 'The action did not succeed.',
        url,
        title,
        durationMs: Date.now() - started,
      };
    }

    // Let the page settle before the next look — cheap, and it stops us reading a half-rendered state.
    await primitives.waitFor([{ type: 'stable', target: 'text', holdMs: 250 }], { timeoutMs: 2500 }).catch(() => {});
    await sleep(150);
  }

  return {
    status: 'max_steps',
    goal: opts.goal,
    steps,
    message: `Stopped after ${maxSteps} steps without reaching the goal.`,
    durationMs: Date.now() - started,
  };
}

/** A no-effect click is worth one more attempt; a rejected type is not (the field refuses input). */
function reactedWouldRetry(acted: any): boolean {
  const code = acted?.error?.code;
  if (code === 'TYPE_NO_EFFECT') return false;
  if (code === 'STALE_REF' || code === 'NO_TARGET') return false;
  return true;
}
