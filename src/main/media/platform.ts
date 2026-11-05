/**
 * Pure helpers for the media tooling: platform naming and the yt-dlp runtime.
 *
 * Kept free of Electron imports so the unit tests can exercise them under plain
 * Node, where `import { app } from 'electron'` is only a path string.
 */

export type YtDlpRuntimeKind = 'electron-node' | 'none';

export interface YtDlpRuntime {
  readonly kind: YtDlpRuntimeKind;
  /** Extra yt-dlp arguments for the runtime (empty when none is available). */
  readonly args: readonly string[];
  /** Environment for the yt-dlp process. */
  readonly env: NodeJS.ProcessEnv;
  /** The Node version the runtime reports, when it is Electron. */
  readonly node: string | null;
}

/** `win32-x64`, `darwin-arm64`, `linux-x64` — matches `bin/media/<key>`. */
export function mediaPlatformKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

export function ytDlpFileName(platform: string = process.platform): string {
  return platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

/**
 * Point yt-dlp at Electron's own binary as a Node runtime.
 *
 * Since yt-dlp 2025.11.12, YouTube needs an external JavaScript runtime for full
 * format support. Electron ≥ 22 embeds a modern Node, and runs as one when
 * `ELECTRON_RUN_AS_NODE=1` is set, so the app ships no extra runtime. The env
 * var is inherited by yt-dlp and by the runtime process it spawns.
 *
 * When the check cannot pass (plain Node, an old Electron), return no runtime:
 * yt-dlp still downloads, with the "some formats may be missing" warning.
 */
export function ytdlpRuntimeOptions(
  execPath: string = process.execPath,
  versions: NodeJS.ProcessVersions = process.versions,
  env: NodeJS.ProcessEnv = process.env,
): YtDlpRuntime {
  const major = Number.parseInt(String(versions.node ?? '0').split('.')[0] ?? '0', 10);
  const usable = Boolean(versions.electron) && Number.isFinite(major) && major >= 22;
  if (!usable) {
    return { kind: 'none', args: [], env: { ...env }, node: versions.node ?? null };
  }
  return {
    kind: 'electron-node',
    args: ['--js-runtimes', `node:${execPath}`],
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    node: versions.node ?? null,
  };
}

/** Compare `2026.10.26`-style versions. Returns >0 when `a` is newer. */
export function compareYtDlpVersions(a: string | null, b: string | null): number {
  const parts = (value: string | null): number[] =>
    (value ?? '')
      .replace(/^v/i, '')
      .split(/[^0-9]+/u)
      .filter(Boolean)
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part));

  const left = parts(a);
  const right = parts(b);
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return -1;
  if (right.length === 0) return 1;

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}
