# Media capture (yt-dlp)

**Status:** slice 5. `media status`, `info`, `download`, `jobs`, `cancel` and `list` work end to end;
yt-dlp updates itself on launch and on an interval; downloads can use the browser session; and
ffmpeg can be detected, configured or installed, with a configurable save folder. Transcription is
the remaining slice.

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
| `status` | shipped | Binary version/source, runtime kind, capability flags, job counts |
| `info` | shipped | Metadata without downloading: title, duration, formats, subtitle languages, warnings |
| `download` | shipped | Enqueue a job and return its id immediately |
| `jobs` | shipped | Progress, bytes, speed, ETA, stage and output files for every job |
| `cancel` | shipped | Kill the process tree and remove the job directory |
| `list` | shipped | Completed downloads with files and sizes |
| `transcript` | planned | Subtitles, manual then automatic, as text |

Downloads never block a tool call: the bridge timeout is 30 s, a download is minutes. Jobs are
polled, the same way `record_start` returns when capture is live.

## Jobs

- One job at a time (`MAX_CONCURRENT` in `jobs.ts`); the queue is FIFO.
- History is the last 50 jobs, persisted to `<userData>/media/jobs.json`. A job that was running
  when the app exited is replayed as `failed/INTERRUPTED`, never silently resumed.
- Files are written to `<userData>/media/<jobId>/`; partials go to `.tmp`, so cancel deletes the
  whole job directory and leaves nothing in the library.
- Limits: 2 GB per file, 20 s socket timeout, 2 min without progress, 45 min per job.
- `cancel` terminates the process tree (`taskkill /T` on Windows, process group on POSIX), so a
  postprocessor child cannot outlive the job.
- Progress is parsed from `--newline` output: percent, total, speed, ETA. `downloadedBytes` is
  derived from percent × total, because yt-dlp prints the percentage rather than a running count.
- Format selection: without ffmpeg, a single-file MP4 or M4A; with it, merged `bestvideo+bestaudio`.
  `buildFormatSelector()` is the only place that decides, and a unit test pins it.

## Session cookies

Off by default. A site that needs a signed-in session returns `LOGIN_REQUIRED`, and the app shows a
desktop notification; a human then enables **Settings → Media → "Always use the browser session"**
and retries. Nothing an agent calls can turn it on.

- Scope: `session.cookies.get({ url })` for the requested URL, so yt-dlp receives what the browser
  would send to that host — not the whole jar.
- Lifecycle: written to `<userData>/media/.cookies/cookies-*.txt` with mode 0600, passed as
  `--cookies`, and deleted in a `finally` after the call or at job close/cancel.
- Never logged, never stored in job history, never returned by a tool.
- A cookie-store failure does not fail the request; it proceeds anonymously.
- Notifications are deduplicated to one per minute so a failing loop cannot spam the desktop.

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

## Updates

yt-dlp is the one binary that must keep up with the sites it reads, so it updates at runtime:

- A check runs shortly after launch (15 s + up to 2 min of jitter) and then every N minutes
  (default **60**, clamped 15–1440, set in Settings → Media).
- Each check is jittered ±10% so installs do not hit GitHub together, and it is skipped while a
  download is running (retried in 2 minutes, not counted as a failure).
- A failed check backs off exponentially (2× per failure, capped at 24 h) and surfaces the error in
  Settings and `media status`.
- `HB_MEDIA_AUTOUPDATE=0` disables automatic checks for a run; the Settings button still works.
- The download URL comes from the release the API just returned, not from `latest/download`, so a
  release published mid-check cannot install a different version than the one being reported.
- The asset is checked against the release's `SHA2-256SUMS` before it is written, then swapped in
  with a `.backup`, run with `--version`, and rolled back if it cannot execute.
- Settings are written over IPC only, per the house rule; no bridge route changes them.

## Output folder

Settings → Media has a save-folder picker. Empty means `<userData>/media`; any absolute path is
accepted. Every job still gets its own `<jobId>` subfolder under it, so cancelling a job removes
only its own partial output, never another download. A folder that cannot be created fails the job
with `OUTPUT_DIR` instead of leaving it queued.

## ffmpeg

Needed for merging separate video and audio streams, for transcoding, and for audio extraction to
an arbitrary codec. Without it yt-dlp still downloads a single-file MP4 and an audio-only stream;
`media status` reports `merge`/`transcode` accordingly.

Three modes, saved in Settings → Media:

| Mode | Resolution order |
| --- | --- |
| `auto` (default) | configured path → managed copy → `ffmpeg` on `PATH` |
| `path` | the configured binary only; no silent fallback |
| `managed` | the copy downloaded into `<userData>/media/bin/ffmpeg` only |

- `path` mode is deliberate: if the path is wrong, downloads report no ffmpeg rather than quietly
  using a different build.
- **Managed install** downloads `ffmpeg` + `ffprobe` for the host platform from the pinned
  `eugeneware/ffmpeg-static` release (`b6.1.1`), verifies a SHA-256 per asset, gunzips, chmods, and
  saves the licence next to the binaries. About 60 MB of download; status shows `installing` while
  it runs and the install is single-flight.
- The managed release covers `win32-x64`, `linux-x64` and `darwin-arm64` (the platforms this app
  builds for). Other targets fall back to `auto`/`path`.
- `--ffmpeg-location` is passed only when the binary is an absolute path; a `PATH`-resolved ffmpeg
  is found by yt-dlp itself.
- Format selection is in `buildFormatSelector()`: with ffmpeg it asks for
  `bestvideo+bestaudio/best`, without it for a single-file `best[ext=mp4]/best`.
- Licensing: the managed build is a GPL ffmpeg build; the licence text is written beside it, and the
  app does not ship ffmpeg in the installer.

## Decision log

- **2026-11-05** — Placed in `hb-browser`; execution in main behind `/media/*`.
- **2026-11-05** — Runtime is Electron in Node mode; no Deno and no installer growth.
- **2026-11-05** — Pinned build-time binary with checksums; the runtime copy in `userData` is the
  only writable one. Fetchers fail closed.
- **2026-11-05** — `media info` only in the first slice: read-only and useful before downloads.
- **2026-11-05** — Download jobs: one at a time, 50-job persisted history, temp directory per job,
  cancel removes the directory, tree-kill so postprocessors cannot outlive a job.
- **2026-11-05** — Job status is polled (`media jobs`), not streamed: the bridge is request/response
  and a download outlives any single tool call.
- **2026-11-05** — Updater: launch + hourly by default, jittered, idle-only, checksum-verified,
  tagged asset URL, exponential backoff, rollback on a failed `--version`. Interval is an IPC-only
  setting.
- **2026-11-05** — Cookies: off by default with a `LOGIN_REQUIRED` result and a desktop notification;
  an always-on switch in Settings hands the browser session to every media request. Scoped to the
  requested host, one-run 0600 file, deleted after the call.
- **2026-11-05** — Output folder is a Settings picker with a per-job subfolder, so cancel stays
  local to one download.
- **2026-11-05** — ffmpeg is detect-or-configure-or-managed; the managed build is pinned to
  ffmpeg-static `b6.1.1` with per-asset SHA-256 and is not shipped in the installer.
- **Planned** — Hourly updater with jitter, idle gate and rollback; cookies opt-in; ffmpeg modes.
