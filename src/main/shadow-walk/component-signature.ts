/**
 * Component signatures.
 *
 * A web component's identity is the surface it exports to the page: its tag, whether it is
 * upgrade-defined, `part` names, `exportparts` mappings and the custom properties it exposes.
 * That surface changes when a component is renamed or re-skinned structurally, and stays stable
 * across re-renders — which makes it a better recipe anchor than a CSS path or a coordinate.
 *
 * It is read from the **host**, which is light DOM and page-visible by design. Nothing here reads
 * a closed root.
 */
export interface ComponentSurface {
  tag: string;
  defined: boolean;
  part: string[];
  exportparts: string[];
  cssVars: string[];
  /** `tag:hash` — the stable recipe anchor. */
  signature: string;
}

export function componentSignatureOf(surface: Omit<ComponentSurface, 'signature'>): string {
  const base = [
    surface.tag,
    surface.defined ? '1' : '0',
    `part:${surface.part.join(',')}`,
    `exports:${surface.exportparts.join(',')}`,
    `vars:${surface.cssVars.join(',')}`,
  ].join('|');
  // djb2: tiny, deterministic, and the same implementation exists in the page helper.
  let hash = 5381;
  for (let i = 0; i < base.length; i++) hash = ((hash << 5) + hash + base.charCodeAt(i)) >>> 0;
  return `${surface.tag}:${hash.toString(16).padStart(8, '0')}`;
}

export function normalizeSurface(input: {
  tag?: unknown;
  defined?: unknown;
  part?: unknown;
  exportparts?: unknown;
  cssVars?: unknown;
}): ComponentSurface {
  const tag = String(input.tag || '').toLowerCase();
  const part = [...new Set((Array.isArray(input.part) ? input.part : []).map((p) => String(p).trim()).filter(Boolean))].sort();
  const exportparts = [
    ...new Set(
      (Array.isArray(input.exportparts) ? input.exportparts : [])
        .map((p) => String(p).trim().replace(/\s+/g, ''))
        .filter(Boolean)
    ),
  ].sort();
  const cssVars = [
    ...new Set((Array.isArray(input.cssVars) ? input.cssVars : []).map((v) => String(v).trim()).filter(Boolean)),
  ].sort();
  const surface = { tag, defined: input.defined === true, part, exportparts, cssVars };
  return { ...surface, signature: componentSignatureOf(surface) };
}

/**
 * Page-side helpers, inlined into the marks/observe and text-target scripts.
 * Keep the normalisation and hash identical to {@link componentSignatureOf}.
 */
export const COMPONENT_SIGNATURE_HELPERS = `
  const kqComponentHost = (el) => {
    let node = el;
    for (let guard = 0; node && guard < 40; guard++) {
      const root = node.getRootNode ? node.getRootNode() : null;
      if (root && root.host) {
        node = root.host;
        if (node.tagName && node.tagName.indexOf('-') !== -1) return node;
        continue;
      }
      node = node.parentElement;
      if (node && node.tagName && node.tagName.indexOf('-') !== -1) return node;
    }
    return null;
  };
  const kqComponentSurface = (el) => {
    const host = kqComponentHost(el);
    if (!host) return null;
    const tag = host.tagName.toLowerCase();
    const part = [...new Set((host.getAttribute('part') || '').split(/\\s+/).filter(Boolean))].sort();
    const exportparts = [...new Set((host.getAttribute('exportparts') || '').split(',').map((p) => p.trim().replace(/\\s+/g, '')).filter(Boolean))].sort();
    const cssVars = [];
    try {
      const style = getComputedStyle(host);
      for (let i = 0; i < style.length; i++) {
        const name = style[i];
        if (name && name.indexOf('--') === 0) cssVars.push(name);
      }
    } catch (e) {}
    cssVars.sort();
    const defined = !!(window.customElements && customElements.get(tag));
    const base = [tag, defined ? '1' : '0', 'part:' + part.join(','), 'exports:' + exportparts.join(','), 'vars:' + cssVars.join(',')].join('|');
    let hash = 5381;
    for (let i = 0; i < base.length; i++) hash = ((hash << 5) + hash + base.charCodeAt(i)) >>> 0;
    return { tag, defined, part, exportparts, cssVars, signature: tag + ':' + hash.toString(16).padStart(8, '0') };
  };
`;


