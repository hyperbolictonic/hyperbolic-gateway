/**
 * Recipe replay — walk a stored path with no model calls.
 *
 * Every step is a descriptor, never a mark id or a CSS selector: the page is re-read at replay time
 * and the control is found by what a person would see. If a step cannot be resolved, or its
 * `expect` conditions do not hold, the replay stops at that step and reports where — a half-applied
 * recipe is worse than a refusal.
 *
 * The runner is injected (Primitives satisfies it) so this module stays testable and free of
 * Electron imports.
 */
import type { Recipe, RecipeStep } from './recipe-store.js';

export interface RecipeRunner {
  act(options: {
    targetText?: string;
    action: 'click' | 'type' | 'hover';
    text?: string;
    clearFirst?: boolean;
  }): Promise<unknown>;
  waitFor(conditions: Array<Record<string, unknown>>, options?: { timeoutMs?: number }): Promise<{ ok: boolean }>;
}

export interface ReplayStepResult {
  index: number;
  step: RecipeStep;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface ReplayResult {
  status: 'ok' | 'failed';
  recipeId: string;
  steps: ReplayStepResult[];
  failedAt?: number;
  message: string;
  ms: number;
}

export async function replayRecipe(
  runner: RecipeRunner,
  recipe: Recipe,
  options: { stepTimeoutMs?: number; expectTimeoutMs?: number } = {}
): Promise<ReplayResult> {
  const started = Date.now();
  const steps: ReplayStepResult[] = [];
  const stepTimeoutMs = options.stepTimeoutMs ?? 12000;
  const expectTimeoutMs = options.expectTimeoutMs ?? 8000;

  for (const [index, step] of recipe.steps.entries()) {
    const stepStarted = Date.now();
    try {
      const action = step.action === 'type' ? 'type' : 'click';
      const pending = runner.act({
        targetText: step.target,
        action,
        text: step.action === 'type' ? step.value : undefined,
        clearFirst: step.action === 'type',
      });
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`step ${index + 1} timed out after ${stepTimeoutMs}ms`)), stepTimeoutMs)
      );
      await Promise.race([pending, timeout]);

      if (step.expect?.length) {
        const checked = await runner.waitFor(step.expect, { timeoutMs: expectTimeoutMs });
        if (!checked.ok) throw new Error(`expectation not met after step ${index + 1}`);
      }

      steps.push({ index, step, ok: true, ms: Date.now() - stepStarted });
    } catch (err: any) {
      const message = String(err?.message || err);
      steps.push({ index, step, ok: false, ms: Date.now() - stepStarted, error: message });
      return {
        status: 'failed',
        recipeId: recipe.id,
        steps,
        failedAt: index,
        message: `Stopped at step ${index + 1}/${recipe.steps.length}: ${message}`,
        ms: Date.now() - started,
      };
    }
  }

  return {
    status: 'ok',
    recipeId: recipe.id,
    steps,
    message: `Replayed ${steps.length} step${steps.length === 1 ? '' : 's'} with no model calls.`,
    ms: Date.now() - started,
  };
}
