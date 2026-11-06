import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_ZOOM_SETTINGS,
  normalizeZoomSettings,
  type ZoomSettings,
} from '../../shared/zoom.js';

/**
 * The browser zoom policy lives next to the other human settings. The HTTP
 * bridge may read it through `browser_zoom`, but only the Settings/toolbar IPC
 * path writes the persisted mode.
 */
export class ZoomSettingsStore {
  private settings: ZoomSettings = { ...DEFAULT_ZOOM_SETTINGS };

  constructor(private readonly file: string) {
    this.load();
  }

  private load(): void {
    try {
      this.settings = normalizeZoomSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      this.settings = { ...DEFAULT_ZOOM_SETTINGS };
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

  get(): ZoomSettings {
    return { ...this.settings };
  }

  savePatch(patch: unknown): ZoomSettings {
    this.settings = normalizeZoomSettings({ ...this.settings, ...(patch as object) });
    this.save();
    return this.get();
  }
}
