/**
 * The renderer: JSON + recipe -> Markdown.
 *
 * Rules of the house:
 *   - missing data is not an error; it renders as an empty cell;
 *   - table cells are escaped so a pipe in an API title cannot break the table;
 *   - output is capped by items and characters, and the cap is always visible;
 *   - no `eval`, no network, no file system, no clock.
 */

import type { FieldSpec, Recipe, RenderMeta, RenderOptions, RenderResult } from './types.ts';
import { humanizeKey, pathLabel, resolvePath, resolveValue } from './path.ts';
import { renderTemplate, stringifyValue } from './template.ts';
import { isPlainObject, normalizeRecipe, RecipeError } from './validate.ts';

const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_MAX_CHARS = 100_000;
const DEFAULT_FIELD_CHARS = 500;
const HARD_MAX_ITEMS = 5_000;

interface Column {
  label: string;
  spec: FieldSpec;
}

export function renderRecipe(input: unknown, recipeInput: Recipe, options: RenderOptions = {}): RenderResult {
  const { recipe, errors } = normalizeRecipe(recipeInput);
  if (errors.length > 0) throw new RecipeError(errors);

  const select = recipe.select || '$';
  const selected = select === '$' ? input : resolvePath(input, select);

  const mode = recipe.mode || (Array.isArray(selected) ? 'table' : 'document');
  const limits = {
    maxItems: clampInt(options.maxItems ?? recipe.limits?.maxItems ?? DEFAULT_MAX_ITEMS, 1, HARD_MAX_ITEMS),
    maxChars: clampInt(options.maxChars ?? recipe.limits?.maxChars ?? DEFAULT_MAX_CHARS, 500, 2_000_000),
    maxFieldChars: clampInt(recipe.limits?.maxFieldChars ?? DEFAULT_FIELD_CHARS, 20, 20_000),
  };

  let markdown = '';
  let documents: string[] = [];
  let rendered = 0;
  let truncated = false;
  let total = 0;

  if (mode === 'table') {
    const result = renderTable(selected, input, recipe, limits, options);
    markdown = result.markdown;
    documents = [markdown];
    rendered = result.rendered;
    truncated = result.truncated;
    total = result.total;
  } else if (mode === 'documents') {
    const result = renderDocuments(selected, input, recipe, limits);
    markdown = result.documents.join('\n\n---\n\n') || '_No items matched._';
    documents = result.documents;
    rendered = result.rendered;
    truncated = result.truncated;
    total = result.total;
  } else {
    const result = renderDocument(selected, input, recipe, limits, options);
    markdown = result.markdown;
    documents = [markdown];
    rendered = result.rendered;
    truncated = result.truncated;
    total = result.total;
  }

  const capped = capMarkdown(markdown, limits.maxChars);
  if (capped.truncated) {
    truncated = true;
    if (documents.length === 1) documents = [capped.markdown];
  }

  const meta: RenderMeta = {
    mode,
    select,
    selected: total,
    rendered,
    truncated,
    chars: capped.markdown.length,
  };

  return { markdown: capped.markdown, documents, meta };
}

function renderTable(
  selected: unknown,
  root: unknown,
  recipe: Recipe,
  limits: { maxItems: number; maxChars: number; maxFieldChars: number },
  options: RenderOptions,
): { markdown: string; rendered: number; truncated: boolean; total: number } {
  const isArray = Array.isArray(selected);
  const items = isArray ? selected : selected === undefined || selected === null ? [] : [selected];
  const total = items.length;
  const shown = items.slice(0, limits.maxItems);
  const configured = columnsFromRecipe(recipe.fields);

  let body: string;
  if (!isArray && isPlainObject(selected) && configured.length === 0) {
    body = renderKeyValueTable(selected, limits.maxFieldChars);
  } else {
    const columns = configured.length > 0 ? configured : inferColumns(shown);
    body = renderGrid(shown, root, columns, limits.maxFieldChars);
  }

  if (total === 0) body = '_No items matched._';

  const title = options.includeTitle !== false && recipe.name ? `## ${recipe.name}\n\n` : '';
  const dropped = total > shown.length;
  const note = dropped ? `\n\n_Showing ${shown.length} of ${total} items._` : '';

  return {
    markdown: `${title}${body}${note}`.trim(),
    rendered: shown.length,
    truncated: dropped,
    total,
  };
}

function renderDocuments(
  selected: unknown,
  root: unknown,
  recipe: Recipe,
  limits: { maxItems: number; maxChars: number; maxFieldChars: number },
): { documents: string[]; rendered: number; truncated: boolean; total: number } {
  const items = Array.isArray(selected) ? selected : selected === undefined || selected === null ? [] : [selected];
  const total = items.length;
  const shown = items.slice(0, limits.maxItems);
  const count = shown.length;

  const prepared = shown.map((item, index) => {
    const context = { root, value: item, index, count };
    const title = documentTitle(item, recipe, context, index);
    const body = recipe.template
      ? renderTemplate(recipe.template, context).trim()
      : renderFieldList(item, root, recipe, limits.maxFieldChars);
    return composeDocument(title, body);
  });

  const capped = capDocuments(prepared, limits.maxChars, total > count);

  return {
    documents: capped.documents,
    rendered: capped.documents.length,
    truncated: capped.truncated,
    total,
  };
}

function renderDocument(
  selected: unknown,
  root: unknown,
  recipe: Recipe,
  limits: { maxItems: number; maxChars: number; maxFieldChars: number },
  options: RenderOptions,
): { markdown: string; rendered: number; truncated: boolean; total: number } {
  const empty = selected === undefined || selected === null;
  if (empty) {
    return { markdown: '_No items matched._', rendered: 0, truncated: false, total: 0 };
  }

  const context = { root, value: selected };
  const title = recipe.title
    ? renderTemplate(recipe.title, context).trim()
    : recipe.name || 'Result';
  const body = recipe.template
    ? renderTemplate(recipe.template, context).trim()
    : renderFieldList(selected, root, recipe, limits.maxFieldChars);

  const heading = options.includeTitle === false ? '' : composeDocument(title, '').trim();
  const markdown = [heading, body].filter(Boolean).join('\n\n').trim() || '_No items matched._';

  return { markdown, rendered: 1, truncated: false, total: 1 };
}

function composeDocument(title: string, body: string): string {
  const trimmedBody = body.trim();
  const hasHeading = /^#{1,6}\s/.test(trimmedBody);
  const heading = title && !hasHeading ? `## ${title}` : '';
  return [heading, trimmedBody].filter(Boolean).join('\n\n').trim();
}

function documentTitle(
  item: unknown,
  recipe: Recipe,
  context: { root: unknown; value: unknown; index: number; count: number },
  index: number,
): string {
  if (recipe.title) {
    const rendered = renderTemplate(recipe.title, context).trim();
    if (rendered) return rendered;
  }

  if (isPlainObject(item)) {
    for (const key of ['title', 'name', 'label', 'headline', 'id']) {
      const value = item[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return stringifyValue(value, 200);
      }
    }
  }

  if (recipe.name) return `${recipe.name} ${index + 1}`;
  return `Item ${index + 1}`;
}

function columnsFromRecipe(fields: Recipe['fields']): Column[] {
  if (!fields) return [];

  if (Array.isArray(fields)) {
    return fields
      .filter((field): field is FieldSpec => isPlainObject(field) && typeof field.path === 'string')
      .map((field, index) => ({
        label: field.label || humanizeKey(pathLabel(field.path)) || `Field ${index + 1}`,
        spec: field,
      }));
  }

  return Object.entries(fields)
    .map(([label, value], index) => {
      const spec: FieldSpec = typeof value === 'string' ? { path: value } : value;
      if (!spec || typeof spec.path !== 'string') return null;
      return {
        label: spec.label || label || humanizeKey(pathLabel(spec.path)) || `Field ${index + 1}`,
        spec,
      };
    })
    .filter((column): column is Column => column !== null);
}

function inferColumns(items: unknown[]): Column[] {
  if (items.length === 0) return [];

  const sample = items.slice(0, 20);
  if (sample.every((item) => !isPlainObject(item))) {
    return [{ label: 'Value', spec: { path: '.' } }];
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const item of sample) {
    if (!isPlainObject(item)) continue;
    for (const key of Object.keys(item)) {
      if (seen.has(key)) continue;
      seen.add(key);
      const value = item[key];
      if (value !== null && typeof value !== 'object') {
        keys.push(key);
      } else if (keys.length === 0 && value !== undefined) {
        keys.push(key);
      }
    }
  }

  const firstObject = sample.find((item) => isPlainObject(item)) as Record<string, unknown> | undefined;
  const usable = keys.length > 0 ? keys : firstObject ? Object.keys(firstObject) : [];
  if (usable.length === 0) return [{ label: 'Value', spec: { path: '.' } }];

  return usable.slice(0, 12).map((key) => {
    const value = (sample.find((item) => isPlainObject(item) && item[key] !== undefined) as any)?.[key];
    return {
      label: humanizeKey(key),
      spec: { path: key, format: formatForSample(value) },
    };
  });
}

function formatForSample(value: unknown): FieldSpec['format'] {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) return 'json';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return 'date';
  if (typeof value === 'string' && /^https?:\/\//.test(value)) return 'url';
  return 'text';
}

function renderGrid(items: unknown[], root: unknown, columns: Column[], maxFieldChars: number): string {
  if (columns.length === 0) return '_No fields to show._';

  const header = `| ${columns.map((column) => escapeTable(column.label)).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const rows = items.map((item) => {
    const cells = columns.map((column) => {
      const value = resolveValue(root, item, column.spec.path);
      return escapeTable(formatValue(value, column.spec, column.label, maxFieldChars));
    });
    return `| ${cells.join(' | ')} |`;
  });

  return [header, divider, ...rows].join('\n');
}

function renderKeyValueTable(value: Record<string, unknown>, maxFieldChars: number): string {
  const keys = Object.keys(value).slice(0, 60);
  if (keys.length === 0) return '_No fields to show._';

  const rows = keys.map((key) => {
    const field = value[key];
    const spec: FieldSpec = { path: key, format: formatForSample(field) };
    const rendered = escapeTable(formatValue(field, spec, humanizeKey(key), maxFieldChars));
    return `| **${escapeTable(key)}** | ${rendered} |`;
  });

  return ['| Field | Value |', '| --- | --- |', ...rows].join('\n');
}

function renderFieldList(item: unknown, root: unknown, recipe: Recipe, maxFieldChars: number): string {
  if (!isPlainObject(item)) return stringifyValue(item, maxFieldChars);

  const configured = columnsFromRecipe(recipe.fields);
  const columns = configured.length > 0 ? configured : inferColumns([item]);
  if (columns.length === 0) return '';

  return columns
    .map((column) => {
      const value = resolveValue(root, item, column.spec.path);
      const text = formatValue(value, column.spec, column.label, maxFieldChars);
      return `- **${column.label}:** ${text || '—'}`;
    })
    .join('\n');
}

function formatValue(value: unknown, spec: FieldSpec, label: string, maxFieldChars: number): string {
  if ((value === undefined || value === null || value === '') && spec.fallback !== undefined) {
    value = spec.fallback;
  }
  if (value === undefined || value === null) return '';

  let text: string;

  switch (spec.format) {
    case 'number': {
      const number = typeof value === 'number' ? value : Number(value);
      text = Number.isFinite(number) ? String(number) : stringifyValue(value);
      break;
    }
    case 'integer': {
      const number = typeof value === 'number' ? value : Number(value);
      text = Number.isFinite(number) ? String(Math.round(number)) : stringifyValue(value);
      break;
    }
    case 'boolean': {
      if (value === true || value === 'true') text = 'true';
      else if (value === false || value === 'false') text = 'false';
      else text = value ? 'true' : 'false';
      break;
    }
    case 'date': {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        text = stringifyValue(value);
      } else {
        const iso = date.toISOString();
        text = iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
      }
      break;
    }
    case 'url': {
      const url = stringifyValue(value);
      text = url ? (url.startsWith('<') ? url : `<${url}>`) : '';
      break;
    }
    case 'image': {
      const url = stringifyValue(value);
      text = url ? `![${label}](${url})` : '';
      break;
    }
    case 'json': {
      const json = typeof value === 'string' ? value : safeJson(value);
      text = json ? `\`${json.replace(/`/g, '\\`')}\`` : '';
      break;
    }
    case 'code': {
      const code = stringifyValue(value);
      text = code ? `\`${code.replace(/`/g, '\\`')}\`` : '';
      break;
    }
    case 'text':
    default:
      text = stringifyValue(value);
      break;
  }

  if (spec.prefix) text = `${spec.prefix}${text}`;
  if (spec.suffix) text = `${text}${spec.suffix}`;

  return truncate(text, spec.maxChars ?? maxFieldChars);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return stringifyValue(value);
  }
}

function truncate(value: string, maxChars: number): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0 || value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function escapeTable(value: string): string {
  return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim();
}

function capDocuments(
  documents: string[],
  maxChars: number,
  alreadyTruncated: boolean,
): { documents: string[]; truncated: boolean } {
  const kept: string[] = [];
  let budget = maxChars;
  let truncated = alreadyTruncated;

  for (const document of documents) {
    const separator = kept.length > 0 ? 7 : 0;
    const allowance = budget - separator;
    if (allowance <= 120) {
      truncated = true;
      break;
    }
    if (document.length <= allowance) {
      kept.push(document);
      budget = allowance - document.length;
    } else {
      kept.push(capDocument(document, allowance));
      truncated = true;
      break;
    }
  }

  return { documents: kept, truncated };
}

function capDocument(document: string, allowance: number): string {
  const reserve = 80;
  const slice = document.slice(0, Math.max(0, allowance - reserve)).trimEnd();
  const omitted = document.length - slice.length;
  return `${slice}\n\n_… truncated ${omitted} characters._`;
}

function capMarkdown(markdown: string, maxChars: number): { markdown: string; truncated: boolean } {
  if (markdown.length <= maxChars) return { markdown, truncated: false };

  const budget = Math.max(0, maxChars - 120);
  let slice = markdown.slice(0, budget);
  const lastNewline = slice.lastIndexOf('\n');
  if (lastNewline > budget * 0.6) slice = slice.slice(0, lastNewline);

  const omitted = markdown.length - slice.length;
  return {
    markdown: `${slice.trimEnd()}\n\n_… truncated ${omitted} characters._`,
    truncated: true,
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
