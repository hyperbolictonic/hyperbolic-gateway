/**
 * Navigation recipes — a page path compiled into replayable steps.
 *
 * The expensive part of a browser task is deciding. Once a path has been walked successfully, the
 * decision can be stored as *descriptors* (visible text, an action, an expected outcome) and
 * replayed with zero model calls. That is the same lifecycle as `wrap_create` → `wrap_run`, applied
 * to UI: decide once, replay cheap.
 *
 * Storage: `data/recipes.json` (gitignored). A recipe belongs to an origin + path pattern; it is
 * retired after repeated failures rather than silently retried forever.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from '../data-paths.js';

export interface RecipeStep {
  action: 'click' | 'type';
  /** Visible text anchor (or a form field's label / placeholder / name). */
  target: string;
  /** Value for `action: "type"`. */
  value?: string;
  /** wait_for conditions asserted after the step. */
  expect?: Array<Record<string, unknown>>;
  /** Component anchor (`tag:hash`) captured from the host's exported surface. */
  signature?: string;
}

export interface Recipe {
  id: string;
  name: string;
  origin: string;
  /** Pathname, or a glob ending in `*` (e.g. `/search/*`). */
  path: string;
  steps: RecipeStep[];
  attempts: number;
  successes: number;
  consecutiveFailures: number;
  lastVerified?: number;
  createdAt: number;
}

export interface RecipeStore {
  version: 1;
  recipes: Recipe[];
}

const FILE = dataPath('recipes.json');
const MAX_RECIPES = 200;
const RETIRE_AFTER_FAILURES = 3;

function emptyStore(): RecipeStore {
  return { version: 1, recipes: [] };
}

export function loadRecipes(): RecipeStore {
  try {
    if (!fs.existsSync(FILE)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.recipes)) return emptyStore();
    return { version: 1, recipes: parsed.recipes.filter((r: any) => r && r.id && Array.isArray(r.steps)) };
  } catch {
    return emptyStore();
  }
}

function persist(store: RecipeStore): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // A read-only data dir must not take the browser down; the in-memory result is still returned.
  }
}

function normalisePath(input: string): string {
  try {
    const u = new URL(input, 'https://placeholder.invalid');
    return u.pathname || '/';
  } catch {
    return input.startsWith('/') ? input : `/${input}`;
  }
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function pathMatches(recipePath: string, pathname: string): boolean {
  if (recipePath === pathname) return true;
  if (recipePath.endsWith('*')) return pathname.startsWith(recipePath.slice(0, -1));
  return false;
}

/** Recipes for this URL, most-recently-verified first. */
export function recipesFor(url: string): Recipe[] {
  const origin = originOf(url);
  const pathname = normalisePath(url);
  return loadRecipes()
    .recipes.filter((r) => r.origin === origin && pathMatches(r.path, pathname) && r.consecutiveFailures < RETIRE_AFTER_FAILURES)
    .sort((a, b) => (b.lastVerified || 0) - (a.lastVerified || 0));
}

export interface SaveRecipeInput {
  name?: string;
  url: string;
  path?: string;
  steps: RecipeStep[];
}

export function saveRecipe(input: SaveRecipeInput): { ok: boolean; recipe?: Recipe; errors: string[] } {
  const errors: string[] = [];
  const origin = originOf(input.url);
  if (!origin) errors.push('url must be absolute (http/https)');
  if (!Array.isArray(input.steps) || input.steps.length === 0) errors.push('steps must be a non-empty array');

  const steps: RecipeStep[] = [];
  for (const [i, raw] of (input.steps || []).entries()) {
    if (!raw || (raw.action !== 'click' && raw.action !== 'type')) {
      errors.push(`step ${i + 1}: action must be "click" or "type"`);
      continue;
    }
    const target = String(raw.target || '').trim();
    if (!target) {
      errors.push(`step ${i + 1}: target is required`);
      continue;
    }
    if (raw.action === 'type' && typeof raw.value !== 'string') {
      errors.push(`step ${i + 1}: type steps need a value`);
      continue;
    }
    const signature = typeof raw.signature === 'string' ? raw.signature.trim() : '';
    if (signature && signature.length > 120) {
      errors.push(`step ${i + 1}: signature is too long`);
      continue;
    }
    steps.push({
      action: raw.action,
      target,
      value: raw.action === 'type' ? String(raw.value) : undefined,
      expect: Array.isArray(raw.expect) ? raw.expect.slice(0, 5) : undefined,
      ...(signature ? { signature } : {}),
    });
  }
  if (errors.length) return { ok: false, errors };

  const store = loadRecipes();
  const recipePath = input.path ? normalisePath(input.path) : normalisePath(input.url);
  const existing = store.recipes.find((r) => r.origin === origin && r.path === recipePath && r.name === (input.name || recipePath));

  const recipe: Recipe = existing
    ? { ...existing, steps, name: input.name || existing.name }
    : {
        id: `rcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name: input.name || `${origin}${recipePath}`,
        origin,
        path: recipePath,
        steps,
        attempts: 0,
        successes: 0,
        consecutiveFailures: 0,
        createdAt: Date.now(),
      };

  const next = store.recipes.filter((r) => r.id !== recipe.id);
  next.unshift(recipe);
  persist({ version: 1, recipes: next.slice(0, MAX_RECIPES) });
  return { ok: true, recipe, errors: [] };
}

export function deleteRecipe(idOrUrl: string): boolean {
  const store = loadRecipes();
  const before = store.recipes.length;
  const remaining = store.recipes.filter((r) => r.id !== idOrUrl && !(r.origin + r.path === idOrUrl));
  if (remaining.length === before) return false;
  persist({ version: 1, recipes: remaining });
  return true;
}

/** Record the outcome of a replay; a recipe is retired after RETIRE_AFTER_FAILURES consecutive misses. */
export function recordResult(id: string, ok: boolean): Recipe | null {
  const store = loadRecipes();
  const recipe = store.recipes.find((r) => r.id === id);
  if (!recipe) return null;
  recipe.attempts += 1;
  if (ok) {
    recipe.successes += 1;
    recipe.consecutiveFailures = 0;
    recipe.lastVerified = Date.now();
  } else {
    recipe.consecutiveFailures += 1;
  }
  persist(store);
  return recipe;
}

/** A structural change is not a flaky miss: retire immediately instead of burning three attempts. */
export function retireRecipe(id: string): Recipe | null {
  const store = loadRecipes();
  const recipe = store.recipes.find((r) => r.id === id);
  if (!recipe) return null;
  recipe.attempts += 1;
  recipe.consecutiveFailures = RETIRE_AFTER_FAILURES;
  persist(store);
  return recipe;
}
