# Media download integration

**Status:** complete. `status`, `info`, `preview`, `transcript`, `download`, `jobs`, `cancel` and
`list` work end to end; the downloader updates itself; downloads can use the browser session;
ffmpeg can be detected, configured or installed; and the save folder is configurable. Cortex
indexing of transcripts is the obvious next step.

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

Full YouTube support needs an external JavaScript runtime. The app does not ship Deno; it hands the
downloader **its own binary in Node mode**:

```ts
env.ELECTRON_RUN_AS_NODE = '1';
args.push('--js-runtimes', `node:${process.execPath}`);
```

`process.execPath` reports `v24.21.0` on Electron 44.7.2 when that variable is set, which satisfies
the Node ≥ 22 requirement. Verified end to end: the same video returns 25 formats with the runtime
and 24 without it, and without it the downloader warns that some formats may be missing.

The runtime helper returns no runtime rather than guessing when it cannot prove Node ≥ 22. The app
then behaves like a plain downloader install.

## Binaries

`scripts/media-binaries.json` pins one downloader release and a SHA-256 per target.
`scripts/fetch-media.mjs` downloads the asset, verifies the hash, makes it executable, runs
`--version`, and **fails the build** on any problem. It never writes a placeholder: a build that
cannot fetch the binary is not releaseable.

```
bin/media/<platform>-<arch>/<downloader>        seed, shipped, asar-unpacked
<userData>/media/bin/<downloader>               working copy, writable, updated at runtime
```

The seed is read-only on macOS and on AppImage mounts, so the runnable copy lives in `userData`.
It is only refreshed from the seed when the seed is *newer* (an app update shipped a newer binary),
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
| `transcript` | shipped | Captions as text (paged), without downloading |
| `preview` | shipped | Metadata + transcript excerpt + poster image, without downloading |

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
  derived from percent × total, because the downloader prints the percentage rather than a running
  count.
- Format selection: without ffmpeg, a single-file MP4 or M4A; with it, merged `bestvideo+bestaudio`.
  `buildFormatSelector()` is the only place that decides, and a unit test pins it.

## Session cookies

Off by default. A site that needs a signed-in session returns `LOGIN_REQUIRED`, and the app shows a
desktop notification; a human then enables **Settings → Media → "Always use the browser session"**
and retries. Nothing an agent calls can turn it on.

- Scope: `session.cookies.get({ url })` for the requested URL, so the downloader receives what the
  browser would send to that host — not the whole jar.
- Lifecycle: written to `<userData>/media/.cookies/cookies-*.txt` with mode 0600, passed as
  `--cookies`, and deleted in a `finally` after the call or at job close/cancel.
- Never logged, never stored in job history, never returned by a tool.
- A cookie-store failure does not fail the request; it proceeds anonymously.
- Notifications are deduplicated to one per minute so a failing loop cannot spam the desktop.

## Previewing without downloading

`media preview` and `media transcript` run the downloader with `--skip-download`: they fetch the
caption track and the poster image, never the media.

- `preview` returns title/duration/uploader, a transcript excerpt, and the poster image. The MCP
  layer returns the image as an `image` content block, so a vision model can look at it.
  It is the intended first call before `media download`.
- `transcript` returns the whole caption text, paged with `max_chars`/`cursor`.
- A transcript is indexed into Cortex under the video URL, so `memory` → `recall` can answer from it
  later. Indexing runs once per URL + language per process; pass `index:false` to skip it.
- Language selection: an explicit `lang` wins; otherwise English when available, then the first
  manual track, then the first auto track.
- VTT is reduced to plain text (timings, cue settings, tags and NOTE blocks removed, consecutive
  auto-caption duplicates collapsed).
- Captions are cached in memory for ten minutes per URL + language, so a preview followed by a
  transcript fetch does not re-run the downloader.
- `automatic: true` marks machine captions; expect no punctuation and informal segmentation.
- When a video has no captions the preview still returns metadata and the thumbnail, with a
  `NO_TRANSCRIPT` warning rather than an error.

## Security

- **No flag passthrough.** Every argument is built in `service.ts`. A generic `flags` parameter
  would let an agent pass `--exec`, which is arbitrary command execution.
- `--ignore-config` on every invocation, so a config file cannot inject options.
- Input URLs go through `assertSafeUrl` (HTTPS, no credentials, no private addresses). Residual
  risk: the downloader follows redirects and manifest URLs internally; the check covers the entry
  point only.
- Cookies are **off by default**. When enabled they are scoped to the target host, written to a
  0600 temp file, passed with `--cookies`, and deleted in `finally`. Never logged, never stored.
- The updater downloads a binary and runs it. That is a remote-code-execution channel by design:
  stable channel only, checksum-verified, rollback on a failed `--version`, and a Settings switch
  plus `HB_MEDIA_AUTOUPDATE=0` to turn it off.

## Updates

The downloader is the one binary that must keep up with the sites it reads, so it updates at
runtime:

- A check runs shortly after launch (15 s + up to 2 min of jitter) and then every N minutes
  (default **60**, clamped 15–1440, set in Settings → Media).
- Each check is jittered ±10% so installs do not hit the release host together, and it is skipped
  while a download is running (retried in 2 minutes, not counted as a failure).
- A failed check backs off exponentially (2× per failure, capped at 24 h) and surfaces the error in
  Settings and `media status`.
- `HB_MEDIA_AUTOUPDATE=0` disables automatic checks for a run; the Settings button still works.
- The download URL comes from the release the API just returned, not from a floating latest URL, so
  a release published mid-check cannot install a different version than the one being reported.
- The asset is checked against the release's published checksums before it is written, then swapped
  in with a `.backup`, run with `--version`, and rolled back if it cannot execute.
- Settings are written over IPC only, per the house rule; no bridge route changes them.

## Output folder

Settings → Media has a save-folder picker. Empty means `<userData>/media`; any absolute path is
accepted. Every job still gets its own `<jobId>` subfolder under it, so cancelling a job removes
only its own partial output, never another download. A folder that cannot be created fails the job
with `OUTPUT_DIR` instead of leaving it queued.

## ffmpeg

Needed for merging separate video and audio streams, for transcoding, and for audio extraction to
an arbitrary codec. Without it the downloader still fetches a single-file MP4 and an audio-only
stream; `media status` reports `merge`/`transcode` accordingly.

Three modes, saved in Settings → Media:

| Mode | Resolution order |
| --- | --- |
| `auto` (default) | configured path → managed copy → `ffmpeg` on `PATH` |
| `path` | the configured binary only; no silent fallback |
| `managed` | the copy downloaded into `<userData>/media/bin/ffmpeg` only |

- `path` mode is deliberate: if the path is wrong, downloads report no ffmpeg rather than quietly
  using a different build.
- **Managed install** downloads `ffmpeg` + `ffprobe` for the host platform from a pinned build,
  verifies a SHA-256 per asset, gunzips, chmods, and saves the licence next to the binaries. About
  60 MB of download; status shows `installing` while it runs and the install is single-flight.
- The managed release covers `win32-x64`, `linux-x64` and `darwin-arm64` (the platforms this app
  builds for). Other targets fall back to `auto`/`path`.
- `--ffmpeg-location` is passed only when the binary is an absolute path; a `PATH`-resolved ffmpeg
  is found by the downloader itself.
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
- **2026-11-05** — ffmpeg is detect-or-configure-or-managed; the managed build is pinned with
  per-asset SHA-256 and is not shipped in the installer.
- **2026-11-05** — Preview is a first-class step: `preview` and `transcript` use `--skip-download`,
  and the poster image travels as MCP image content so the agent can look before committing.
