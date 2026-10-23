/**
 * A very small Mustache-like renderer.
 *
 * The point is to let a recipe describe a document without embedding a
 * programming language. Only these forms are recognised:
 *
 *   {{path}}                     insert a value
 *   {{#if path}}...{{else}}...{{/if}}
 *   {{#unless path}}...{{/unless}}
 *   {{#each path}}...{{/each}}
 *   {{.}} {{@index}} {{@number}} {{@count}} {{@key}}
 *
 * Unknown tags are left as literal text so a typo is visible rather than
 * silently producing an empty document.
 */

import { resolveValue } from './path.ts';

export interface TemplateContext {
  root: unknown;
  value: unknown;
  index?: number;
  count?: number;
  key?: string;
  parent?: TemplateContext;
}

interface TextNode {
  type: 'text';
  value: string;
}

interface VarNode {
  type: 'var';
  path: string;
}

interface SectionNode {
  type: 'section';
  name: 'if' | 'unless' | 'each';
  path: string;
  children: TemplateNode[];
  inverse: TemplateNode[];
}

type TemplateNode = TextNode | VarNode | SectionNode;

type Token = { kind: 'text'; text: string } | { kind: 'tag'; inner: string };

export function renderTemplate(template: string, context: TemplateContext): string {
  if (!template) return '';
  return renderNodes(parse(tokenize(template)), context);
}

/** Stable, human-readable stringification used by templates and fields. */
export function stringifyValue(value: unknown, maxChars = 2000): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return clamp(value, maxChars);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return clamp(value.map((item) => stringifyValue(item, maxChars)).join(', '), maxChars);
  }
  if (typeof value === 'object') {
    try {
      return clamp(JSON.stringify(value), maxChars);
    } catch {
      return clamp(String(value), maxChars);
    }
  }
  return clamp(String(value), maxChars);
}

function clamp(value: string, maxChars: number): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0 || value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const open = source.indexOf('{{', cursor);
    if (open === -1) {
      tokens.push({ kind: 'text', text: source.slice(cursor) });
      break;
    }
    if (open > cursor) tokens.push({ kind: 'text', text: source.slice(cursor, open) });

    const close = source.indexOf('}}', open + 2);
    if (close === -1) {
      tokens.push({ kind: 'text', text: source.slice(open) });
      break;
    }

    tokens.push({ kind: 'tag', inner: source.slice(open + 2, close).trim() });
    cursor = close + 2;
  }

  return tokens;
}

function parse(tokens: Token[]): TemplateNode[] {
  const root: TemplateNode[] = [];
  const stack: { node: SectionNode; target: TemplateNode[] }[] = [];
  let target = root;

  for (const token of tokens) {
    if (token.kind === 'text') {
      if (token.text) target.push({ type: 'text', value: token.text });
      continue;
    }

    const inner = token.inner;
    if (!inner) continue;

    if (inner === 'else') {
      const frame = stack[stack.length - 1];
      if (frame) {
        frame.target = frame.node.inverse;
        target = frame.target;
      } else {
        target.push({ type: 'text', value: '{{else}}' });
      }
      continue;
    }

    if (inner.startsWith('#')) {
      const [name, ...rest] = inner.slice(1).trim().split(/\s+/);
      if (name !== 'if' && name !== 'unless' && name !== 'each') {
        target.push({ type: 'text', value: `{{${inner}}}` });
        continue;
      }
      const node: SectionNode = {
        type: 'section',
        name,
        path: rest.join(' ').trim(),
        children: [],
        inverse: [],
      };
      target.push(node);
      stack.push({ node, target: node.children });
      target = node.children;
      continue;
    }

    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      const frame = stack[stack.length - 1];
      if (frame && frame.node.name === name) {
        stack.pop();
        target = stack.length > 0 ? stack[stack.length - 1].target : root;
      } else {
        target.push({ type: 'text', value: `{{${inner}}}` });
      }
      continue;
    }

    target.push({ type: 'var', path: inner });
  }

  return root;
}

function renderNodes(nodes: TemplateNode[], context: TemplateContext): string {
  let output = '';

  for (const node of nodes) {
    if (node.type === 'text') {
      output += node.value;
      continue;
    }

    if (node.type === 'var') {
      output += stringifyValue(lookup(node.path, context));
      continue;
    }

    const value = lookup(node.path, context);

    if (node.name === 'if') {
      output += renderNodes(isTruthy(value) ? node.children : node.inverse, context);
      continue;
    }

    if (node.name === 'unless') {
      output += renderNodes(isTruthy(value) ? node.inverse : node.children, context);
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        output += renderNodes(node.children, {
          ...context,
          value: item,
          index,
          count: value.length,
          key: String(index),
          parent: context,
        });
      });
    } else if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      entries.forEach(([key, item], index) => {
        output += renderNodes(node.children, {
          ...context,
          value: item,
          index,
          count: entries.length,
          key,
          parent: context,
        });
      });
    }
  }

  return output;
}

function lookup(path: string, context: TemplateContext): unknown {
  if (path === '.' || path === '') return context.value;

  if (path.startsWith('@')) {
    const meta = findMeta(context, path);
    if (path === '@index') return meta?.index ?? 0;
    if (path === '@number') return (meta?.index ?? 0) + 1;
    if (path === '@count') return meta?.count ?? 0;
    if (path === '@key') return meta?.key ?? '';
    return undefined;
  }

  // Mustache-style context stack: the innermost object wins, then its parent.
  let cursor: TemplateContext | undefined = context;
  while (cursor) {
    const value = resolveValue(context.root, cursor.value, path);
    if (value !== undefined) return value;
    cursor = cursor.parent;
  }

  return undefined;
}

function findMeta(context: TemplateContext, key: string): TemplateContext | undefined {
  let cursor: TemplateContext | undefined = context;
  while (cursor) {
    if (key === '@index' || key === '@number') {
      if (cursor.index !== undefined) return cursor;
    } else if (key === '@count') {
      if (cursor.count !== undefined) return cursor;
    } else if (key === '@key') {
      if (cursor.key !== undefined) return cursor;
    }
    cursor = cursor.parent;
  }
  return context;
}

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === '' || value === 0) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
