import type { MarkItem } from '../main/marks/marks-overlay.js';

/**
 * Renders one Set-of-Marks entry as a compact, accessibility-aware line:
 *   [#3] <INPUT type="text" role=combobox> "Where to?" {value="London", expanded=false, required}
 */
export function formatMark(m: Pick<MarkItem, 'id' | 'tag'> & Partial<MarkItem>): string {
  const attrs = `${m.type ? ` type="${m.type}"` : ''}${m.role ? ` role=${m.role}` : ''}`;
  const extras: string[] = [];
  if (m.value) extras.push(`value="${m.value}"`);
  if (m.state) extras.push(m.state.replace(/,/g, ', '));
  return `[#${m.id}] <${m.tag}${attrs}> "${m.text || ''}"${extras.length ? ` {${extras.join(', ')}}` : ''}`;
}
