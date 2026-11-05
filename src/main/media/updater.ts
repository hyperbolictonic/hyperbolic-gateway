/**
 * yt-dlp updater.
 *
 * yt-dlp breaks when a site changes, so it is the one binary that updates
 * itself at runtime. The stable release is checked on launch and on an
 * interval (default: one hour) with jitter, and installed from the tagged
 * release asset that the GitHub API returned for that check — never from
 * `latest/download`, which can race a new release.
 *
 * Every download is checked against the release's `SHA2-256SUMS` before it is
 * allowed near the writable binary, and a swap that cannot run `--version` is
 * rolled back. Updates only happen while no download job is running.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { MediaSettings, MediaUpdaterState } from '../../shared/media.ts';
import { compareYtDlpVersions, parseChecksum, ytDlpReleaseAsset } from './platform.ts';

const RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const CHECKSUMS_ASSET = 'SHA2-256SUMS';
const USER_AGENT = 'hypagon-gateway-media-updater';
const LAUNCH_DELAY_MS = 15_000;
const LAUNCH_JITTER_MS = 120_000;
const RETRY_WHILE_BUSY_MS = 120_000;
const MAX_BACKOFF_MS = 24 * 60 * 60_000;

interface ReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

interface ReleaseResponse {
  readonly tag_name?: string;
  readonly published_at?: string;
  readonly assets?: ReleaseAsset[];
}

export interface MediaUpdaterOptions {
  readonly binaryPath: () => string;
  readonly readVersion: (binary: string) => Promise<string | null>;
  readonly settings: () => MediaSettings;
  readonly hasRunningJobs: () => boolean;
  readonly onUpdated: () => void;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normaliseVersion(value: string | undefined | null): string | null {
  const cleaned = (value ?? '').trim().replace(/^v/i, '');
  return cleaned === '' ? null : cleaned;
}

/** ±10% jitter so a fleet of installs does not hit GitHub on the same second. */
export function jitter(ms: number, random: () => number = Math.random): number {
  const spread = ms * 0.1;
  return Math.max(60_000, Math.round(ms - spread + random() * spread * 2));
}

export class MediaUpdater {
  private readonly options: MediaUpdaterOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private inFlight: Promise<MediaUpdaterState> | null = null;

  private installedVersion: string | null = null;
  private latestVersion: string | null = null;
  private lastCheckedAt: string | null = null;
  private lastUpdatedAt: string | null = null;
  private lastError: string | null = null;
  private failures = 0;
  private retryDelayMs: number | null = null;

  constructor(options: MediaUpdaterOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  state(): MediaUpdaterState {
    const settings = this.options.settings();
    const autoUpdate = this.autoUpdateEnabled(settings);
    return {
      autoUpdate,
      intervalMinutes: settings.updateIntervalMinutes,
      channel: 'stable',
      installedVersion: this.installedVersion,
      latestVersion: this.latestVersion,
      lastCheckedAt: this.lastCheckedAt,
      lastUpdatedAt: this.lastUpdatedAt,
      lastError: this.lastError,
      checking: this.inFlight !== null,
      updateAvailable: compareYtDlpVersions(this.latestVersion, this.installedVersion) > 0,
    };
  }

  private autoUpdateEnabled(settings: MediaSettings): boolean {
    return settings.autoUpdate && process.env.HB_MEDIA_AUTOUPDATE !== '0';
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.arm(LAUNCH_DELAY_MS + Math.random() * LAUNCH_JITTER_MS);
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Run a check now. `force` ignores the auto-update switch but never the job gate. */
  check(force = false): Promise<MediaUpdaterState> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run(force).finally(() => {
      this.inFlight = null;
      if (this.started) this.arm(this.nextDelay());
    });
    return this.inFlight;
  }

  private arm(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check(false);
    }, Math.max(1_000, delayMs));
    this.timer.unref?.();
  }

  private nextDelay(): number {
    if (this.retryDelayMs !== null) {
      const delay = this.retryDelayMs;
      this.retryDelayMs = null;
      return delay;
    }
    const settings = this.options.settings();
    const base = settings.updateIntervalMinutes * 60_000;
    if (this.failures === 0) return jitter(base);
    const backoff = Math.min(base * 2 ** Math.min(this.failures, 6), MAX_BACKOFF_MS);
    return jitter(backoff);
  }

  private async run(force: boolean): Promise<MediaUpdaterState> {
    const settings = this.options.settings();
    this.installedVersion = await this.options.readVersion(this.options.binaryPath());

    if (!force && !this.autoUpdateEnabled(settings)) {
      this.lastCheckedAt = nowIso();
      return this.state();
    }

    try {
      const release = await this.requestJson<ReleaseResponse>(RELEASE_API, 20_000);
      const latest = normaliseVersion(release.tag_name);
      if (!latest) throw new Error('the GitHub release has no tag name');
      this.latestVersion = latest;

      if (compareYtDlpVersions(latest, this.installedVersion) > 0) {
        if (this.options.hasRunningJobs()) {
          // Not a failure: try again soon instead of waiting a full interval.
          this.retryDelayMs = RETRY_WHILE_BUSY_MS;
        } else {
          const assetName = ytDlpReleaseAsset();
          const asset = (release.assets ?? []).find((entry) => entry.name === assetName);
          if (!asset) throw new Error(`release ${latest} has no ${assetName} asset`);

          const checksumsUrl = (release.assets ?? []).find(
            (entry) => entry.name === CHECKSUMS_ASSET,
          )?.browser_download_url;
          if (!checksumsUrl) throw new Error(`release ${latest} has no ${CHECKSUMS_ASSET}`);
          const checksums = await this.requestText(checksumsUrl, 20_000);
          const expected = parseChecksum(checksums, assetName);
          if (!expected) throw new Error(`${CHECKSUMS_ASSET} has no entry for ${assetName}`);

          await this.install(asset.browser_download_url, expected);
          this.installedVersion = await this.options.readVersion(this.options.binaryPath());
          this.lastUpdatedAt = nowIso();
          this.options.onUpdated();
        }
      }

      this.lastError = null;
      this.failures = 0;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.failures += 1;
    }

    this.lastCheckedAt = nowIso();
    return this.state();
  }

  private async install(url: string, expectedSha256: string): Promise<void> {
    const target = this.options.binaryPath();
    const temp = `${target}.download`;
    const backup = `${target}.backup`;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rm(temp, { force: true });

    const response = await this.fetchImpl(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok || !response.body) throw new Error(`download failed with HTTP ${response.status}`);

    const hash = createHash('sha256');
    const handle = await fsp.open(temp, 'w');
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }

    const actual = hash.digest('hex');
    if (actual !== expectedSha256) {
      await fsp.rm(temp, { force: true });
      throw new Error(`checksum mismatch: expected ${expectedSha256}, got ${actual}`);
    }

    // A job may have started while the binary was downloading; do not swap then.
    if (this.options.hasRunningJobs()) {
      await fsp.rm(temp, { force: true });
      this.retryDelayMs = RETRY_WHILE_BUSY_MS;
      throw new Error('a download job started during the update; retrying later');
    }

    await fsp.rm(backup, { force: true });
    let backedUp = false;
    try {
      await fsp.rename(target, backup);
      backedUp = true;
    } catch {
      // First install: there is no previous writable binary to keep.
    }

    try {
      await fsp.rename(temp, target);
      if (process.platform !== 'win32') await fsp.chmod(target, 0o755);
      const version = await this.options.readVersion(target);
      if (!version) throw new Error('the updated yt-dlp did not report a version');
      await fsp.rm(backup, { force: true });
    } catch (error) {
      await fsp.rm(target, { force: true });
      if (backedUp) await fsp.rename(backup, target).catch(() => undefined);
      throw error;
    }
  }

  private async requestJson<T>(url: string, timeoutMs: number): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`GitHub API responded ${response.status}`);
    return (await response.json()) as T;
  }

  private async requestText(url: string, timeoutMs: number): Promise<string> {
    const response = await this.fetchImpl(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`download of checksums responded ${response.status}`);
    return response.text();
  }
}
