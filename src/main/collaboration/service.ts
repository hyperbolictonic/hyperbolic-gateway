import type { BrowserChassis } from '../browser-chassis.js';
import type {
  CollaborationFilter,
  CollaborationMessage,
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
