# Media capture (yt-dlp)

**Status:** slice 1. `media status` and `media info` work end to end through the bridge and the
`hb-browser` MCP server. Downloads, the job queue, the runtime updater and ffmpeg handling are
planned but not shipped.

Read this before changing anything under `src/main/media/`.

## Where it lives

Media is a **tool group in `hb-browser`**, not a third MCP server. Execution happens in the main
process behind `/media/*` bridge routes, for four reasons:

- The browser session owns the cookies a logged-in download needs.
- The download manager and Cortex already live in main.
- Settings switches and the human-only gate already exist there.
- The remote gateway fronts `hb-browser`, so the tools travel without new configuration.

If the surface grows into a full media pipeline, `hb-media` can be added later as a thin stdio
façade over the same routes, exactly like `hb-rest`.

## The JavaScript runtime is Electron

Since yt-dlp `2025.11.12`, full YouTube support needs an external JavaScript runtime. The app does
not ship Deno. It hands yt-dlp **its own binary in Node mode**:

```ts
env.ELECTRON_RUN_AS_NODE = '1';
args.push('--js-runtimes', `node:${process.execPath}`);
```

`process.execPath` reports `v24.21.0` on Electron 44.7.2 when that variable is set, which satisfies
yt-dlp's Node ≥ 22 requirement. Verified end to end: the same video returns 25 formats with the
runtime and 24 without it, and without it yt-dlp warns that some formats may be missing.

`ytdlpRuntimeOptions()` returns no runtime rather than guessing when it cannot prove Node ≥ 22. The
app then behaves like a plain yt-dlp install.

## Binaries

`scripts/media-binaries.json` pins one yt-dlp release and a SHA-256 per target. `scripts/fetch-media.mjs`
downloads the asset, verifies the hash, makes it executable, runs `--version`, and **fails the build**
on any problem. It never writes a placeholder: a build that cannot fetch yt-dlp is not releaseable.

```
bin/media/<platform>-<arch>/yt-dlp[.exe]        seed, shipped, asar-unpacked
<userData>/media/bin/yt-dlp[.exe]               working copy, writable, updated at runtime
```

The seed is read-only on macOS and on AppImage mounts, so the runnable copy lives in `userData`.
It is only refreshed from the seed when the seed is *newer* (an app update shipped a newer yt-dlp),
so a runtime update is never rolled back by the next launch.

`npm run build` fetches the host binary; `npm run fetch:media -- --all` fetches every target for a
cross-platform build.

## Tool surface

| Action | State | Behaviour |
| --- | --- | --- |
| `status` | shipped | Binary version/source, runtime kind, capability flags |
| `info` | shipped | Metadata without downloading: title, duration, formats, subtitle languages, warnings |
| `download` | planned | Enqueue a job and return its id immediately |
| `status` (job) | planned | Progress, bytes, speed, ETA, output files |
| `cancel` | planned | Kill the process tree, remove the partial file |
| `list` | planned | Completed media in `<userData>/media/` |
| `transcript` | planned | Subtitles, manual then automatic, as text |

Downloads never block a tool call: the bridge timeout is 30 s, a download is minutes. Jobs are
polled, the same way `record_start` returns when capture is live.

## Security

- **No flag passthrough.** Every argument is built in `service.ts`. A generic `flags` parameter
  would let an agent pass `--exec`, which is arbitrary command execution.
- `--ignore-config` on every invocation, so a config file cannot inject options.
- Input URLs go through `assertSafeUrl` (HTTPS, no credentials, no private addresses). Residual
  risk: yt-dlp follows redirects and manifest URLs internally; the check covers the entry point only.
- Cookies are **off by default**. When enabled they are scoped to the target host, written to a
  0600 temp file, passed with `--cookies`, and deleted in `finally`. Never logged, never stored.
- The updater downloads a binary and runs it. That is a remote-code-execution channel by design:
  stable channel only, checksum-verified, rollback on a failed `--version`, and a Settings switch
  plus `HB_MEDIA_AUTOUPDATE=0` to turn it off.

## ffmpeg

Not shipped. Without it yt-dlp still downloads single-file MP4 and audio-only M4A; merging
`bestvideo+bestaudio` and mp3 conversion need it. Planned modes: `auto` (configured path → managed
directory → `PATH`), `path`, and `managed` (checksum-verified download). Capability flags in
`media status` report what works.

## Decision log

- **2026-11-05** — Placed in `hb-browser`; execution in main behind `/media/*`.
- **2026-11-05** — Runtime is Electron in Node mode; no Deno and no installer growth.
- **2026-11-05** — Pinned build-time binary with checksums; the runtime copy in `userData` is the
  only writable one. Fetchers fail closed.
- **2026-11-05** — `media info` only in the first slice: read-only and useful before downloads.
- **Planned** — Hourly updater with jitter, idle gate and rollback; cookies opt-in; ffmpeg modes.
