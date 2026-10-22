import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserChassis } from './browser-chassis.js';
import { startHttpBridge } from './http-bridge.js';
import { attachContextMenu } from './menu/context-menu.js';
import { initUpdater, checkForUpdates, installUpdate, updaterState } from './updates/updater.js';
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

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
const chassis = new BrowserChassis();

const configuredPort = Number(process.env.KUANG_BRIDGE_PORT);
const bridgePort = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 4111;

/**
 * A stable path to the stdio MCP server for generated client configs.
 *
 * Installed builds copy the asar-unpacked file into userData: `resources/` is temporary for
 * portable and AppImage builds, so a config pointing inside it would break after the app exits.
 * The copy is refreshed whenever the bundled file is newer (i.e. after an update).
 */
let cachedMcpServerPath: string | null = null;
function ensureMcpServerPath(): string {
  if (cachedMcpServerPath) return cachedMcpServerPath;

  const devPath = path.join(app.getAppPath(), 'bin', 'mcp-server.cjs');
  if (!app.isPackaged) {
    cachedMcpServerPath = devPath;
    return devPath;
  }

  const source = path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'mcp-server.cjs');
  const target = path.join(app.getPath('userData'), 'bin', 'mcp-server.cjs');
  try {
    const sourceMtime = fs.statSync(source).mtimeMs;
    const targetMtime = fs.existsSync(target) ? fs.statSync(target).mtimeMs : 0;
    if (targetMtime < sourceMtime) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    cachedMcpServerPath = target;
  } catch {
    // Worst case, point at the bundled path: correct for installed (non-portable) builds.
    cachedMcpServerPath = source;
  }
  return cachedMcpServerPath;
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

ipcMain.handle('app:connect-info', () => {
  const serverPath = ensureMcpServerPath();
  return {
    platform: process.platform,
    version: APP_VERSION,
    bridgeUrl: `http://127.0.0.1:${bridgePort}`,
    bridgePort,
    serverPath,
    serverExists: fs.existsSync(serverPath),
    runtimePath: process.execPath,
    packaged: app.isPackaged,
    homedir: os.homedir(),
  };
});

onRecordingStatus((state) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recording:status', state);
  }
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Kuang Grade Mark Eleven // Cyberdeck',
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

  // Handle external navigation
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Start Autonomous HTTP Bridge
  try {
    startHttpBridge(chassis, bridgePort);
  } catch (err: any) {
    chassis.addLog('warn', `HTTP Bridge notice: ${err?.message || err}`);
  }
}

app.whenReady().then(createWindow);

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
