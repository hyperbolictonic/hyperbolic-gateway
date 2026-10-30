import type { CollaborationThread } from '../../shared/collaboration.js';

export const COLLABORATION_SELECT_PREFIX = '__KUANG_COLLAB_SELECT__:';

/** Human element picker. The click is reported through the existing console channel. */
export function collaborationPickerScript(): string {
  return `(() => {
    const layerId = '__kuang_collab_picker';
    const old = document.getElementById(layerId);
    if (old) old.remove();
    const layer = document.createElement('div');
    layer.id = layerId;
    Object.assign(layer.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      pointerEvents: 'none', cursor: 'crosshair',
    });
    const outline = document.createElement('div');
    Object.assign(outline.style, {
      position: 'fixed', display: 'none', pointerEvents: 'none',
      border: '2px solid #f59e0b', background: 'rgba(245,158,11,0.10)',
      borderRadius: '3px', zIndex: '2147483647',
    });
    layer.append(outline);
    document.documentElement.appendChild(layer);
    const selectorFor = (el) => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 5) {
        let part = node.tagName.toLowerCase();
        if (node.classList && node.classList.length) {
          part += '.' + [...node.classList].slice(0, 2).map((c) => CSS.escape(c)).join('.');
        }
        const parent = node.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((x) => x.tagName === node.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    const describe = (el) => {
      const rect = el.getBoundingClientRect();
      const text = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
      return {
        kind: 'element',
        url: location.href,
        markId: el.getAttribute('data-mark-id') ? Number(el.getAttribute('data-mark-id')) : undefined,
        selector: selectorFor(el),
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        name: text.slice(0, 120),
        text,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    };
    const onMove = (event) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === layer || el === outline) return;
      const rect = el.getBoundingClientRect();
      Object.assign(outline.style, {
        display: 'block', left: rect.left + 'px', top: rect.top + 'px',
        width: rect.width + 'px', height: rect.height + 'px',
      });
    };
    const cleanup = () => {
      layer.remove();
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.__kuangCollabPicking = false;
    };
    const onClick = (event) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === layer || el === outline) return;
      event.preventDefault();
      event.stopPropagation();
      console.log(${JSON.stringify(COLLABORATION_SELECT_PREFIX)} + JSON.stringify(describe(el)));
      cleanup();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); cleanup(); }
    };
    window.__kuangCollabPicking = true;
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    return 'picking';
  })()`;
}


/**
 * Pure in-page projection for collaboration threads. The overlay is read-only in
 * Phase 1; Phase 2 adds human selection/reply controls.
 */
export function collaborationOverlayScript(threads: CollaborationThread[]): string {
  const payload = threads.map((thread) => ({
    id: thread.id,
    status: thread.status,
    text: thread.messages.find((message) => message.author === 'agent')?.text || thread.intent || '',
    choices: thread.messages.find((message) => message.kind === 'question')?.choices || [],
    target: thread.target,
  }));
  return `(() => {
    const layerId = '__kuang_collaboration_layer';
    const old = document.getElementById(layerId);
    if (old) old.remove();
    const threads = ${JSON.stringify(payload)};
    if (!threads.length) return;
    const layer = document.createElement('div');
    layer.id = layerId;
    Object.assign(layer.style, {
      position: 'fixed', inset: '0', zIndex: '2147483646',
      pointerEvents: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    });
    const rectFor = (target) => {
      try {
        if (target.markId !== undefined) {
          const el = document.querySelector('[data-mark-id="' + target.markId + '"]');
          if (el) return el.getBoundingClientRect();
        }
        if (target.selector) {
          const el = document.querySelector(target.selector);
          if (el) return el.getBoundingClientRect();
        }
      } catch {}
      return target.rect
        ? { left: target.rect.x, top: target.rect.y, width: target.rect.width, height: target.rect.height }
        : null;
    };
    for (const thread of threads) {
      const rect = rectFor(thread.target);
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const left = Math.max(0, Math.min(rect.left, innerWidth - 24));
      const top = Math.max(0, Math.min(rect.top, innerHeight - 24));
      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed', left: left + 'px', top: top + 'px',
        width: Math.max(8, rect.width) + 'px', height: Math.max(8, rect.height) + 'px',
        border: '2px solid #22d3ee', borderRadius: '4px',
        boxShadow: '0 0 0 2px rgba(34,211,238,0.18), 0 0 18px rgba(34,211,238,0.35)',
      });
      const card = document.createElement('div');
      Object.assign(card.style, {
        position: 'fixed', left: Math.min(left + 8, innerWidth - 280) + 'px',
        top: Math.max(8, top - 42) + 'px', maxWidth: '260px',
        padding: '6px 9px', borderRadius: '5px',
        background: 'rgba(15,23,42,0.96)', color: '#e2e8f0',
        border: '1px solid #22d3ee', fontSize: '11px', lineHeight: '1.4',
        boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
      });
      const title = document.createElement('div');
      title.style.color = '#22d3ee';
      title.style.fontWeight = '700';
      title.textContent = 'COLLAB ' + thread.id.slice(-6);
      const body = document.createElement('div');
      body.textContent = thread.text;
      card.append(title, body);
      if (thread.choices && thread.choices.length) {
        const choices = document.createElement('div');
        choices.style.color = '#94a3b8';
        choices.textContent = 'Choices: ' + thread.choices.join(' / ');
        card.append(choices);
      }
      layer.append(box, card);
    }
    document.documentElement.appendChild(layer);
  })()`;
}
