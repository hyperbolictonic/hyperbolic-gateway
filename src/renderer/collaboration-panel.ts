import type { ElectronAPI } from '../preload/index.js';
import type { CollaborationThread, CollaborationTarget } from '../shared/collaboration.js';

const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

let initialized = false;
let panelOpen = false;
let threads: CollaborationThread[] = [];
let selectedId: string | null = null;
let pendingTarget: CollaborationTarget | null = null;

function setStatus(text: string): void {
  const el = byId<HTMLElement>('collab-status');
  if (el) el.textContent = text;
}

function showResult(kind: 'success' | 'error' | 'info', text: string): void {
  const el = byId<HTMLElement>('collab-result');
  if (!el) return;
  el.className = `alert alert-${kind} alert-sm font-mono text-[10px] m-2`;
  el.textContent = text;
  el.classList.remove('hidden');
}

function targetLabel(target: CollaborationTarget): string {
  return target.name || target.text || target.selector || target.reference || target.url;
}

function closeMenu(): void {
  byId<HTMLElement>('collab-menu')?.classList.add('hidden');
}

function openPanel(): void {
  panelOpen = true;
  closeMenu();
  byId<HTMLElement>('collab-panel')?.classList.remove('hidden');
  void refresh();
}

async function startPicker(): Promise<void> {
  closeMenu();
  setStatus('Picking — click a page element');
  const result = await api?.startCollaborationPicker();
  if (!result?.ok) {
    showResult('error', result?.error || 'Could not start the picker.');
    return;
  }
  if (result.target) {
    panelOpen = false;
    byId<HTMLElement>('collab-panel')?.classList.add('hidden');
    setStatus('Note drawer open on the page');
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
  if (count) count.textContent = String(threads.filter((thread) => thread.status !== 'resolved').length);
}

function renderList(): void {
  const list = byId<HTMLElement>('collab-list');
  if (!list) return;
  list.replaceChildren();
  if (!threads.length) {
    const empty = document.createElement('div');
    empty.className = 'font-mono text-[10px] text-base-content/40 p-3 text-center';
    empty.textContent = 'No collaboration threads yet.';
    list.append(empty);
    return;
  }
  for (const thread of threads) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `w-full text-left rounded border p-2 font-mono ${
      thread.id === selectedId ? 'border-accent bg-base-100' : 'border-base-300 bg-base-200/30 hover:border-base-content/30'
    }`;
    card.addEventListener('click', () => {
      selectedId = thread.id;
      renderList();
      renderDetail();
    });
    const head = document.createElement('div');
    head.className = 'flex items-center justify-between gap-2';
    const title = document.createElement('span');
    title.className = 'text-[11px] text-accent truncate';
    title.textContent = targetLabel(thread.target);
    const status = document.createElement('span');
    status.className = `badge badge-xs ${thread.status === 'open' ? 'badge-warning' : thread.status === 'answered' ? 'badge-info' : 'badge-ghost'}`;
    status.textContent = thread.status;
    head.append(title, status);
    const text = document.createElement('div');
    text.className = 'text-[10px] text-base-content/60 mt-1 line-clamp-2';
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
  title.className = 'font-mono text-[11px] font-bold text-accent';
  title.textContent = targetLabel(thread.target);
  detail.append(title);

  for (const message of thread.messages) {
    const row = document.createElement('div');
    row.className = `rounded p-2 text-[10px] ${message.author === 'human' ? 'bg-info/10 border border-info/30' : 'bg-base-200 border border-base-300'}`;
    const who = document.createElement('div');
    who.className = 'font-mono text-[9px] text-base-content/40';
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
    choices.className = 'flex flex-wrap gap-1';
    for (const choice of question.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-xs btn-outline btn-info font-mono text-[10px]';
      button.textContent = choice;
      button.addEventListener('click', () => void reply(thread, choice, 'answer', choice));
      choices.append(button);
    }
    detail.append(choices);
  }

  if (thread.status !== 'resolved') {
    const replyBox = document.createElement('textarea');
    replyBox.className = 'textarea textarea-sm w-full h-16 font-mono text-[10px]';
    replyBox.placeholder = 'Reply to the agent…';
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.className = 'btn btn-xs btn-primary font-mono text-[10px]';
    replyBtn.textContent = 'REPLY';
    replyBtn.addEventListener('click', () => void reply(thread, replyBox.value, 'comment'));
    const resolveBtn = document.createElement('button');
    resolveBtn.type = 'button';
    resolveBtn.className = 'btn btn-xs btn-ghost btn-error font-mono text-[10px]';
    resolveBtn.textContent = 'RESOLVE';
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

function showCompose(target: CollaborationTarget): void {
  pendingTarget = target;
  const compose = byId<HTMLElement>('collab-compose');
  const label = byId<HTMLElement>('collab-target');
  if (label) label.textContent = targetLabel(target);
  compose?.classList.remove('hidden');
  setStatus('Element captured — add a note');
  byId<HTMLTextAreaElement>('collab-comment')?.focus();
}

async function saveNote(): Promise<void> {
  if (!pendingTarget) {
    showResult('error', 'Pick an element first.');
    return;
  }
  const text = byId<HTMLTextAreaElement>('collab-comment')?.value.trim() || '';
  if (!text) {
    showResult('error', 'Write a note first.');
    return;
  }
  const tags = (byId<HTMLInputElement>('collab-tags')?.value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const result = await api?.createCollaborationThread({ target: pendingTarget, text, tags, kind: 'comment' });
  if (!result?.ok) {
    showResult('error', result?.error || 'Could not save the note.');
    return;
  }
  pendingTarget = null;
  byId<HTMLElement>('collab-compose')?.classList.add('hidden');
  if (byId<HTMLTextAreaElement>('collab-comment')) byId<HTMLTextAreaElement>('collab-comment')!.value = '';
  if (byId<HTMLInputElement>('collab-tags')) byId<HTMLInputElement>('collab-tags')!.value = '';
  selectedId = result.thread?.id || null;
  await api?.stopCollaborationPicker();
  await refresh();
  showResult('success', 'Note added.');
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
  byId<HTMLButtonElement>('collab-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    byId<HTMLElement>('collab-menu')?.classList.toggle('hidden');
  });
  byId<HTMLButtonElement>('collab-action-pick')?.addEventListener('click', () => void startPicker());
  byId<HTMLButtonElement>('collab-action-open')?.addEventListener('click', openPanel);
  byId<HTMLButtonElement>('collab-close-btn')?.addEventListener('click', closePanel);
  byId<HTMLButtonElement>('collab-refresh-btn')?.addEventListener('click', () => void refresh());
  byId<HTMLButtonElement>('collab-pick-btn')?.addEventListener('click', () => void startPicker());
  document.addEventListener('click', (event) => {
    const menu = byId<HTMLElement>('collab-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (!(event.target as HTMLElement).closest('#collab-menu, #collab-btn')) closeMenu();
  });
  byId<HTMLButtonElement>('collab-save-btn')?.addEventListener('click', () => void saveNote());
  api?.onCollaborationTarget((target) => {
    openPanel();
    showCompose(target);
  });
  api?.onCollaborationCompose(() => {
    openPanel();
    if (pendingTarget) showCompose(pendingTarget);
    else setStatus('Pick an element first');
  });
  api?.onCollaborationUpdated(() => {
    if (panelOpen) void refresh();
  });
}
