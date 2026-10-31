import fs from 'node:fs';
import path from 'node:path';

export interface JevSettings {
  /** Optional page-compaction layer. Requires a configured decision model. */
  enabled: boolean;
}

export const DEFAULT_JEV_SETTINGS: JevSettings = { enabled: false };

/**
 * JEV is an optional feature (not an experimental one): it is offered only when
 * a decision model is configured, and stays off until the human opts in.
 * Written only from the Settings panel over IPC.
 */
export class JevSettingsStore {
  private settings: JevSettings = { ...DEFAULT_JEV_SETTINGS };

  constructor(private readonly file: string) {
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.settings = { enabled: parsed?.enabled === true };
    } catch {
      this.settings = { ...DEFAULT_JEV_SETTINGS };
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.file);
    } catch {
      // Keep the in-memory value; the next save retries.
    }
  }

  get(): JevSettings {
    return { ...this.settings };
  }

  savePatch(patch: unknown): JevSettings {
    this.settings = { enabled: (patch as { enabled?: unknown })?.enabled === true };
    this.save();
    return this.get();
  }
}
