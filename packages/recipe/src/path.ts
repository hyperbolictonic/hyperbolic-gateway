/**
 * Path resolution for recipes.
 *
 * This is a deliberately small subset of JSONPath, matching the syntax Kuang
 * already exposes to agents:
 *
 *   $.items[*].name
 *   results[0].title
 *   items[0..9]
 *   items[?score>10].name
 *   data['odd.key']
 *   *
 *
 * It returns `undefined` for a missing path instead of throwing. Filters read
 * values only; there is no evaluation of arbitrary JavaScript.
 */

export function resolvePath(root: unknown, pathStr: string): unknown {
  if (root === undefined || root === null) return undefined;
  if (!pathStr || pathStr === '$' || pathStr === '.') return root;

  const normalized = pathStr.replace(/^\$\.?/, '');
  if (!normalized) return root;

  const tokens = tokenizePath(normalized);
  let current: any = root;

  for (let i = 0; i < tokens.length; i++) {
    if (current === undefined || current === null) return undefined;
    const token = tokens[i];

    if (token.startsWith('[') && token.endsWith(']')) {
      const inner = token.slice(1, -1).trim();

      if (inner === '*') {
        if (!Array.isArray(current)) return undefined;
        const rest = tokens.slice(i + 1);
        if (rest.length === 0) return current;
        const subPath = rest.join('.');
        return current.map((item) => resolvePath(item, subPath)).filter((value) => value !== undefined);
      }

      if (inner.includes('..')) {
        if (!Array.isArray(current)) return undefined;
        const [startStr, endStr] = inner.split('..');
        const start = startStr ? parseInt(startStr, 10) : 0;
        const end = endStr ? parseInt(endStr, 10) : current.length;
        const sliced = current.slice(start, end);
        const rest = tokens.slice(i + 1);
        if (rest.length > 0) {
          const subPath = rest.join('.');
          return sliced.map((item) => resolvePath(item, subPath)).filter((value) => value !== undefined);
        }
        current = sliced;
        continue;
      }

      if (inner.startsWith('?')) {
        if (!Array.isArray(current)) return undefined;
        const filtered = evaluateFilter(current, inner.slice(1).trim());
        const rest = tokens.slice(i + 1);
        if (rest.length > 0) {
          const subPath = rest.join('.');
          return filtered.map((item) => resolvePath(item, subPath)).filter((value) => value !== undefined);
        }
        current = filtered;
        continue;
      }

      const index = parseInt(inner, 10);
      if (!isNaN(index)) {
        current = Array.isArray(current) ? current[index] : undefined;
        continue;
      }

      const key = inner.replace(/^['"]|['"]$/g, '');
      current = current[key];
      continue;
    }

    if (token === '*') {
      if (typeof current !== 'object' || Array.isArray(current)) return undefined;
      const rest = tokens.slice(i + 1);
      if (rest.length === 0) return Object.values(current);
      const subPath = rest.join('.');
      return Object.values(current)
        .map((value) => resolvePath(value, subPath))
        .filter((value) => value !== undefined);
    }

    current = current[token];
  }

  return current;
}

/**
 * Resolve `path` against the current item. A path that starts with `$` is
 * resolved against the response root instead, which is how templates reach
 * metadata such as `{{$.meta.total}}`.
 */
export function resolveValue(root: unknown, current: unknown, path: string): unknown {
  if (!path || path === '.') return current;
  if (path.startsWith('$')) return resolvePath(root, path);
  return resolvePath(current, path);
}

export function humanizeKey(key: string): string {
  const cleaned = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!cleaned) return key;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** The last readable segment of a path, used for default labels. */
export function pathLabel(path: string): string {
  if (!path || path === '.' || path === '$') return '';
  const cleaned = path.replace(/^\$\.?/, '');
  const parts = cleaned.split(/[.\[\]]+/).filter((part) => part && part !== '*' && !part.startsWith('?'));
  const last = parts[parts.length - 1] || '';
  return last.replace(/^['"]|['"]$/g, '');
}

function tokenizePath(pathStr: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inBracket = false;

  for (let i = 0; i < pathStr.length; i++) {
    const char = pathStr[i];

    if (char === '[' && !inBracket) {
      if (current.trim()) tokens.push(current.trim());
      current = '[';
      inBracket = true;
    } else if (char === ']' && inBracket) {
      current += ']';
      tokens.push(current.trim());
      current = '';
      inBracket = false;
    } else if (char === '.' && !inBracket) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function evaluateFilter(arr: any[], expr: string): any[] {
  const match = expr.match(/^([a-zA-Z0-9_.$]+)\s*(===|==|=|!=|<=|>=|<|>)\s*(.+)$/);
  if (!match) {
    const key = expr.trim();
    return arr.filter((item) => Boolean(resolvePath(item, key)));
  }

  const [, key, op, raw] = match;
  let target: any = raw.trim();

  if (target === 'true') target = true;
  else if (target === 'false') target = false;
  else if (target === 'null') target = null;
  else if (/^-?\d+(\.\d+)?$/.test(target)) target = parseFloat(target);
  else target = target.replace(/^['"]|['"]$/g, '');

  return arr.filter((item) => {
    const actual: any = resolvePath(item, key);
    switch (op) {
      case '=':
      case '==':
      case '===':
        return actual == target;
      case '!=':
        return actual != target;
      case '<':
        return actual < target;
      case '<=':
        return actual <= target;
      case '>':
        return actual > target;
      case '>=':
        return actual >= target;
      default:
        return false;
    }
  });
}
