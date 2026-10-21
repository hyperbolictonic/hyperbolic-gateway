import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BrowserChassis } from './browser-chassis.js';
import { startHttpBridge } from './http-bridge.js';
import { attachContextMenu } from './menu/context-menu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
const chassis = new BrowserChassis();

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

  // The shell (HUD) has its own context menu: without it, right-click copy/paste/inspect does
  // nothing anywhere outside a browsing tab. Inspection targets the shell's own renderer.
  attachContextMenu(mainWindow.webContents, {
    window: mainWindow,
    onLog: (level, message) => console.log(`[HUD context menu] ${level}: ${message}`),
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
    startHttpBridge(chassis);
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
