import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserChassis } from './browser-chassis.js';
import { startHttpBridge } from './http-bridge.js';
import { WrapExecutor } from './wrap/executor.js';
import { WrapStore } from './wrap/store.js';
import { createWrapToken, tokenFile } from './wrap/token.js';
import { SecretStore } from './wrap/secrets.js';
import type { SecretCipher } from './wrap/secrets.js';
import { WrapAuditLog } from './wrap/audit.js';
import { ResearchSettingsStore } from './research/settings.js';
import { DEFAULT_SHADOW_WALK_SETTINGS, loadShadowWalkSettings, saveShadowWalkSettings } from './shadow-walk/settings.js';
import { attachContextMenu } from './menu/context-menu.js';
import type { WebPageState } from '../shared/web-state.js';
import { initUpdater, checkForUpdates, installUpdate, updaterState } from './updates/updater.js';
import { RemoteService } from './remote/service.js';
import { ToolSettingsStore } from './tools/settings.js';
import { registerToolSettingsIpc } from './tools/ipc.js';
import { CollaborationStore } from './collaboration/store.js';
import { CollaborationService } from './collaboration/service.js';
import { ExperimentalSettingsStore } from './settings/experimental.js';
import { dataPath } from './data-paths.js';
import { APP_VERSION } from '../shared/version.js';
import {
  failRecording,
  getRecordingConfig,
  getRecordingStatus,
  listRecordings,
  loadRecordingConfig,
  onRecordingStatus,
  pickRecordingDir,
  readyRecording,
  saveRecording,
  saveRecordingConfig,
  setRecordingWindow,
  startRecording,
  stopRecording,
} from './recording/recording-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A dev run is usually launched from a terminal that can close (or be killed) underneath it.
 * When that pipe breaks, every later console.log throws EPIPE and the app dies with a stack trace
 * that has nothing to do with the page it was driving. A broken console is not an application
 * error: swallow EPIPE/ERR_STREAM_DESTROYED and keep working.
 */
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED' || err?.code === 'ECONNRESET') return;
    // Anything else is unusual but still must not take the browser process down.
  });
}

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
const chassis = new BrowserChassis();

const configuredPort = Number(process.env.HB_BRIDGE_PORT ?? process.env.KUANG_BRIDGE_PORT);
const bridgePort = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 4111;
const configuredRemotePort = Number(process.env.HB_REMOTE_PORT);
const remotePort =
  Number.isInteger(configuredRemotePort) && configuredRemotePort > 0 && configuredRemotePort <= 65_535
    ? configuredRemotePort
    : bridgePort + 1;

/**
 * A stable path to the stdio MCP server for generated client configs.
 *
 * Installed builds copy the asar-unpacked file into userData: `resources/` is temporary for
 * portable and AppImage builds, so a config pointing inside it would break after the app exits.
 * The copy is refreshed whenever the bundled file is newer (i.e. after an update).
 */
const cachedServerPaths = new Map<string, string>();
function ensureBundledServerPath(filename: string): string {
  const cached = cachedServerPaths.get(filename);
  if (cached) return cached;

  const devPath = path.join(app.getAppPath(), 'bin', filename);
  if (!app.isPackaged) {
    cachedServerPaths.set(filename, devPath);
    return devPath;
  }

  const source = path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', filename);
  const target = path.join(app.getPath('userData'), 'bin', filename);
  let resolved = source;
  try {
    const sourceMtime = fs.statSync(source).mtimeMs;
    const targetMtime = fs.existsSync(target) ? fs.statSync(target).mtimeMs : 0;
    if (targetMtime < sourceMtime) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    resolved = target;
  } catch {
    // Worst case, point at the bundled path: correct for installed (non-portable) builds.
  }
  cachedServerPaths.set(filename, resolved);
  return resolved;
}

function ensureMcpServerPath(): string {
  return ensureBundledServerPath('mcp-server.cjs');
}

function ensureWrapServerPath(): string {
  return ensureBundledServerPath('wrap-server.cjs');
}

function ensureRemoteServerPath(): string {
  return ensureBundledServerPath('remote-server.cjs');
}

function ensureDevlogsServerPath(): string {
  return ensureBundledServerPath('devlogs-server.cjs');
}

function wrapDir(): string {
  return path.join(app.getPath('userData'), 'wrap');
}

function remoteDir(): string {
  return path.join(app.getPath('userData'), 'remote');
}

let activeResearchSettings: ResearchSettingsStore | null = null;
let activeWrapStore: WrapStore | null = null;
let activeWrapSecrets: SecretStore | null = null;
let activeWrapAudit: WrapAuditLog | null = null;
let activeRemoteService: RemoteService | null = null;
let activeCollaborationService: CollaborationService | null = null;

function createSecretCipher(): SecretCipher {
  let available = false;
  let warning = '';
  try {
    available = safeStorage.isEncryptionAvailable();
    const backend =
      process.platform === 'linux' ? String((safeStorage as any).getSelectedStorageBackend?.() || '') : '';
    if (backend === 'basic_text') {
      available = false;
      warning =
        'The Linux keyring is reporting basic_text, which is not encryption. Install a keyring (GNOME Keyring or KWallet) and restart to enable secrets.';
    } else if (!available) {
      warning = 'OS-backed encryption is unavailable in this session, so secrets are disabled.';
    }
  } catch (err: any) {
    warning = `OS-backed encryption is unavailable: ${err?.message || err}`;
  }

  return {
    available: () => available,
    warning,
    encrypt: (value: string) => safeStorage.encryptString(value).toString('base64'),
    decrypt: (payload: string) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
  };
}

// The Cyberdeck is driven while the human's editor/terminal owns the foreground, so the
// window is routinely *occluded*. Chromium then stops producing frames for it, which
// silently breaks anything driven by rendering: scroll events never fire (so lazy-loading
// "infinite" feeds never append), IntersectionObserver callbacks never run, and rAF-based
// hydration stalls. Disable occlusion/renderer backgrounding so a driving agent sees the
// same page a foregrounded human would.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

app.on('second-instance', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

// ---- recording IPC (registered once, not per window) --------------------------------------
ipcMain.handle('recording:config:get', () => getRecordingConfig());
ipcMain.handle('recording:config:save', (_event, config: any) => saveRecordingConfig(config || {}));
ipcMain.handle('recording:pick-dir', () => pickRecordingDir());
ipcMain.handle('recording:start', (_event, name?: string) => startRecording(typeof name === 'string' ? name : undefined));
ipcMain.handle('recording:stop', () => stopRecording());
ipcMain.handle('recording:status', () => getRecordingStatus());
ipcMain.handle('recording:list', () => listRecordings());
ipcMain.handle('recording:save', (_event, buffer: ArrayBuffer, frames: number) => saveRecording(buffer, Number(frames) || 0));
ipcMain.on('recording:ready', () => readyRecording());
ipcMain.on('recording:failed', (_event, message: string) => failRecording(String(message || 'Recording failed.')));

// Hyperbolic Rest secrets are written only here, from the Settings renderer. No
// bridge route or MCP tool can create, read, or bind a credential value.
ipcMain.handle('wrap:secrets:list', () => {
  if (!activeWrapSecrets) {
    return { available: false, warning: 'Hyperbolic Rest is not ready yet.', secrets: [] };
  }
  return {
    available: activeWrapSecrets.available(),
    warning: activeWrapSecrets.warning(),
    secrets: activeWrapSecrets.list(),
  };
});

ipcMain.handle('wrap:secrets:set', (_event, input: any) => {
  if (!activeWrapSecrets) return { ok: false, errors: ['Hyperbolic Rest is not ready yet.'] };
  return activeWrapSecrets.set(input || {});
});

ipcMain.handle('wrap:secrets:delete', (_event, name: string) => {
  if (!activeWrapSecrets) return { ok: false, errors: ['Hyperbolic Rest is not ready yet.'] };
  const deleted = activeWrapSecrets.delete(String(name || ''));
  return deleted ? { ok: true, errors: [] } : { ok: false, errors: [`No secret named "${name || ''}".`] };
});

ipcMain.handle('wrap:audit:list', (_event, limit?: number) => {
  return activeWrapAudit ? activeWrapAudit.list(Number(limit) || 50) : [];
});

// Research / stealth settings. These affect search_web, deep_crawl, and
// research_topic; proxy/session changes stay in main.
ipcMain.handle('research:settings:get', () => {
  return activeResearchSettings
    ? activeResearchSettings.load()
    : { schemaVersion: 1, enabled: false, engineChain: [], urlTemplate: '', proxyUrl: '', domainCooldownSec: 300, delayMs: 1000, activateView: true };
});

ipcMain.handle('research:settings:save', async (_event, settings: any) => {
  if (!activeResearchSettings) return { ok: false, settings: null, errors: ['Research settings are not ready yet.'] };
  const result = activeResearchSettings.save(settings);
  if (result.ok) await chassis.setResearchSettings(result.settings);
  return result;
});

// Shadow Walk settings: written over IPC only, read by the bridge on every guarded call.
ipcMain.handle('shadowwalk:settings:get', () => loadShadowWalkSettings());
ipcMain.handle('shadowwalk:settings:save', async (_event, settings: any) => {
  const result = saveShadowWalkSettings(settings);
  if (result.ok) await chassis.applyShadowWalkSettings();
  return result;
});
ipcMain.handle('shadowwalk:settings:reset', async () => {
  const result = saveShadowWalkSettings(DEFAULT_SHADOW_WALK_SETTINGS);
  if (result.ok) await chassis.applyShadowWalkSettings();
  return result;
});
ipcMain.handle('shadowwalk:detect', () => chassis.detectShadowPatch());

ipcMain.handle('research:session:reset', async () => {
  try {
    await chassis.resetResearchSession();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

// Wrapper editing from Settings. The store validates and normalises every
// save; the bridge and MCP use the same files.
ipcMain.handle('wrap:wrappers:list', () => {
  return activeWrapStore ? activeWrapStore.list() : [];
});

ipcMain.handle('wrap:wrappers:save', (_event, wrapper: any) => {
  if (!activeWrapStore) return { ok: false, errors: ['Hyperbolic Rest is not ready yet.'] };
  const id = typeof wrapper?.id === 'string' ? wrapper.id : '';
  const exists = Boolean(id && activeWrapStore.get(id));
  return exists ? activeWrapStore.update(wrapper) : activeWrapStore.create(wrapper);
});

ipcMain.handle('wrap:wrappers:delete', (_event, id: string) => {
  if (!activeWrapStore) return { ok: false, errors: ['Hyperbolic Rest is not ready yet.'] };
  const wrapperId = String(id || '');
  const deleted = activeWrapStore.delete(wrapperId);
  return deleted ? { ok: true, errors: [] } : { ok: false, errors: [`No wrapper named "${wrapperId}".`] };
});

ipcMain.handle('app:connect-info', () => {
  const serverPath = ensureMcpServerPath();
  const wrapServerPath = ensureWrapServerPath();
  const devlogsServerPath = ensureDevlogsServerPath();
  return {
    platform: process.platform,
    version: APP_VERSION,
    bridgeUrl: `http://127.0.0.1:${bridgePort}`,
    bridgePort,
    serverPath,
    serverExists: fs.existsSync(serverPath),
    wrapServerPath,
    wrapServerExists: fs.existsSync(wrapServerPath),
    devlogsServerPath,
    devlogsServerExists: fs.existsSync(devlogsServerPath),
    devlogsDir: dataPath('logs'),
    devMode: !app.isPackaged,
    wrapTokenFile: tokenFile(wrapDir()),
    runtimePath: process.execPath,
    packaged: app.isPackaged,
    homedir: os.homedir(),
  };
});

function remoteFailure(message: string) {
  return { ok: false, error: message };
}

/** Experimental feature flags (Settings → Experimental). Persisted; default off. */
let experimentalStore: ExperimentalSettingsStore | null = null;
function experimentalSettings(): ExperimentalSettingsStore {
  experimentalStore ??= new ExperimentalSettingsStore(path.join(app.getPath('userData'), 'experimental.json'));
  return experimentalStore;
}

ipcMain.handle('settings:get-experimental', () => ({ ok: true, settings: experimentalSettings().get() }));
ipcMain.handle('settings:save-experimental', (_event, patch: unknown) => {
  const settings = experimentalSettings().savePatch(patch);
  chassis.broadcast('experimental:settings', settings);
  // Turning the gate off must also leave collab mode and drop page highlights.
  if (!settings.collab) {
    chassis.setCollabMode(false);
    void activeCollaborationService?.refreshOverlay();
  }
  return { ok: true, settings };
});

ipcMain.handle('collaboration:list', (_event, filter?: any) => {
  if (!activeCollaborationService) return { ok: false, threads: [], error: 'Collaboration is not ready yet.' };
  try {
    return { ok: true, threads: activeCollaborationService.list(filter || {}) };
  } catch (error: any) {
    return { ok: false, threads: [], error: error?.message || String(error) };
  }
});

ipcMain.handle('collaboration:start-picker', async () => {
  try {
    const target = await chassis.pickCollaborationTarget();
    return { ok: true, target };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
});

/** Page signals for the Command Deck WEB STATE tab (breadcrumb, cookies, storage). */
ipcMain.handle('chassis:web-state', async () => {
  try {
    const wc = chassis.getActiveWebContents();
    const page = await wc.executeJavaScript(
      '(() => { ' +
      'const crumbs = (location.pathname || "").split("/").filter(Boolean);' +
      'const ls = {}; const ss = {};' +
      'try { for (let i = 0; i < localStorage.length && i < 50; i++) { const k = localStorage.key(i); ls[k] = (localStorage.getItem(k) || "").slice(0, 120); } } catch {}' +
      'try { for (let i = 0; i < sessionStorage.length && i < 50; i++) { const k = sessionStorage.key(i); ss[k] = (sessionStorage.getItem(k) || "").slice(0, 120); } } catch {}' +
      'return JSON.stringify({ url: location.href, host: location.host, title: document.title, crumbs: crumbs, ls: ls, ss: ss });' +
      '})()',
      ).then((raw: string) => JSON.parse(raw));
    let cookies: WebPageState['cookies'] = [];
    try {
      cookies = (await wc.session.cookies.get({ url: String(page?.url ?? '') }))
        .slice(0, 40)
        .map((cookie) => ({ name: cookie.name, domain: cookie.domain || '', httpOnly: Boolean(cookie.httpOnly) }));
    } catch {
      cookies = [];
    }
    const state: WebPageState = {
      url: String(page?.url ?? ''),
      host: String(page?.host ?? ''),
      title: String(page?.title ?? ''),
      crumbs: Array.isArray(page?.crumbs) ? page.crumbs.map(String) : [],
      cookies,
      local: page?.ls ?? {},
      session: page?.ss ?? {},
    };
    return { ok: true, state };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('remote:info', () => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, ...activeRemoteService.getInfo() };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

ipcMain.handle('remote:set-enabled', async (_event, enabled: boolean) => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, status: await activeRemoteService.setEnabled(Boolean(enabled)) };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

ipcMain.handle('remote:rotate-token', async () => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, status: await activeRemoteService.rotateToken() };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

ipcMain.handle('remote:disconnect-sessions', async () => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, status: await activeRemoteService.disconnectSessions() };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

ipcMain.handle('remote:set-tunnel-enabled', async (_event, enabled: boolean) => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, status: await activeRemoteService.setTunnelEnabled(Boolean(enabled)) };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

ipcMain.handle('remote:set-tunnel-config', async (_event, hostname: string, token?: string) => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, status: await activeRemoteService.setTunnelConfig(String(hostname || ''), token ? String(token) : undefined) };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

ipcMain.handle('remote:set-cloudflared-mode', async (_event, mode: 'manual' | 'automatic') => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, status: await activeRemoteService.setCloudflaredUpdateMode(mode) };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

ipcMain.handle('remote:check-cloudflared', async () => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, status: await activeRemoteService.checkCloudflared() };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

ipcMain.handle('remote:install-cloudflared', async () => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, status: await activeRemoteService.installCloudflared() };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

ipcMain.handle('remote:set-auth-mode', async (_event, mode: 'bearer' | 'oauth') => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, status: await activeRemoteService.setAuthMode(mode) };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

ipcMain.handle('remote:rotate-oauth-client', async () => {
  if (!activeRemoteService) return remoteFailure('Remote access is not ready yet.');
  try {
    return { ok: true, status: await activeRemoteService.rotateOAuthClient() };
  } catch (err: any) {
    return remoteFailure(err?.message || String(err));
  }
});

onRecordingStatus((state) => {
  chassis.broadcast('recording:status', state);
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Hyperbolic Gateway // Cyberdeck',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#18181b',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  chassis.setWindow(mainWindow);
  setRecordingWindow(mainWindow);
  loadRecordingConfig();

  // The shell (HUD) has its own context menu: without it, right-click copy/paste/inspect does
  // nothing anywhere outside a browsing tab. Inspection targets the shell's own renderer.
  attachContextMenu(mainWindow.webContents, {
    window: mainWindow,
    onLog: (level, message) => console.log(`[HUD context menu] ${level}: ${message}`),
  });

  // ---- updates (optional, packaged builds only) -------------------------------------------
  ipcMain.handle('app:update-status', () => updaterState());
  ipcMain.handle('app:update-check', () => checkForUpdates());
  ipcMain.handle('app:update-install', () => installUpdate());
  void initUpdater((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update-status', state);
    }
  });

  // Dev server or production bundle
  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.show();
  mainWindow.focus();

  // Apply the persisted Shadow Walk policy (including a force-open kill-switch override) to the
  // initial tab. Current documents are untouched; the patch lands on the next navigation.
  void chassis.applyShadowWalkSettings();

  // Warm Cortex so the first URL-bar suggestion does not pay table initialization on a keystroke.
  void chassis.getCortex().initialize().catch(() => undefined);

  // Handle external navigation
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Start Autonomous HTTP Bridge
  try {
    activeResearchSettings = new ResearchSettingsStore(path.join(app.getPath('userData'), 'research-settings.json'));
    await chassis.setResearchSettings(activeResearchSettings.load());

    const wrapStore = new WrapStore(wrapDir());
    activeWrapStore = wrapStore;
    const wrapSecrets = new SecretStore(wrapDir(), createSecretCipher());
    const wrapAudit = new WrapAuditLog(path.join(wrapDir(), 'audit.jsonl'));
    activeWrapSecrets = wrapSecrets;
    activeWrapAudit = wrapAudit;
    const wrapExecutor = new WrapExecutor(wrapStore, {
      secrets: wrapSecrets,
      audit: wrapAudit,
      // Opt-in per recipe (`response.index: "cortex"`). Chunks land in the same
      // page_history table as browsed pages, so `recall_memory` finds them.
      indexDocuments: async (documents, context) => {
        const cortex = chassis.getCortex();
        let chunks = 0;
        for (const document of documents) {
          chunks += await cortex.indexPage(context.url, document.title, document.markdown);
        }
        return chunks;
      },
    });
    const wrapToken = createWrapToken(wrapDir());
    const toolSettings = new ToolSettingsStore(path.join(app.getPath('userData'), 'tool-settings.json'));
    registerToolSettingsIpc(toolSettings);
    const collaboration = new CollaborationService(
      new CollaborationStore(path.join(app.getPath('userData'), 'collaboration.json')),
      chassis,
      () => chassis.broadcast('collaboration:updated'),
      () => experimentalSettings().get().collab,
    );
    activeCollaborationService = collaboration;
    chassis.setCollabEnabledProvider(() => experimentalSettings().get().collab);
    // The deck toolbar's list + note cycling read exactly what the page overlay shows.
    chassis.setCollaborationThreadsProvider((filter) => collaboration.list(filter));
    chassis.setCollaborationOverlayRefresher(() => collaboration.refreshOverlay());
    chassis.setCollaborationResolver((id) => collaboration.resolve(id, 'Resolved from the collab note list.'));
    chassis.setCollaborationClassListener((target, added, removed) => {
      try {
        activeCollaborationService?.recordClassEdit(target, added, removed);
      } catch {
        // Class-edit bookkeeping is best-effort; the page already applied it.
      }
    });
    chassis.setOnCollaborationNote((note) => {
      try {
        activeCollaborationService?.create({
          target: note.target,
          text: note.text,
          tags: note.tags,
          kind: 'comment',
          author: 'human',
        });
      } catch {
        // The page drawer is best-effort; the persisted thread is authoritative.
      }
    });
    startHttpBridge(
      chassis,
      bridgePort,
      {
        store: wrapStore,
        executor: wrapExecutor,
        secrets: wrapSecrets,
        audit: wrapAudit,
        token: wrapToken,
      },
      toolSettings,
      collaboration
    );

    if (!activeRemoteService) {
      activeRemoteService = new RemoteService({
        serverPath: ensureRemoteServerPath(),
        bridgeUrl: `http://127.0.0.1:${bridgePort}`,
        port: remotePort,
        dataDir: remoteDir(),
        cwd: app.getPath('userData'),
        cloudflaredPath: process.env.HB_CLOUDFLARED_PATH,
      });
      activeRemoteService.ensureToken();
      void activeRemoteService.maybeAutoUpdateCloudflared();
    }
  } catch (err: any) {
    chassis.addLog('warn', `HTTP Bridge notice: ${err?.message || err}`);
  }
}

app.whenReady().then(createWindow);

let remoteShutdownStarted = false;
app.on('before-quit', (event) => {
  if (!activeRemoteService || !activeRemoteService.isRunning() || remoteShutdownStarted) return;
  event.preventDefault();
  remoteShutdownStarted = true;
  void activeRemoteService.stop().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
