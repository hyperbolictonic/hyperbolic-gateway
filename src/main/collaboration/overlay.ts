import type { CollaborationThread } from '../../shared/collaboration.js';

export const COLLABORATION_SELECT_PREFIX = '__KUANG_COLLAB_SELECT__:';
export const COLLABORATION_NOTE_PREFIX = '__KUANG_COLLAB_NOTE__:';

/**
 * Shared styling for both collaboration surfaces. Everything is namespaced under
 * the injected root ids so page styles cannot leak in and the overlay cannot be
 * restyled by the host page.
 */
const COLLAB_CSS = `
#__kuang_collab_drawer {
  position: absolute !important;
  z-index: 2147483647 !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  color: #e2e8f0 !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif !important;
  font-size: 13px !important;
  line-height: 1.45 !important;
  -webkit-font-smoothing: antialiased !important;
  pointer-events: auto !important;
  text-align: left !important;
}
#__kuang_collab_drawer .hb-card {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 320px;
  max-width: calc(100vw - 24px);
  border-radius: 12px;
  background: #0d1221;
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: 0 18px 44px rgba(2, 6, 23, 0.55), 0 2px 8px rgba(2, 6, 23, 0.45);
}
#__kuang_collab_drawer .hb-card.is-collapsed { width: auto; min-width: 150px; }
#__kuang_collab_drawer .hb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  cursor: grab;
  user-select: none;
}
#__kuang_collab_drawer .hb-card.is-collapsed .hb-head { border-bottom: 0; cursor: pointer; }
#__kuang_collab_drawer .hb-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
}
#__kuang_collab_drawer .hb-title {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fbbf24;
  white-space: nowrap;
}
#__kuang_collab_drawer .hb-chip {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
#__kuang_collab_drawer .hb-icon {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
}
#__kuang_collab_drawer .hb-icon:hover { background: rgba(148, 163, 184, 0.16); color: #e2e8f0; }
#__kuang_collab_drawer .hb-icon[hidden] { display: none; }
#__kuang_collab_drawer .hb-body { padding: 10px 10px 0; }
#__kuang_collab_drawer .hb-card.is-collapsed .hb-body,
#__kuang_collab_drawer .hb-card.is-collapsed .hb-foot { display: none; }
#__kuang_collab_drawer .hb-note {
  display: block;
  width: 100%;
  min-height: 88px;
  resize: none;
  background: rgba(2, 6, 23, 0.65);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 9px;
  padding: 9px 10px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  outline: none;
}
#__kuang_collab_drawer .hb-note:focus {
  border-color: rgba(245, 158, 11, 0.65);
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.14);
}
#__kuang_collab_drawer .hb-note::placeholder { color: #64748b; }
#__kuang_collab_drawer .hb-tags {
  display: block;
  width: 100%;
  margin-top: 8px;
  background: rgba(2, 6, 23, 0.45);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 9px;
  padding: 7px 10px;
  font-family: inherit;
  font-size: 12px;
  outline: none;
}
#__kuang_collab_drawer .hb-tags:focus {
  border-color: rgba(245, 158, 11, 0.55);
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12);
}
#__kuang_collab_drawer .hb-tags::placeholder { color: #64748b; }
#__kuang_collab_drawer .hb-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
}
#__kuang_collab_drawer .hb-hint {
  flex: 1 1 auto;
  font-size: 11px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#__kuang_collab_drawer .hb-btn {
  flex: 0 0 auto;
  border-radius: 8px;
  padding: 7px 12px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
#__kuang_collab_drawer .hb-ghost {
  background: rgba(148, 163, 184, 0.10);
  color: #cbd5e1;
  border-color: rgba(148, 163, 184, 0.20);
}
#__kuang_collab_drawer .hb-ghost:hover { background: rgba(148, 163, 184, 0.18); color: #e2e8f0; }
#__kuang_collab_drawer .hb-primary { background: #f59e0b; color: #0b1220; }
#__kuang_collab_drawer .hb-primary:hover { background: #fbbf24; }
#__kuang_collab_drawer .hb-arrow {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #0d1221;
  border-top: 1px solid rgba(148, 163, 184, 0.22);
  border-right: 1px solid rgba(148, 163, 184, 0.22);
  display: none;
}
#__kuang_collab_drawer .hb-arrow.is-left { display: block; left: -6px; transform: rotate(135deg); }
#__kuang_collab_drawer .hb-arrow.is-right { display: block; right: -6px; transform: rotate(-45deg); }
#__kuang_collab_drawer .hb-arrow.is-up { display: block; top: -6px; transform: rotate(45deg); }
#__kuang_collab_drawer .hb-arrow.is-down { display: block; bottom: -6px; transform: rotate(225deg); }
#__kuang_collab_selection {
  position: absolute !important;
  z-index: 2147483645 !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  pointer-events: none !important;
  border: 2px solid #f59e0b !important;
  border-radius: 8px !important;
  background: rgba(245, 158, 11, 0.07) !important;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12), 0 0 22px rgba(245, 158, 11, 0.28) !important;
}
#__kuang_collab_selection .hb-tag {
  position: absolute;
  left: 0;
  top: -10px;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 7px;
  border-radius: 5px;
  background: #f59e0b;
  color: #0b1220;
  font: 700 10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
#__kuang_collab_selection .hb-add {
  position: absolute;
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(245, 158, 11, 0.85);
  border-radius: 8px;
  background: #0b1220;
  color: #fbbf24;
  cursor: pointer;
  pointer-events: auto !important;
  box-shadow: 0 4px 14px rgba(2, 6, 23, 0.5);
}
#__kuang_collab_selection .hb-add:hover { background: #f59e0b; color: #0b1220; }
#__kuang_collaboration_layer {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif;
}
#__kuang_collaboration_layer .hb-box {
  position: absolute;
  box-sizing: border-box;
  border: 2px dashed rgba(34, 211, 238, 0.85);
  border-radius: 8px;
  background: rgba(34, 211, 238, 0.05);
  box-shadow: 0 0 18px rgba(34, 211, 238, 0.22);
}
#__kuang_collaboration_layer .hb-agent {
  position: absolute;
  box-sizing: border-box;
  width: 250px;
  max-width: calc(100vw - 24px);
  padding: 9px 11px;
  border-radius: 10px;
  background: #0d1221;
  border: 1px solid rgba(34, 211, 238, 0.32);
  box-shadow: 0 14px 34px rgba(2, 6, 23, 0.5);
  pointer-events: auto;
  cursor: pointer;
}
#__kuang_collaboration_layer .hb-agent-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #22d3ee;
}
#__kuang_collaboration_layer .hb-agent-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22d3ee;
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.18);
}
#__kuang_collaboration_layer .hb-agent-id {
  margin-left: auto;
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 500;
}
#__kuang_collaboration_layer .hb-agent-body {
  margin-top: 6px;
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
#__kuang_collaboration_layer .hb-agent-body.is-clamped {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
#__kuang_collaboration_layer .hb-agent-arrow {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #0d1221;
  border-top: 1px solid rgba(34, 211, 238, 0.32);
  border-right: 1px solid rgba(34, 211, 238, 0.32);
}
`;

/**
 * Anchored note composer. The drawer is mounted next to the picked element,
 * follows it while the page scrolls, can be minimised to a compact pill and can
 * be dragged out of the way. Exposed on `window` so the picker and the tests
 * share one implementation. `rightInset` is the width covered by the floating
 * deck panel; placement avoids it.
 */
export function collaborationNoteDrawerScript(): string {
  return `(() => {
  const CSS_TEXT = ${JSON.stringify(COLLAB_CSS)};
  const NOTE_PREFIX = ${JSON.stringify(COLLABORATION_NOTE_PREFIX)};
  const ICON = {
    minus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    anchor: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>'
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  const ensureStyle = () => {
    let style = document.getElementById('__kuang_collab_style');
    if (!style) {
      style = document.createElement('style');
      style.id = '__kuang_collab_style';
      style.textContent = CSS_TEXT;
      (document.head || document.documentElement).appendChild(style);
    }
  };
  window.__hbCollabOpenNoteDrawer = function (el, target, options) {
    const rightInset = options && Number.isFinite(options.rightInset) ? Math.max(0, options.rightInset) : 0;
    ensureStyle();
    const previousDrawer = document.getElementById('__kuang_collab_drawer');
    if (previousDrawer) previousDrawer.remove();
    const previousSelection = document.getElementById('__kuang_collab_selection');
    if (previousSelection) previousSelection.remove();

    const shortSelector = (target && target.selector ? target.selector.split(' > ').pop() : '') || (target && target.role) || 'element';
    const keep = document.createElement('div');
    keep.id = '__kuang_collab_selection';
    const tag = document.createElement('div');
    tag.className = 'hb-tag';
    tag.textContent = shortSelector.length > 30 ? shortSelector.slice(0, 29) + '\\u2026' : shortSelector;
    tag.title = (target && target.selector) || '';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'hb-add';
    add.title = 'Add note';
    add.setAttribute('aria-label', 'Add note');
    add.innerHTML = ICON.plus;
    keep.append(tag, add);
    document.documentElement.appendChild(keep);

    const drawer = document.createElement('div');
    drawer.id = '__kuang_collab_drawer';
    const card = document.createElement('div');
    card.className = 'hb-card';
    const head = document.createElement('div');
    head.className = 'hb-head';
    const dot = document.createElement('span');
    dot.className = 'hb-dot';
    const title = document.createElement('span');
    title.className = 'hb-title';
    title.textContent = 'Add note';
    const chip = document.createElement('span');
    chip.className = 'hb-chip';
    chip.textContent = shortSelector.length > 30 ? shortSelector.slice(0, 29) + '\\u2026' : shortSelector;
    chip.title = (target && target.selector) || '';
    const anchor = document.createElement('button');
    anchor.type = 'button';
    anchor.className = 'hb-icon';
    anchor.title = 'Re-anchor to element';
    anchor.setAttribute('aria-label', 'Re-anchor to element');
    anchor.innerHTML = ICON.anchor;
    anchor.hidden = true;
    const minimize = document.createElement('button');
    minimize.type = 'button';
    minimize.className = 'hb-icon';
    minimize.title = 'Minimize note';
    minimize.setAttribute('aria-label', 'Minimize note');
    minimize.innerHTML = ICON.minus;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'hb-icon';
    close.title = 'Cancel';
    close.setAttribute('aria-label', 'Cancel');
    close.innerHTML = ICON.close;
    head.append(dot, title, chip, anchor, minimize, close);

    const body = document.createElement('div');
    body.className = 'hb-body';
    const note = document.createElement('textarea');
    note.className = 'hb-note';
    note.placeholder = 'What should the agent know about this element?';
    const tags = document.createElement('input');
    tags.className = 'hb-tags';
    tags.placeholder = 'Tags - comma separated';
    body.append(note, tags);

    const foot = document.createElement('div');
    foot.className = 'hb-foot';
    const hint = document.createElement('span');
    hint.className = 'hb-hint';
    hint.textContent = 'Ctrl + Enter to save';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'hb-btn hb-ghost';
    cancel.textContent = 'Cancel';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'hb-btn hb-primary';
    saveBtn.textContent = 'Add note';
    foot.append(hint, cancel, saveBtn);

    const arrow = document.createElement('div');
    arrow.className = 'hb-arrow';
    card.append(head, body, foot, arrow);
    drawer.append(card);
    document.documentElement.appendChild(drawer);

    let collapsed = false;
    let free = false;
    let dragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let saving = false;
    let saveHandled = false;
    let saveTimer = 0;
    const SAVED_EVENT = '__hb_collab_refreshed';

    const position = () => {
      const rect = el.getBoundingClientRect();
      const offsetX = scrollX;
      const offsetY = scrollY;
      const vw = Math.max(0, innerWidth - rightInset);
      const vh = innerHeight;
      const margin = 12;
      const gap = 12;
      keep.style.left = rect.left + offsetX + 'px';
      keep.style.top = rect.top + offsetY + 'px';
      keep.style.width = rect.width + 'px';
      keep.style.height = rect.height + 'px';
      tag.style.top = rect.top > 20 ? '-10px' : '2px';
      const size = 24;
      let addLeft = rect.right + 8;
      if (addLeft + size > vw - 8) addLeft = rect.right - size - 6;
      if (addLeft < 8) addLeft = clamp(rect.left, 8, Math.max(8, vw - size - 8));
      const addTop = rect.top > 34 ? rect.top - size - 6 : rect.top + 6;
      add.style.left = Math.round(addLeft - rect.left) + 'px';
      add.style.top = Math.round(addTop - rect.top) + 'px';
      if (free) return;
      const width = card.offsetWidth || 320;
      const height = card.offsetHeight || 240;
      let left;
      let top;
      let side = 'right';
      if (collapsed) {
        if (rect.right + gap + width <= vw - margin) { left = rect.right + gap; top = rect.top; }
        else if (rect.left - gap - width >= margin) { left = rect.left - gap - width; top = rect.top; }
        else if (rect.bottom + gap + height <= vh - margin) { left = rect.right - width; top = rect.bottom + gap; }
        else { left = rect.right - width; top = rect.top - height - gap; }
        side = 'none';
      } else if (rect.right + gap + width <= vw - margin) {
        side = 'right';
        left = rect.right + gap;
        top = rect.top + rect.height / 2 - height / 2;
      } else if (rect.left - gap - width >= margin) {
        side = 'left';
        left = rect.left - gap - width;
        top = rect.top + rect.height / 2 - height / 2;
      } else if (rect.bottom + gap + height <= vh - margin) {
        side = 'below';
        left = rect.left;
        top = rect.bottom + gap;
      } else if (rect.top - gap - height >= margin) {
        side = 'above';
        left = rect.left;
        top = rect.top - gap - height;
      } else {
        // The element fills the viewport: float the composer in the corner.
        left = vw - width - margin;
        top = vh - height - margin;
        side = 'none';
      }
      left = clamp(left, margin, Math.max(margin, vw - width - margin));
      top = clamp(top, margin, Math.max(margin, vh - height - margin));
      drawer.style.left = Math.round(left + offsetX) + 'px';
      drawer.style.top = Math.round(top + offsetY) + 'px';
      if (side === 'none') {
        arrow.className = 'hb-arrow';
        return;
      }
      if (side === 'right' || side === 'left') {
        arrow.className = 'hb-arrow ' + (side === 'right' ? 'is-left' : 'is-right');
        arrow.style.top = clamp(rect.top + rect.height / 2 - top - 5, 14, Math.max(14, height - 20)) + 'px';
        arrow.style.left = '';
        arrow.style.right = '';
      } else {
        arrow.className = 'hb-arrow ' + (side === 'below' ? 'is-up' : 'is-down');
        arrow.style.left = clamp(rect.left + rect.width / 2 - left - 5, 14, Math.max(14, width - 20)) + 'px';
        arrow.style.top = '';
      }
    };

    const setCollapsed = (value) => {
      collapsed = value;
      card.classList.toggle('is-collapsed', collapsed);
      minimize.innerHTML = collapsed ? ICON.plus : ICON.minus;
      minimize.title = collapsed ? 'Expand note' : 'Minimize note';
      minimize.setAttribute('aria-label', minimize.title);
      title.textContent = collapsed ? 'Note' : 'Add note';
      position();
    };

    const setFree = (value) => {
      free = value;
      anchor.hidden = !value;
    };

    const remove = () => {
      keep.remove();
      drawer.remove();
      window.removeEventListener('resize', position);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener(SAVED_EVENT, onSavedEvent, true);
      clearTimeout(saveTimer);
      delete window.__kuangCollabSelectionCancel;
    };

    const submit = () => {
      const text = note.value.trim();
      if (!text) { note.focus(); return; }
      if (saving) return;
      saveHandled = false;
      saving = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      hint.textContent = 'Saving your note…';
      hint.classList.remove('text-error');
      document.addEventListener(SAVED_EVENT, onSavedEvent, true);
      saveTimer = setTimeout(() => {
        if (saveHandled) return;
        saving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Add note';
        hint.textContent = 'Save not confirmed — check the gateway and try again.';
        hint.classList.add('text-error');
      }, 4000);
      console.log(NOTE_PREFIX + JSON.stringify({
        target,
        text,
        tags: tags.value.split(',').map((tag) => tag.trim()).filter(Boolean),
      }));
    };

    const onSavedEvent = () => {
      if (!saving) return;
      saveHandled = true;
      remove();
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        remove();
        return;
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }
    };
    document.addEventListener('keydown', onKey, true);

    head.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target && event.target.closest('button')) return;
      if (collapsed) { setCollapsed(false); return; }
      dragging = true;
      const box = drawer.getBoundingClientRect();
      dragOffsetX = event.clientX - box.left;
      dragOffsetY = event.clientY - box.top;
      head.style.cursor = 'grabbing';
      try { head.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
    });
    head.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      setFree(true);
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      const docWidth = Math.max(innerWidth, document.documentElement.scrollWidth);
      const docHeight = Math.max(innerHeight, document.documentElement.scrollHeight);
      const left = clamp(event.clientX - dragOffsetX + scrollX, 8, Math.max(8, docWidth - width - 8));
      const top = clamp(event.clientY - dragOffsetY + scrollY, 8, Math.max(8, docHeight - height - 8));
      drawer.style.left = Math.round(left) + 'px';
      drawer.style.top = Math.round(top) + 'px';
      arrow.className = 'hb-arrow';
    });
    const endDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      head.style.cursor = '';
      try { head.releasePointerCapture(event.pointerId); } catch {}
    };
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);

    minimize.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setCollapsed(!collapsed);
    });
    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      remove();
    });
    cancel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      remove();
    });
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setFree(false);
      position();
    });
    saveBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      submit();
    });
    add.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (collapsed) setCollapsed(false);
      note.focus();
    });
    note.addEventListener('input', () => {
      note.style.height = 'auto';
      note.style.height = Math.min(240, Math.max(88, note.scrollHeight)) + 'px';
    });
    drawer.addEventListener('mousedown', (event) => event.stopPropagation());
    drawer.addEventListener('pointerdown', (event) => event.stopPropagation());
    drawer.addEventListener('click', (event) => event.stopPropagation());
    drawer.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') event.stopPropagation();
    });

    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    window.__kuangCollabSelectionCancel = remove;
    position();
    note.focus();
    return { remove, position, setCollapsed, card, drawer };
  };
})();`;
}

/** Human element picker. The click is reported through the existing console channel. */
export interface CollaborationPickerOptions {
  /** Page width (from the right edge) covered by the floating deck panel. */
  rightInset?: number;
}

export function collaborationPickerScript(options: CollaborationPickerOptions = {}): string {
  const rightInset = typeof options.rightInset === 'number' && Number.isFinite(options.rightInset)
    ? Math.max(0, options.rightInset)
    : 0;
  return `new Promise((resolve) => {
    ${collaborationNoteDrawerScript()}
    const RIGHT_INSET = ${JSON.stringify(rightInset)};
    const layerId = '__kuang_collab_picker';
    const old = document.getElementById(layerId);
    if (old) old.remove();
    const oldSelection = document.getElementById('__kuang_collab_selection');
    if (oldSelection) oldSelection.remove();
    const oldDrawer = document.getElementById('__kuang_collab_drawer');
    if (oldDrawer) oldDrawer.remove();
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
      borderRadius: '8px', zIndex: '2147483647',
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
      delete window.__kuangCollabPickerCancel;
    };
    const finish = (value) => {
      cleanup();
      resolve(value);
    };
    const onClick = (event) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === layer || el === outline) return;
      event.preventDefault();
      event.stopPropagation();
      const target = describe(el);
      window.__hbCollabOpenNoteDrawer(el, target, { rightInset: RIGHT_INSET });
      finish(target);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
    };
    window.__kuangCollabPicking = true;
    window.__kuangCollabPickerCancel = () => finish(null);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  })`;
}

/**
 * Pure in-page projection for collaboration threads. The overlay is read-only in
 * Phase 1; Phase 2 adds human selection/reply controls.
 */
export function collaborationOverlayScript(
  threads: CollaborationThread[],
  options: { rightInset?: number } = {},
): string {
  const rightInset = typeof options.rightInset === 'number' && Number.isFinite(options.rightInset)
    ? Math.max(0, options.rightInset)
    : 0;
  const payload = threads.map((thread) => ({
    id: thread.id,
    status: thread.status,
    text: thread.messages.find((message) => message.author === 'agent')?.text || thread.intent || '',
    choices: thread.messages.find((message) => message.kind === 'question')?.choices || [],
    target: thread.target,
  }));
  return `(() => {
    const layerId = '__kuang_collaboration_layer';
    document.dispatchEvent(new CustomEvent('__hb_collab_refreshed'));
    const old = document.getElementById(layerId);
    if (old) old.remove();
    const style = document.getElementById('__kuang_collab_style');
    if (!style) {
      const injected = document.createElement('style');
      injected.id = '__kuang_collab_style';
      injected.textContent = ${JSON.stringify(COLLAB_CSS)};
      (document.head || document.documentElement).appendChild(injected);
    }
    const threads = ${JSON.stringify(payload)};
    const RIGHT_INSET = ${JSON.stringify(rightInset)};
    if (!threads.length) return;
    const layer = document.createElement('div');
    layer.id = layerId;
    layer.setAttribute('style', 'position:absolute;inset:0;z-index:2147483646;pointer-events:none;');
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
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    const usableWidth = Math.max(0, innerWidth - RIGHT_INSET);
    for (const thread of threads) {
      const rect = rectFor(thread.target);
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const offsetX = scrollX;
      const offsetY = scrollY;
      const box = document.createElement('div');
      box.className = 'hb-box';
      Object.assign(box.style, {
        left: rect.left + offsetX + 'px', top: rect.top + offsetY + 'px',
        width: Math.max(8, rect.width) + 'px', height: Math.max(8, rect.height) + 'px',
      });
      const card = document.createElement('div');
      card.className = 'hb-agent';
      const head = document.createElement('div');
      head.className = 'hb-agent-head';
      const dot = document.createElement('span');
      dot.className = 'hb-agent-dot';
      const label = document.createElement('span');
      label.textContent = 'Collab';
      const id = document.createElement('span');
      id.className = 'hb-agent-id';
      id.textContent = thread.id.slice(-6);
      head.append(dot, label, id);
      const text = document.createElement('div');
      text.className = 'hb-agent-body is-clamped';
      text.textContent = thread.text || 'No message yet.';
      card.append(head, text);
      card.addEventListener('click', () => {
        text.classList.toggle('is-clamped');
      });
      const arrow = document.createElement('div');
      arrow.className = 'hb-agent-arrow';
      layer.append(box, card);
      const width = card.offsetWidth || 250;
      const height = card.offsetHeight || 60;
      const margin = 10;
      let top = rect.top - height - margin;
      let pointingUp = false;
      if (top < margin) {
        top = rect.bottom + margin;
        pointingUp = true;
      }
      top = clamp(top, margin, Math.max(margin, innerHeight - height - margin));
      const left = clamp(rect.left, margin, Math.max(margin, usableWidth - width - margin));
      card.style.left = Math.round(left + offsetX) + 'px';
      card.style.top = Math.round(top + offsetY) + 'px';
      if (pointingUp) {
        arrow.style.top = '-6px';
        arrow.style.left = clamp(rect.left + rect.width / 2 - left - 5, 12, Math.max(12, width - 22)) + 'px';
        arrow.style.transform = 'rotate(45deg)';
      } else {
        arrow.style.bottom = '-6px';
        arrow.style.left = clamp(rect.left + rect.width / 2 - left - 5, 12, Math.max(12, width - 22)) + 'px';
        arrow.style.transform = 'rotate(225deg)';
      }
      card.append(arrow);
    }
    document.documentElement.appendChild(layer);
  })()`;
}
