/** Shared media settings and updater state (main, preload, renderer). */

export interface MediaSettings {
  /** Check for a newer yt-dlp on launch and on the interval below. */
  autoUpdate: boolean;
  /** Minutes between automatic checks. Clamped to 15–1440. */
  updateIntervalMinutes: number;
}

export interface MediaUpdaterState {
  autoUpdate: boolean;
  intervalMinutes: number;
  channel: 'stable';
  installedVersion: string | null;
  latestVersion: string | null;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  lastError: string | null;
  checking: boolean;
  updateAvailable: boolean;
}

export interface MediaSettingsSnapshot {
  settings: MediaSettings;
  updater: MediaUpdaterState;
}
