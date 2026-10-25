/**
 * Pure part-highlight rule builder.
 *
 * Kept dependency-free so it can be unit-tested without Electron or the page runtime.
 */
export interface PartHost {
  tag: string;
  parts: string[];
}

export function buildPartHighlightCss(hosts: PartHost[]): string {
  const rules = new Set<string>();
  for (const host of hosts) {
    const tag = String(host.tag || '').toLowerCase();
    if (!tag) continue;
    for (const part of host.parts) {
      const name = String(part || '').trim();
      if (!name) continue;
      rules.add(`${tag}::part(${name}){outline:2px dashed rgba(234,179,8,.95) !important;outline-offset:1px !important;}`);
    }
  }
  return [...rules].join('\n');
}
