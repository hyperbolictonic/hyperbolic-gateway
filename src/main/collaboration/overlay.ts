import type { CollaborationThread } from '../../shared/collaboration.js';

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
