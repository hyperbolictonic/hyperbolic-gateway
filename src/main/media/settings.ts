/**
 * Media settings, stored next to the other user settings.
 *
 * Written only from the Settings panel over IPC. The bridge may read the
 * resulting auto-update state, but it never changes a setting.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { MediaSettings } from '../../shared/media.ts';

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  autoUpdate: true,
  updateIntervalMinutes: 60,
};

const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 24 * 60;

export function normalizeMediaSettings(input: unknown): MediaSettings {
  const raw = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const autoUpdate = typeof raw.autoUpdate === 'boolean' ? raw.autoUpdate : DEFAULT_MEDIA_SETTINGS.autoUpdate;
  const requested = Number(raw.updateIntervalMinutes);
  const interval = Number.isFinite(requested)
    ? Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(requested)))
    : DEFAULT_MEDIA_SETTINGS.updateIntervalMinutes;
  return { autoUpdate, updateIntervalMinutes: interval };
}

export class MediaSettingsStore {
  constructor(private readonly file: string) {}

  load(): MediaSettings {
    try {
      return normalizeMediaSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return { ...DEFAULT_MEDIA_SETTINGS };
    }
  }

  save(patch: unknown): MediaSettings {
    const next = normalizeMediaSettings({ ...this.load(), ...(patch as Record<string, unknown>) });
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.file);
    } catch {
      // The caller still gets the normalised value; the next save can retry.
    }
    return next;
  }
}
