import type { ElectronAPI } from '../preload/index.js';
import type { CollaborationThread, CollaborationTarget } from '../shared/collaboration.js';

const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

let initialized = false;
let panelOpen = false;
let threads: CollaborationThread[] = [];
let selectedId: string | null = null;

function setStatus(text: string): void {
  const el = byId<HTMLElement>('collab-status');
  if (el) el.textContent = text;
}

function showResult(kind: 'success' | 'error' | 'info', text: string): void {
  const el = byId<HTMLElement>('collab-result');
  if (!el) return;
  el.className = `alert alert-${kind} text-[11px] m-2`;
  el.textContent = text;
  el.classList.remove('hidden');
}

function targetLabel(target: CollaborationTarget): string {
  return target.name || target.text || target.selector || target.reference || target.url;
}

function openPanel(): void {
  panelOpen = true;
  byId<HTMLElement>('collab-panel')?.classList.remove('hidden');
  void refresh();
}

async function startPicker(): Promise<void> {
  setStatus('Pick an element on the page');
  const result = await api?.startCollaborationPicker();
  if (!result?.ok) {
    showResult('error', result?.error || 'Could not start the picker.');
    return;
  }
  if (result.target) {
    panelOpen = false;
    byId<HTMLElement>('collab-panel')?.classList.add('hidden');
    setStatus('Note card open on the page');
  } else {
    setStatus('Picker cancelled');
  }
}

function closePanel(): void {
  panelOpen = false;
  byId<HTMLElement>('collab-panel')?.classList.add('hidden');
  void api?.stopCollaborationPicker();
}

function updateCount(): void {
  const count = byId<HTMLElement>('collab-count');
  const open = threads.filter((thread) => thread.status !== 'resolved').length;
  for (const badge of [count, byId<HTMLElement>('deck-orb-count')]) {
    if (!badge) continue;
    badge.textContent = String(open);
    badge.classList.toggle('hidden', open === 0);
  }
}

function renderList(): void {
  const list = byId<HTMLElement>('collab-list');
  if (!list) return;
  list.replaceChildren();
  if (!threads.length) {
    const empty = document.createElement('div');
    empty.className = 'text-[11px] text-base-content/40 p-6 text-center leading-relaxed';
    empty.textContent = 'No threads yet. Pick an element on the page and leave a note to start one.';
    list.append(empty);
    return;
  }
  for (const thread of threads) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `w-full text-left rounded-lg border p-2.5 transition-colors ${
      thread.id === selectedId
        ? 'border-warning/70 bg-base-100'
        : 'border-base-300 bg-base-200/40 hover:border-base-content/25 hover:bg-base-200/70'
    }`;
    card.addEventListener('click', () => {
      selectedId = thread.id;
      renderList();
      renderDetail();
    });
    const head = document.createElement('div');
    head.className = 'flex items-center justify-between gap-2';
    const title = document.createElement('span');
    title.className = 'text-[12px] font-medium text-base-content truncate';
    title.textContent = targetLabel(thread.target);
    const status = document.createElement('span');
    status.className = `badge badge-sm shrink-0 ${thread.status === 'open' ? 'badge-warning' : thread.status === 'answered' ? 'badge-info' : 'badge-ghost'}`;
    status.textContent = thread.status;
    head.append(title, status);
    const text = document.createElement('div');
    text.className = 'text-[11px] text-base-content/60 mt-1 line-clamp-2 leading-relaxed';
    text.textContent = thread.messages[0]?.text || thread.intent || '';
    card.append(head, text);
    list.append(card);
  }
  updateCount();
}

function renderDetail(): void {
  const detail = byId<HTMLElement>('collab-detail');
  if (!detail) return;
  const thread = threads.find((entry) => entry.id === selectedId);
  if (!thread) {
    detail.classList.add('hidden');
    detail.replaceChildren();
    return;
  }
  detail.classList.remove('hidden');
  detail.replaceChildren();

  const title = document.createElement('div');
  title.className = 'text-[12px] font-semibold text-base-content';
  title.textContent = targetLabel(thread.target);
  detail.append(title);

  for (const message of thread.messages) {
    const fromHuman = message.author === 'human';
    const row = document.createElement('div');
    row.className = `rounded-lg p-2.5 text-[12px] leading-relaxed ${
      fromHuman ? 'bg-warning/10 border border-warning/30' : 'bg-info/10 border border-info/30'
    }`;
    const who = document.createElement('div');
    who.className = `text-[10px] uppercase tracking-wider ${fromHuman ? 'text-warning/80' : 'text-info/80'}`;
    who.textContent = `${message.author} · ${message.kind}`;
    const body = document.createElement('div');
    body.className = 'mt-1 whitespace-pre-wrap break-words';
    body.textContent = message.text;
    row.append(who, body);
    detail.append(row);
  }

  const question = thread.messages.find((message) => message.kind === 'question' && message.choices?.length);
  if (question?.choices?.length && thread.status !== 'resolved') {
    const choices = document.createElement('div');
    choices.className = 'flex flex-wrap gap-1.5';
    for (const choice of question.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-xs btn-outline btn-info text-[11px]';
      button.textContent = choice;
      button.addEventListener('click', () => void reply(thread, choice, 'answer', choice));
      choices.append(button);
    }
    detail.append(choices);
  }

  if (thread.status !== 'resolved') {
    const replyBox = document.createElement('textarea');
    replyBox.className = 'textarea textarea-sm w-full h-16 text-[12px] leading-relaxed';
    replyBox.placeholder = 'Reply to the agent…';
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.className = 'btn btn-xs btn-warning font-semibold text-[11px]';
    replyBtn.textContent = 'Reply';
    replyBtn.addEventListener('click', () => void reply(thread, replyBox.value, 'comment'));
    const resolveBtn = document.createElement('button');
    resolveBtn.type = 'button';
    resolveBtn.className = 'btn btn-xs btn-ghost text-error hover:bg-error/10 text-[11px]';
    resolveBtn.textContent = 'Resolve';
    resolveBtn.addEventListener('click', () => void resolve(thread));
    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-2';
    actions.append(replyBtn, resolveBtn);
    detail.append(replyBox, actions);
  }
}

async function refresh(): Promise<void> {
  try {
    const result = await api?.listCollaborationThreads({});
    if (!result?.ok) {
      showResult('error', result?.error || 'Could not load collaboration threads.');
      return;
    }
    threads = result.threads || [];
    if (selectedId && !threads.some((thread) => thread.id === selectedId)) selectedId = null;
    if (!selectedId && threads[0]) selectedId = threads[0].id;
    renderList();
    renderDetail();
  } catch (error: any) {
    showResult('error', `Could not load collaboration threads: ${error?.message || error}`);
  }
}

async function reply(thread: CollaborationThread, text: string, kind: 'comment' | 'answer', answer?: string): Promise<void> {
  const value = text.trim();
  if (!value) return;
  const result = await api?.replyCollaborationThread({ id: thread.id, text: value, kind, answer });
  if (!result?.ok) {
    showResult('error', result?.error || 'Could not reply.');
    return;
  }
  await refresh();
}

async function resolve(thread: CollaborationThread): Promise<void> {
  const result = await api?.resolveCollaborationThread({ id: thread.id, notes: 'Resolved from the collaboration panel.' });
  if (!result?.ok) {
    showResult('error', result?.error || 'Could not resolve.');
    return;
  }
  await refresh();
}

export function initCollaborationPanel(): void {
  if (initialized) return;
  initialized = true;
  byId<HTMLButtonElement>('collab-btn')?.addEventListener('click', async (event) => {
    const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    const anchor = rect && rect.width ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined;
    const result = await api?.showCollaborationMenu(anchor);
    if (!result?.ok) showResult('error', result?.error || 'Could not open the collaboration menu.');
  });
  byId<HTMLButtonElement>('collab-close-btn')?.addEventListener('click', closePanel);
  byId<HTMLButtonElement>('collab-refresh-btn')?.addEventListener('click', () => void refresh());
  byId<HTMLButtonElement>('collab-pick-btn')?.addEventListener('click', () => void startPicker());
  // Escape is the intuitive exit: it closes the panel (and stops the picker).
  // While typing in a field it steps out of the field first.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const target = event.target as HTMLElement | null;
    const editable =
      !!target &&
      (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
    if (editable) {
      target?.blur();
      return;
    }
    if (panelOpen) closePanel();
  });
  api?.onCollaborationTarget(() => {
    panelOpen = false;
    byId<HTMLElement>('collab-panel')?.classList.add('hidden');
    setStatus('Note card open on the page');
  });
  api?.onCollaborationOpen(() => openPanel());
  api?.onCollaborationUpdated(() => {
    if (panelOpen) void refresh();
  });
}
