import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_EXPERIMENTAL_SETTINGS,
  normalizeExperimentalSettings,
  type ExperimentalSettings,
} from '../../shared/experimental.js';

/**
 * Experimental feature flags persisted next to the other user settings.
 * Written only from the Settings panel over IPC; the HTTP bridge never mutates it.
 */
export class ExperimentalSettingsStore {
  private settings: ExperimentalSettings = { ...DEFAULT_EXPERIMENTAL_SETTINGS };

  constructor(private readonly file: string) {
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.settings = normalizeExperimentalSettings(parsed);
    } catch {
      this.settings = { ...DEFAULT_EXPERIMENTAL_SETTINGS };
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.file);
    } catch {
      // A failed write leaves the in-memory value; the next save retries.
    }
  }

  get(): ExperimentalSettings {
    return { ...this.settings };
  }

  savePatch(patch: unknown): ExperimentalSettings {
    this.settings = normalizeExperimentalSettings({ ...this.settings, ...(patch as object) });
    this.save();
    return this.get();
  }
}
