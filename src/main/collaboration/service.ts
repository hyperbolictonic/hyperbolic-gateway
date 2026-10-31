import type { BrowserChassis } from '../browser-chassis.js';
import type {
  CollaborationFilter,
  CollaborationMessage,
  CollaborationTarget,
  CollaborationThread,
} from '../../shared/collaboration.js';
import { CollaborationStore, type CreateThreadInput } from './store.js';
import { collaborationOverlayScript } from './overlay.js';

export class CollaborationService {
  readonly store: CollaborationStore;
  private readonly chassis: BrowserChassis;

  private readonly onChange?: () => void;

  constructor(store: CollaborationStore, chassis: BrowserChassis, onChange?: () => void) {
    this.store = store;
    this.chassis = chassis;
    this.onChange = onChange;
  }

  list(filter: CollaborationFilter = {}): CollaborationThread[] {
    return this.store.list(filter);
  }

  get(id: string): CollaborationThread | undefined {
    return this.store.get(id);
  }

  create(input: CreateThreadInput): CollaborationThread {
    const thread = this.store.create(input);
    void this.refreshOverlay();
    this.onChange?.();
    return thread;
  }

  /**
   * Record a human class-list edit on a pinned element as a thread, so the
   * agent can read the human's intent (+added / -removed selectors ride the
   * same store as notes).
   */
  recordClassEdit(target: CollaborationTarget, added: string[], removed: string[]): CollaborationThread {
    const parts = [...added.map((cls) => '+' + cls), ...removed.map((cls) => '-' + cls)];
    const summary = parts.length ? 'Class edit: ' + parts.join(' ') : 'Class edit (no changes)';
    const thread = this.create({
      target,
      text: summary,
      tags: ['class-edit', ...added],
    });
    return thread;
  }

  reply(id: string, message: Omit<CollaborationMessage, 'id' | 'createdAt'>): CollaborationThread {
    const thread = this.store.addMessage(id, message, message.kind === 'answer' ? 'answered' : undefined);
    void this.refreshOverlay();
    this.onChange?.();
    return thread;
  }

  resolve(id: string, notes?: string): CollaborationThread {
    const thread = this.store.resolve(id, notes);
    void this.refreshOverlay();
    this.onChange?.();
    return thread;
  }

  async refreshOverlay(): Promise<void> {
    try {
      const url = this.chassis.getPageInfo().url;
      const threads = this.store.list({ url });
      const wc = this.chassis.getActiveWebContents();
      if (!wc || wc.isDestroyed()) return;
      const rightInset = this.chassis.getSidebarPageInset();
      await wc.executeJavaScript(collaborationOverlayScript(threads, { rightInset })).catch(() => null);
    } catch {
      // Overlay refresh is best-effort; the persisted thread remains authoritative.
    }
  }
}
