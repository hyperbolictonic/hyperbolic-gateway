/**
 * Kuang recipes — JSON to Markdown, without a runtime.
 *
 *   import { deriveRecipe, renderRecipe } from '@kuang/recipe';
 *
 *   const recipe = deriveRecipe(response, schema, { name: 'Search results' });
 *   const { markdown, documents, meta } = renderRecipe(response, recipe);
 *
 * This package has no network, file system, Electron, or MCP dependencies.
 */

export type {
  DeriveOptions,
  FieldFormat,
  FieldSpec,
  JsonSchema,
  PaginationSpec,
  Recipe,
  RecipeLimits,
  RecipeMode,
  RenderMeta,
  RenderOptions,
  RenderResult,
} from './types.ts';

export { humanizeKey, pathLabel, resolvePath, resolveValue } from './path.ts';
export { renderTemplate, stringifyValue } from './template.ts';
export type { TemplateContext } from './template.ts';
export { deriveRecipe } from './derive.ts';
export { renderRecipe } from './render.ts';
export { isPlainObject, normalizeRecipe, RecipeError, validateRecipe } from './validate.ts';
