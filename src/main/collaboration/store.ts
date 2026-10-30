import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CollaborationFilter,
  CollaborationMessage,
  CollaborationTarget,
  CollaborationThread,
  CollaborationThreadStatus,
} from '../../shared/collaboration.js';

interface CollaborationFile {
  schemaVersion: 1;
  threads: CollaborationThread[];
}

const MAX_THREADS = 500;
const MAX_MESSAGES = 200;
const MAX_TEXT = 8_000;

function cleanText(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanChoices(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const choices = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 12);
  return choices.length ? choices : undefined;
}

function cleanTarget(input: unknown): CollaborationTarget | null {
  if (!input || typeof input !== 'object') return null;
  const source = input as Record<string, any>;
  const url = cleanText(source.url, 2_000);
  if (!url) return null;
  const rect = source.rect && typeof source.rect === 'object'
    ? {
        x: Number(source.rect.x) || 0,
        y: Number(source.rect.y) || 0,
        width: Number(source.rect.width) || 0,
        height: Number(source.rect.height) || 0,
      }
    : undefined;
  return {
    kind: ['element', 'text', 'frame', 'console', 'network', 'region', 'style', 'page'].includes(source.kind)
      ? source.kind
      : 'element',
    url,
    tabId: cleanText(source.tabId, 200) || undefined,
    frameId: cleanText(source.frameId, 200) || undefined,
    revision: Number.isFinite(Number(source.revision)) ? Number(source.revision) : undefined,
    markId: Number.isFinite(Number(source.markId)) ? Number(source.markId) : undefined,
    selector: cleanText(source.selector, 1_000) || undefined,
    role: cleanText(source.role, 100) || undefined,
    name: cleanText(source.name, 200) || undefined,
    text: cleanText(source.text, 1_000) || undefined,
    rect,
    reference: cleanText(source.reference, 1_000) || undefined,
  };
}

function cleanThread(input: any): CollaborationThread | null {
  const target = cleanTarget(input?.target);
  if (!target) return null;
  const now = Date.now();
  const messages: CollaborationMessage[] = Array.isArray(input?.messages)
    ? input.messages.slice(-MAX_MESSAGES).map((message: any) => ({
        id: cleanText(message?.id, 100) || `msg_${crypto.randomUUID()}`,
        author: message?.author === 'human' ? 'human' : 'agent',
        kind: ['comment', 'question', 'choice', 'answer', 'status'].includes(message?.kind)
          ? message.kind
          : 'comment',
        text: cleanText(message?.text),
        choices: cleanChoices(message?.choices),
        answer: cleanText(message?.answer, 2_000) || undefined,
        createdAt: Number(message?.createdAt) || now,
      }))
    : [];
  return {
    id: cleanText(input?.id, 100) || `collab_${crypto.randomUUID()}`,
    createdAt: Number(input?.createdAt) || now,
    updatedAt: Number(input?.updatedAt) || now,
    status: ['open', 'answered', 'resolved', 'stale'].includes(input?.status) ? input.status : 'open',
    target,
    intent: cleanText(input?.intent, 1_000) || undefined,
    tags: Array.isArray(input?.tags)
      ? input.tags.filter((tag: unknown): tag is string => typeof tag === 'string').map((tag: string) => tag.trim()).filter(Boolean).slice(0, 12)
      : [],
    messages,
    resolution: cleanText(input?.resolution, 2_000) || undefined,
  };
}

export interface CreateThreadInput {
  target: unknown;
  intent?: string;
  tags?: string[];
  kind?: 'comment' | 'question';
  text: string;
  choices?: string[];
}

export class CollaborationStore {
  readonly file: string;
  private threads: CollaborationThread[] = [];

  constructor(file: string) {
    this.file = file;
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const list = Array.isArray(parsed?.threads) ? parsed.threads : [];
      this.threads = list.map(cleanThread).filter(Boolean).slice(-MAX_THREADS) as CollaborationThread[];
    } catch {
      this.threads = [];
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const data: CollaborationFile = { schemaVersion: 1, threads: this.threads.slice(-MAX_THREADS) };
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, this.file);
  }

  list(filter: CollaborationFilter = {}): CollaborationThread[] {
    const url = filter.url?.split('#')[0];
    const limit = Math.min(200, Math.max(1, Number(filter.limit) || 100));
    return this.threads
      .filter((thread) => !url || thread.target.url.split('#')[0] === url)
      .filter((thread) => !filter.status || thread.status === filter.status)
      .filter((thread) => !filter.tabId || thread.target.tabId === filter.tabId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  get(id: string): CollaborationThread | undefined {
    return this.threads.find((thread) => thread.id === id);
  }

  create(input: CreateThreadInput): CollaborationThread {
    const target = cleanTarget(input.target);
    if (!target) throw new Error('A collaboration target with a URL is required.');
    const text = cleanText(input.text);
    if (!text) throw new Error('A collaboration message is required.');
    const now = Date.now();
    const message: CollaborationMessage = {
      id: `msg_${crypto.randomUUID()}`,
      author: 'agent',
      kind: input.kind === 'question' ? 'question' : 'comment',
      text,
      choices: cleanChoices(input.choices),
      createdAt: now,
    };
    const thread: CollaborationThread = {
      id: `collab_${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      target,
      intent: cleanText(input.intent, 1_000) || undefined,
      tags: Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 12) : [],
      messages: [message],
    };
    this.threads.push(thread);
    if (this.threads.length > MAX_THREADS) this.threads = this.threads.slice(-MAX_THREADS);
    this.save();
    return thread;
  }

  addMessage(id: string, message: Omit<CollaborationMessage, 'id' | 'createdAt'>, status?: CollaborationThreadStatus): CollaborationThread {
    const thread = this.get(id);
    if (!thread) throw new Error(`Collaboration thread "${id}" not found.`);
    thread.messages.push({ ...message, id: `msg_${crypto.randomUUID()}`, createdAt: Date.now() });
    if (thread.messages.length > MAX_MESSAGES) thread.messages = thread.messages.slice(-MAX_MESSAGES);
    thread.updatedAt = Date.now();
    if (status) thread.status = status;
    this.save();
    return thread;
  }

  resolve(id: string, notes?: string): CollaborationThread {
    const thread = this.get(id);
    if (!thread) throw new Error(`Collaboration thread "${id}" not found.`);
    thread.status = 'resolved';
    thread.updatedAt = Date.now();
    thread.resolution = cleanText(notes, 2_000) || 'Resolved';
    this.save();
    return thread;
  }
}
