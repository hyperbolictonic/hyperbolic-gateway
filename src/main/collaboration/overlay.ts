import type { CollaborationThread } from '../../shared/collaboration.js';

export const COLLABORATION_NOTE_PREFIX = '__KUANG_COLLAB_NOTE__:';
/** Human class-list edits on a selected element (the LLM reads these). */
export const COLLABORATION_CLASS_PREFIX = '__KUANG_COLLAB_CLASS__:';
/** Resolve a thread from its in-page annotation card while in collab mode. */
export const COLLABORATION_RESOLVE_PREFIX = '__KUANG_COLLAB_RESOLVE__:';
/** Escape from collab mode while the page itself owns keyboard focus. */
export const COLLABORATION_EXIT_PREFIX = '__KUANG_COLLAB_EXIT__';

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
#__kuang_collaboration_layer .hb-resolve {
  display: none;
  align-items: center;
  justify-content: center;
  width: 21px;
  height: 21px;
  padding: 0;
  border: 1px solid rgba(34, 197, 94, 0.45);
  border-radius: 6px;
  background: rgba(34, 197, 94, 0.12);
  color: #86efac;
  font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  cursor: pointer;
  pointer-events: auto;
}
#__kuang_collaboration_layer.is-collab-active .hb-resolve { display: inline-flex; }
#__kuang_collaboration_layer .hb-resolve:hover { background: rgba(34, 197, 94, 0.24); }
#__kuang_collaboration_layer .hb-resolve:disabled { opacity: 0.6; cursor: wait; }
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
#__kuang_collaboration_layer .hb-box.hb-human {
  border-color: rgba(245, 158, 11, 0.85);
  background: rgba(245, 158, 11, 0.05);
  box-shadow: 0 0 18px rgba(245, 158, 11, 0.2);
}
#__kuang_collaboration_layer .hb-agent.hb-human { border-color: rgba(245, 158, 11, 0.35); }
#__kuang_collaboration_layer .hb-agent.hb-human .hb-agent-head { color: #f59e0b; }
#__kuang_collaboration_layer .hb-agent.hb-human .hb-agent-dot {
  background: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
}
#__kuang_collaboration_layer .hb-agent.hb-human .hb-agent-arrow {
  border-color: rgba(245, 158, 11, 0.35);
}
#__kuang_collaboration_layer .hb-box.hb-focus-ring {
  border-width: 3px;
  border-color: rgba(245, 158, 11, 0.95);
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.28), 0 0 26px rgba(245, 158, 11, 0.35);
}
#__kuang_collaboration_layer .hb-box.hb-flash {
  animation: hb-thread-flash 1500ms ease-out;
}
@keyframes hb-thread-flash {
  0% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.55); }
  100% { box-shadow: 0 0 18px rgba(245, 158, 11, 0.2); }
}
/* Element selection keeps a persistent amber outline so the human always
   knows which element the collab toolbar is attached to. */
.hb-el-selected {
  outline: 2px solid rgba(245, 158, 11, 0.9) !important;
  outline-offset: 1px;
}
#__kuang_collab_elementbar {
  display: flex;
  align-items: center;
  gap: 3px;
  background: rgba(17, 22, 40, 0.96);
  border: 1px solid rgba(245, 158, 11, 0.5);
  border-radius: 10px;
  padding: 4px 5px;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
#__kuang_collab_elementbar .hb-el-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
#__kuang_collab_elementbar .hb-el-btn:hover {
  background: rgba(245, 158, 11, 0.24);
}
#__kuang_collab_elementbar .hb-el-close {
  width: auto;
  padding: 0 8px;
  border-color: rgba(148, 163, 184, 0.3);
  background: rgba(148, 163, 184, 0.1);
  color: rgba(226, 232, 240, 0.75);
  font-size: 10px;
}
#__kuang_collab_csspop {
  position: fixed;
  z-index: 2147483647;
  width: 248px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(34, 211, 238, 0.3);
  background: rgba(13, 18, 33, 0.97);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.55);
  color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
#__kuang_collab_csspop .hb-css-title {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: rgba(148, 163, 184, 0.85);
  margin-bottom: 6px;
}
#__kuang_collab_csspop .hb-css-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-bottom: 7px;
  max-height: 96px;
  overflow: auto;
}
#__kuang_collab_csspop .hb-css-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 5px;
  border-radius: 6px;
  border: 1px solid rgba(34, 211, 238, 0.3);
  background: rgba(34, 211, 238, 0.1);
  color: #67e8f9;
  font-size: 10px;
  cursor: pointer;
}
#__kuang_collab_csspop .hb-css-chip:hover {
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.45);
  color: #fca5a5;
}
#__kuang_collab_csspop .hb-css-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 7px;
  border-radius: 7px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(148, 163, 184, 0.08);
  color: #e2e8f0;
  font-size: 11px;
  outline: none;
}
#__kuang_collab_csspop .hb-css-input:focus {
  border-color: rgba(34, 211, 238, 0.45);
}
#__kuang_collab_csspop .hb-css-addrow {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}
#__kuang_collab_csspop .hb-css-add {
  padding: 5px 9px;
  border-radius: 7px;
  border: 1px solid rgba(34, 211, 238, 0.4);
  background: rgba(34, 211, 238, 0.14);
  color: #67e8f9;
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
}
#__kuang_collab_csspop .hb-css-send {
  margin-top: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(245, 158, 11, 0.5);
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
#__kuang_collab_csspop .hb-css-send:hover {
  background: rgba(245, 158, 11, 0.26);
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
  const CLASS_PREFIX = ${JSON.stringify(COLLABORATION_CLASS_PREFIX)};
  const RESOLVE_PREFIX = ${JSON.stringify(COLLABORATION_RESOLVE_PREFIX)};
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
      if (window.__hbCollabClearElementBar) window.__hbCollabClearElementBar();
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

  /**
   * Element collab toolbar: pins to the freshly selected element with a
   * persistent amber outline. Pen = compose a note; CSS = edit the element
   * class list (human intent the agent can read); DONE = finish working on
   * the element. Survives page scrolls; Escape/another selection closes it.
   */
  window.__hbCollabClearElementBar = function () {
    const bar = document.getElementById('__kuang_collab_elementbar');
    if (bar) bar.remove();
    const pop = document.getElementById('__kuang_collab_csspop');
    if (pop) pop.remove();
    document.querySelectorAll('.hb-el-selected').forEach(function (node) {
      node.classList.remove('hb-el-selected');
    });
    if (window.__hbCollabElementEscapeHandler) {
      document.removeEventListener('keydown', window.__hbCollabElementEscapeHandler, true);
      delete window.__hbCollabElementEscapeHandler;
    }
    delete window.__hbCollabSelection;
  };

  window.__hbCollabShowElementToolbar = function (el, target) {
    ensureStyle();
    window.__hbCollabClearElementBar();
    el.classList.add('hb-el-selected');
    window.__hbCollabSelection = { el: el, target: target };
    const bar = document.createElement('div');
    bar.id = '__kuang_collab_elementbar';
    const pen = document.createElement('button');
    pen.className = 'hb-el-btn hb-el-pen';
    pen.textContent = '\\u270E';
    pen.title = 'Attach a note to this element';
    const cssBtn = document.createElement('button');
    cssBtn.className = 'hb-el-btn hb-el-css';
    cssBtn.textContent = 'CSS';
    cssBtn.title = 'Edit this element class list — the agent reads it';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'hb-el-btn hb-el-close';
    closeBtn.textContent = 'DONE';
    closeBtn.title = 'Finish working on this element';
    bar.append(pen, cssBtn, closeBtn);
    document.body.appendChild(bar);
    const place = function () {
      const rect = el.getBoundingClientRect();
      if (!document.getElementById('__kuang_collab_elementbar')) {
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('scroll', place, false);
        return;
      }
      const left = Math.max(6, Math.min(rect.left + rect.width - 6, window.innerWidth - 200));
      const top = rect.top > 48
        ? Math.max(6, rect.top - 44)
        : Math.max(6, Math.min(rect.bottom + 8, window.innerHeight - 42));
      bar.style.left = left + 'px';
      bar.style.top = top + 'px';
    };
    window.addEventListener('scroll', place, true);
    window.__hbCollabElementEscapeHandler = function (event) {
      if (event.key !== 'Escape') return;
      if (window.__hbCollabMode) return;
      if (document.getElementById('__kuang_collab_drawer')) return;
      const cssEditor = document.getElementById('__kuang_collab_csspop');
      if (cssEditor) {
        cssEditor.remove();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      window.__hbCollabClearElementBar();
    };
    document.addEventListener('keydown', window.__hbCollabElementEscapeHandler, true);
    closeBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      window.__hbCollabClearElementBar();
      delete window.__hbCollabSelection;
    });
    pen.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      bar.remove();
      window.__hbCollabOpenNoteDrawer(el, target);
    });
    cssBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      window.__hbCollabOpenCssEditor(el, target, bar);
    });
    place();
  };

  /**
   * Class-list editor for the selected element. On open it snapshots the
   * current classes; chips reactively toggle real classList membership; SEND
   * reports the delta (+added -removed) over the class channel so the agent
   * can read the human's intent.
   */
  window.__hbCollabOpenCssEditor = function (el, target, bar) {
    const existing = document.getElementById('__kuang_collab_csspop');
    if (existing) {
      existing.remove();
      return;
    }
    const pop = document.createElement('div');
    pop.id = '__kuang_collab_csspop';
    const title = document.createElement('div');
    title.className = 'hb-css-title';
    title.textContent = 'CLASSES — click one to remove';
    const chips = document.createElement('div');
    chips.className = 'hb-css-chips';
    const classNameValue = typeof el.className === 'string'
      ? el.className
      : (el.className && typeof el.className.baseVal === 'string' ? el.className.baseVal : '');
    let current = classNameValue.split(/\\s+/).filter(Boolean);
    const original = current.slice();
    const renderChips = function () {
      chips.replaceChildren();
      if (!current.length) {
        const empty = document.createElement('span');
        empty.textContent = 'no classes';
        empty.style.color = 'rgba(148,163,184,0.55)';
        empty.style.fontSize = '10px';
        chips.append(empty);
        return;
      }
      current.forEach(function (cls) {
        const chip = document.createElement('button');
        chip.className = 'hb-css-chip';
        chip.textContent = cls + ' \\u00D7';
        chip.title = 'Remove ' + cls;
        chip.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (current.indexOf(cls) === -1) return;
          current = current.filter(function (c) { return c !== cls; });
          el.classList.remove(cls);
          renderChips();
        });
        chips.append(chip);
      });
    };
    renderChips();
    const addRow = document.createElement('div');
    addRow.className = 'hb-css-addrow';
    const input = document.createElement('input');
    input.className = 'hb-css-input';
    input.placeholder = 'add class names, space separated';
    const addBtn = document.createElement('button');
    addBtn.className = 'hb-css-add';
    addBtn.textContent = 'ADD';
    const applyToken = function () {
      (input.value || '').trim().split(/\\s+/).filter(Boolean).forEach(function (token) {
        if (current.indexOf(token) === -1) {
          current.push(token);
          el.classList.add(token);
        }
      });
      input.value = '';
      renderChips();
    };
    addBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      applyToken();
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        applyToken();
      }
    });
    addRow.append(input, addBtn);
    const send = document.createElement('button');
    send.className = 'hb-css-send';
    send.textContent = 'SEND CLASSES TO AGENT';
    send.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      const added = current.filter(function (cls) { return original.indexOf(cls) === -1; });
      const removed = original.filter(function (cls) { return current.indexOf(cls) === -1; });
      console.log(CLASS_PREFIX + JSON.stringify({ target: target, added: added, removed: removed }));
      pop.remove();
    });
    pop.append(title, chips, addRow, send);
    document.body.appendChild(pop);
    const barRect = bar.getBoundingClientRect();
    const popWidth = 248;
    const popHeight = Math.min(300, pop.offsetHeight || 220);
    const left = Math.max(6, Math.min(barRect.left, innerWidth - popWidth - 6));
    const below = barRect.bottom + 8;
    const top = below + popHeight <= innerHeight - 6
      ? below
      : Math.max(6, barRect.top - popHeight - 8);
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
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
    if (window.__hbCollabClearElementBar) window.__hbCollabClearElementBar();
    // Visible status chip so "the picker is armed" is never a mystery.
    const chip = document.createElement('div');
    chip.textContent = 'ADD NOTE — click an element to pin the note · Esc to cancel';
    Object.assign(chip.style, {
      position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '8px 14px', borderRadius: '999px',
      border: '1px solid rgba(245,158,11,0.55)',
      background: 'rgba(245,158,11,0.14)',
      color: '#fbbf24', font: '600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      letterSpacing: '0.06em', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      pointerEvents: 'none',
    });
    chip.id = '__kuang_collab_pick_chip';
    document.body.appendChild(chip);
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
      document.getElementById('__kuang_collab_pick_chip')?.remove();
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
      window.__hbCollabShowElementToolbar(el, target);
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
    text: thread.messages.find((message) => message.author === 'agent')?.text
      || thread.intent
      || thread.messages[0]?.text
      || '',
    humanOnly: !thread.messages.some((message) => message.author === 'agent'),
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
    const RESOLVE_PREFIX = ${JSON.stringify(COLLABORATION_RESOLVE_PREFIX)};
    const layer = document.createElement('div');
    layer.id = layerId;
    layer.setAttribute('style', 'position:absolute;inset:0;z-index:2147483646;pointer-events:none;');
    document.body.appendChild(layer);
    // Focus navigation (orb toolbar back/forward + note list): always present,
    // even with zero threads, so collab mode stays responsive.
    window.__hbCollabFocusId = window.__hbCollabFocusId || null;
    window.__hbCollabMode = Boolean(window.__hbCollabMode);
    const clearFocus = function () {
      layer.querySelectorAll('.hb-focus-ring, .hb-flash').forEach(function (node) {
        node.classList.remove('hb-focus-ring', 'hb-flash');
      });
      window.__hbCollabFocusId = null;
    };
    window.__hbCollabToast = function (text) {
      const prior = document.getElementById('__kuang_collab_toast');
      if (prior) prior.remove();
      const toast = document.createElement('div');
      toast.id = '__kuang_collab_toast';
      toast.textContent = text;
      Object.assign(toast.style, {
        position: 'fixed', left: '50%', bottom: '88px', transform: 'translateX(-50%)',
        zIndex: '2147483647', padding: '7px 14px', borderRadius: '999px',
        border: '1px solid rgba(34,197,94,0.55)', background: 'rgba(22,101,52,0.92)',
        color: '#bbf7d0', font: '600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        letterSpacing: '0.05em', boxShadow: '0 10px 26px rgba(0,0,0,0.45)',
        pointerEvents: 'none',
      });
      document.body.appendChild(toast);
      setTimeout(function () {
        toast.style.opacity = '0';
        setTimeout(function () { toast.remove(); }, 220);
      }, 1600);
    };
    window.__hbCollabEnterMode = function () {
      window.__hbCollabMode = true;
      layer.style.display = '';
      layer.classList.add('is-collab-active');
      if (window.__hbCollabModeKeyHandler) {
        document.removeEventListener('keydown', window.__hbCollabModeKeyHandler, true);
      }
      window.__hbCollabModeKeyHandler = function (event) {
        if (event.key !== 'Escape' || !window.__hbCollabMode) return;
        const cssEditor = document.getElementById('__kuang_collab_csspop');
        if (cssEditor) {
          cssEditor.remove();
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        // Escape from note mode cancels its current tool and exits collab mode
        // in one press; the page must never look selected after the toolbar is gone.
        if (window.__kuangCollabPicking) window.__kuangCollabPickerCancel?.();
        if (document.getElementById('__kuang_collab_drawer')) window.__kuangCollabSelectionCancel?.();
        event.preventDefault();
        event.stopImmediatePropagation();
        console.log(${JSON.stringify(COLLABORATION_EXIT_PREFIX)});
      };
      document.addEventListener('keydown', window.__hbCollabModeKeyHandler, true);
      if (window.__hbCollabFocusId) window.__hbCollabShowThread(window.__hbCollabFocusId);
    };
    window.__hbCollabExitMode = function () {
      window.__hbCollabMode = false;
      if (window.__hbCollabModeKeyHandler) {
        document.removeEventListener('keydown', window.__hbCollabModeKeyHandler, true);
        delete window.__hbCollabModeKeyHandler;
      }
      layer.style.display = 'none';
      layer.classList.remove('is-collab-active');
      clearFocus();
      document.getElementById('__kuang_collab_csspop')?.remove();
      document.getElementById('__kuang_collab_elementbar')?.remove();
      document.querySelectorAll('.hb-el-selected').forEach(function (node) {
        node.classList.remove('hb-el-selected');
      });
      delete window.__hbCollabSelection;
    };
    if (!window.__hbCollabMode) layer.style.display = 'none';
    window.__hbCollabShowThread = function (id) {
      const thread = threads.find(function (t) { return t.id === id; });
      layer.querySelectorAll('.hb-focus-ring').forEach(function (node) {
        node.classList.remove('hb-focus-ring');
      });
      if (!thread) {
        window.__hbCollabFocusId = null;
        return;
      }
      window.__hbCollabFocusId = id;
      const box = layer.querySelector('[data-thread-id="' + id + '"]');
      if (box) {
        box.classList.add('hb-focus-ring');
        box.classList.remove('hb-flash');
      }
      if (thread.target.selector) {
        try {
          const el = document.querySelector(thread.target.selector);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch {}
      }
      if (box) box.classList.add('hb-flash');
    };
    if (window.__hbCollabFocusId && !threads.some(function (t) { return t.id === window.__hbCollabFocusId; })) {
      window.__hbCollabFocusId = null;
    }
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
    const placedCards = [];
    for (const thread of threads) {
      const rect = rectFor(thread.target);
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const offsetX = scrollX;
      const offsetY = scrollY;
      const box = document.createElement('div');
      box.className = 'hb-box' + (thread.humanOnly ? ' hb-human' : '');
      box.setAttribute('data-thread-id', thread.id);
      Object.assign(box.style, {
        left: rect.left + offsetX + 'px', top: rect.top + offsetY + 'px',
        width: Math.max(8, rect.width) + 'px', height: Math.max(8, rect.height) + 'px',
      });
      const card = document.createElement('div');
      card.className = 'hb-agent' + (thread.humanOnly ? ' hb-human' : '');
      const head = document.createElement('div');
      head.className = 'hb-agent-head';
      const dot = document.createElement('span');
      dot.className = 'hb-agent-dot';
      const label = document.createElement('span');
      label.textContent = 'Collab';
    const id = document.createElement('span');
    id.className = 'hb-agent-id';
    id.textContent = thread.id.slice(-6);
    const resolve = document.createElement('button');
    resolve.type = 'button';
    resolve.className = 'hb-resolve';
    resolve.textContent = '✓';
    resolve.title = 'Resolve this note';
    resolve.setAttribute('aria-label', 'Resolve this collaboration note');
    resolve.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      resolve.disabled = true;
      resolve.textContent = '…';
      console.log(RESOLVE_PREFIX + JSON.stringify({ id: thread.id }));
    });
    head.append(dot, label, id, resolve);
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
      const left = clamp(rect.left, margin, Math.max(margin, usableWidth - width - margin));
      // Stack cards that would cover each other instead of overlapping.
      let docTop = top + offsetY;
      const overlaps = () =>
        placedCards.some(
          (other) =>
            left + offsetX < other.left + other.width + 8 &&
            left + offsetX + width + 8 > other.left &&
            docTop < other.top + other.height + 8 &&
            docTop + height + 8 > other.top,
        );
      let guard = 0;
      while (overlaps() && guard < 12) {
        docTop += height + 10;
        guard += 1;
      }
      docTop = clamp(docTop, margin, Math.max(margin, document.documentElement.scrollHeight - height - margin));
      placedCards.push({ left: left + offsetX, top: docTop, width, height });
      card.style.left = Math.round(left + offsetX) + 'px';
      card.style.top = Math.round(docTop) + 'px';
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
    if (window.__hbCollabMode && window.__hbCollabFocusId && threads.some(function (t) { return t.id === window.__hbCollabFocusId; })) {
      window.__hbCollabShowThread(window.__hbCollabFocusId);
    }
  })()`;
}
