/**
 * Compile a successful `drive` run into a replayable recipe.
 *
 * The decision loop already produced the hard part — a verified path. Turning it into descriptor
 * steps means the next visit is deterministic and free. Only *verified* steps are compiled: a step
 * that failed, or was merely planned, is not a path.
 *
 * Pure function: no Electron, no I/O, unit-tested offline.
 */
import type { RecipeStep } from './recipe-store.js';

export interface DriveStepLike {
  operation: string;
  target?: number | string;
  targetName?: string;
  /** Component anchor captured from the host's exported surface. */
  signature?: string;
  ok?: boolean;
  note?: string;
}

export interface CompileOptions {
  /** Values the caller supplied to drive, keyed by field name or component id. */
  values?: Record<string, string>;
}

function valueFor(step: DriveStepLike, values: Record<string, string> = {}): string | undefined {
  const name = (step.targetName || '').toLowerCase();
  const id = String(step.target ?? '');
  if (step.targetName) {
    for (const [key, value] of Object.entries(values)) {
      const k = key.toLowerCase();
      if (name === k || name.includes(k) || k.includes(name)) return value;
    }
  }
  if (id && values[id] !== undefined) return values[id];
  return undefined;
}

/**
 * Map drive steps to recipe steps. Click steps always become `click`; a `type_text` step becomes a
 * `type` step only when its value can be recovered — an untyped-into field cannot be replayed.
 * Steps without a usable target name are skipped rather than guessed.
 */
export function compileDriveSteps(steps: DriveStepLike[], options: CompileOptions = {}): RecipeStep[] {
  const out: RecipeStep[] = [];
  for (const step of steps) {
    if (!step || step.ok !== true) continue;
    if (step.note === 'dry run') continue;
    const target = String(step.targetName || '').trim();
    if (!target) continue;

    if (step.operation === 'click' || step.operation === 'select') {
      out.push({ action: 'click', target, ...(step.signature ? { signature: step.signature } : {}) });
      continue;
    }
    if (step.operation === 'type_text') {
      const value = valueFor(step, options.values);
      if (value === undefined) continue;
      out.push({ action: 'type', target, value, ...(step.signature ? { signature: step.signature } : {}) });
      continue;
    }
    // scroll / wait / done / blocked are not replayable actions
  }
  return out;
}
