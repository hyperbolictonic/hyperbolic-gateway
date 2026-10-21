# Building installers & auto-updates — scope

**Status:** scoping (2026-10-21) · **Related:** [`DECISION_MODELS.md`](./DECISION_MODELS.md), [`../CHANGELOG.md`](../CHANGELOG.md), [`../electron-builder.json`](../electron-builder.json)

This document covers three things that are easy to conflate: **producing** installers on each platform, **publishing**
them to GitHub Releases, and **updating** an installed copy from those releases. Today only the first is
configured, and only for Windows in practice.

---

## 1. Where we are

| piece | state |
| :--- | :--- |
| `win` targets (nsis, portable, zip, x64) | configured, **built and used** |
| `mac` targets (dmg, zip, x64 + arm64) | configured, **never built** |
| `linux` targets (AppImage, deb, tar.gz, x64) | configured, **never built** |
| icon | `public/assets/mark-eleven.png`, 1024×1024 — usable for `.icns`/`.ico` conversion |
| runtime platform branches | `host-fingerprint.ts` handles `darwin`/`linux`; `index.ts` has macOS window-all-closed |
| CI | only `pages.yml` — no build workflow |
| signing | none |
| auto-update | none |

### Blockers to fix before any non-Windows artefact is trustworthy

1. ~~**`electronDist` is pinned to the host**~~ — **fixed.** After the first CI run: the pin pointed at
   `node_modules/electron/dist`, which **does not exist on a pnpm checkout**, so packaging failed on Windows
   too. Removed; electron-builder now resolves/downloads the correct Electron for the target platform.
2. **Native deps are host-only.** Only `@lancedb/lancedb-win32-x64-msvc` is installed. A macOS/Linux package
   would ship without the `.node` binary and Cortex would crash on first use. Each platform must install
   its own (CI does this naturally; cross-building from Windows does not).
3. **macOS `dmg` cannot be built on Windows**, and `AppImage`/`deb` realistically need Linux (`fpm`).
   `build:dist:all` on one machine will not produce three platforms — it needs a CI matrix.
4. **Runtime is untested off Windows.** Specifically: Linux tray needs `libappindicator`; macOS tray icons
   want a template image for dark mode; CDP typing sends `windowsVirtualKeyCode` (Chromium also honours
   `key`/`text`, so it should work, but it is unverified); HIL "bring window to front" is Windows-centric.
5. **No signing.** Unsigned macOS builds are refused by Gatekeeper; Windows shows a SmartScreen warning.

---

## 2. Artefact matrix

| platform | artefacts | notes |
| :--- | :--- | :--- |
| Windows | `*-Setup-<ver>.exe` (NSIS, per-user, choose dir), `*-Portable-<ver>.exe`, `*.zip` | NSIS supports auto-update; **portable cannot self-update** (document it) |
| macOS | `*.dmg` (distribution), `*.zip` (required for updates) | x64 + arm64; universal is possible but doubles size |
| Linux | `*.AppImage` (auto-updatable), `*.deb`, `*.tar.gz` | only AppImage supports in-place updates |

Naming: keep `artifactName` explicit so the updater and humans agree — e.g.
`${productName}-${version}-${os}-${arch}.${ext}`.

---

## 3. CI: build matrix

One workflow, three runners, artefacts only (no publishing from the build job):

```yaml
name: build
on:
  workflow_dispatch:
  push:
    tags: ['v*']

jobs:
  guard:
    runs-on: ubuntu-latest
    outputs: { build: "${{ steps.check.outputs.build }}" }
    steps:
      - uses: actions/checkout@v4
      - id: check
        run: node scripts/check-release-tag.mjs "${{ github.ref_name }}"

  build:
    needs: guard
    # Four-part tags emit build=false → the matrix is skipped, not failed. Manual runs build.
    if: needs.guard.outputs.build == 'true'
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            platform: win
          - os: ubuntu-latest
            platform: linux
          - os: macos-latest
            platform: mac
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - name: Package
        run: pnpm exec electron-builder --${{ matrix.platform }} --publish never
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false      # unsigned by default; see §5
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.platform }}-artifacts
          path: |
            release/*.exe
            release/*.dmg
            release/*.zip
            release/*.AppImage
            release/*.deb
            release/*.tar.gz
            release/latest*.yml
```

Notes:

- `pnpm install --frozen-lockfile` is required — the repo uses pnpm (`pnpm-lock.yaml`), and **npm fails** on a
  `patch:` protocol in the dependency tree.
- `latest*.yml` files must be uploaded alongside the binaries: they are the update feed metadata
  (version, sha512, size, blockmap).
- Builds are slow (~8–12 min each); caching pnpm + Electron helps.
- Optional: a `lint`/`test` job first; the live MCP suites need the Electron app, so CI can only run the
  offline ones (`test:mcp:contract`, `test:harvest` offline parts, `tsc`).

---

## 4. Publishing to GitHub Releases

Two options; pick one and keep it consistent:

**A. electron-builder publishes** — `--publish always` with `GH_TOKEN`, and in `electron-builder.json`:

```json
"publish": [{ "provider": "github", "owner": "hyperbolictonic", "repo": "kuang-grade-mark-eleven", "releaseType": "release" }]
```

It creates/updates the release and uploads artefacts + `latest*.yml` in one step. Simple, but the release must
already exist or be created by it, and a partial failure leaves a half-published release.

**B. Build job uploads artefacts; a publish job assembles the release** (`gh release upload`) — more moving
parts, but you can review artefacts before they go live, and a failed platform doesn't block the others.

Recommendation: **B** for the first releases (reviewable), switch to **A** once the matrix is green twice.

---

## 5. Signing & notarisation

| platform | what is needed | without it |
| :--- | :--- | :--- |
| Windows | Authenticode cert (OV/EV), `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` (or Azure Trusted Signing) | SmartScreen warns; updates still work |
| macOS | **Developer ID Application** certificate (`.p12` + password → `CSC_LINK`/`CSC_KEY_PASSWORD`), plus notarisation credentials: `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` (or App Store Connect API key) | Gatekeeper blocks the app; Squirrel.Mac **refuses to apply updates to an unsigned app** |
| Linux | none | nothing — AppImage is self-contained |

### Decision: macOS ships **unsigned** first

The borrowed Developer ID is not available yet, so macOS starts unsigned (`mac.identity: null`,
`CSC_IDENTITY_AUTO_DISCOVERY: false`). Consequences, which must be stated wherever the DMG is offered:

- **Gatekeeper blocks the first launch.** The user has to right-click → **Open**, or run
  `xattr -dr com.apple.quarantine "/Applications/Kuang Grade Mark Eleven.app"`. Ship that line in the release
  notes next to the DMG; it is not optional polish, it is the difference between "works" and "is malware".
- **No notarisation**, so no hardened-runtime/entitlements work yet — it can wait for the cert.
- **macOS auto-update stays off** until the app is signed, because Squirrel.Mac will not install an update onto
  an unsigned bundle. Windows and Linux updates are unaffected.
- Ad-hoc signing (`codesign --sign -`) is **not** enough for distribution; it only helps some local Apple Silicon
  runs. Don't bother.

When the cert arrives: phase 4b below, no code changes beyond the credentials.

---

## 6. Auto-update from GitHub builds

Use **`electron-updater`** (6.x). It reads the `latest*.yml` feed that electron-builder writes and verifies each
download against the sha512 in that file.

```json
"publish": [{ "provider": "github", "owner": "hyperbolictonic", "repo": "kuang-grade-mark-leven" }]
```

```ts
// main: after app.whenReady()
import { autoUpdater } from 'electron-updater';
autoUpdater.autoDownload = true;          // Windows/Linux: download in background
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;      // stable channel
autoUpdater.on('update-available', (info) => hud.send('app:update-available', info.version));
autoUpdater.on('download-progress', (p) => hud.send('app:update-progress', Math.round(p.percent)));
autoUpdater.on('update-downloaded', () => hud.send('app:update-ready'));   // HUD offers "Restart"
app.whenReady().then(() => setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 30_000));
setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
```

Platform behaviour:

- **Windows (NSIS)** — full support, including delta updates via `.blockmap`; installs on quit or on demand.
- **macOS** — needs the `zip` (not just the DMG) **and a signed app**; Squirrel.Mac silently refuses otherwise.
  While macOS is unsigned, `autoUpdater` must be **skipped on darwin** (`process.platform === 'darwin' && !signed`
  → no check). Re-enable it in phase 4b.
- **Linux** — only **AppImage** updates itself (`APPIMAGE` env var must be set, which the AppImage runtime does);
  `deb`/`tar.gz` are manual upgrades.
- **Portable exe** — never self-updates. Say so in the README and the portable artefact description.

Operational notes:

- GitHub's CDN caches release assets aggressively; a rebuild under the *same* version can serve stale bytes.
  Never republish the same version with different content — bump instead.
- Staged rollout: `autoUpdater.stagingPercentage` (Windows/Linux) to ship to 10% first.
- A **public** repo needs no token for updates; a private one would need a token embedded in the app, which is
  a bad idea — keep the repo public or host the feed elsewhere.
- Add a `latest` vs `beta` channel switch later if needed (`autoUpdater.channel`); tags like `v1.5.0-beta.1`
  are picked up only when `allowPrerelease` is on.

---

## 7. Versioning vs updates — **the important interaction**

Our current policy allows a **fourth number in the tag** (`v1.4.2.1`) while `package.json`/`APP_VERSION` stay
three-part (`1.4.2`). That is fine for docs, and it is **incompatible with auto-update**:

- the updater compares the *app* version (`1.4.2`) against the feed, so `v1.4.2.1` and `v1.4.2.2` look identical;
- two releases with the same version cause "no update available" or an update loop;
- `latest.yml` would carry the same `version` for different binaries.

**Rule going forward:** four-part tags are **docs-only, never artefact releases**. Anything that ships an
installer must bump the three-part version (`1.4.3`, `1.4.4`, …). Tags that publish binaries must be
`v<package.json version>` exactly — add a CI check that fails if `v*` ≠ `package.json#version` for releases
with artefacts.

---

## 8. Phased plan

| phase | work | effort | risk |
| :--- | :--- | :--- | :--- |
| **1** | Remove/scope `electronDist`; add `release`-tag check; `.github/workflows/build.yml` (matrix, unsigned, artefacts only) | ~½ day | low — Windows path unchanged |
| **2** | Run the Linux + macOS jobs, fix runtime issues found (tray, native deps, key dispatch); publish Linux AppImage/deb unsigned | 1–2 days | medium — untested UI paths |
| **3** | Wire `electron-updater` + HUD prompts; publish Windows + Linux feeds (`latest.yml`, `latest-linux.yml`); test an update cycle with two consecutive versions | ~1 day | medium — needs two real releases |
| **4a** | macOS **unsigned**: build `dmg`/`zip`, publish with the Gatekeeper workaround in the release notes; **mac auto-update stays disabled** | ~½ day | low — but users must right-click → Open |
| **4b** | macOS signing + notarisation once the cert is borrowed; publish `latest-mac.yml`, enable mac updates, verify Squirrel.Mac applies one | ~1 day after the cert | external dependency, low code risk |
| **5** | Windows signing (OV cert or Azure Trusted Signing); staged rollout; optional beta channel | later | procurement |

---

## 9. What could bite

- **Native module mismatch** is the most likely first failure: the packaged app must contain the `.node` built for
  the target OS/arch (LanceDB ships per-platform packages; CI installs the right one automatically).
- **macOS notarisation** fails on hardened-runtime entitlements (JIT, unsigned memory) — Electron needs the usual
  set; test notarisation on a throwaway build before publishing.
- **AppImage + `asarUnpack`** for `**/*.node` and `**/@lancedb/**` is already handled, but confirm the unpacked
  tree exists in the AppImage (`squashfs-root/resources/app.asar.unpacked`).
- **GitHub asset limits**: 2 GiB per file; our artefacts are far below that, but a universal macOS build plus
  Chromium approaches ~200 MB.
- **Update feed and four-part tags** — see §7. This is the one that will silently break things if forgotten.
