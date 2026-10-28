import { contextBridge, ipcRenderer } from 'electron';
import type { ChassisState, HarvestedConstruct, TelemetryEvent, TabSummary } from '../shared/types.js';
import type { RemoteStatus } from '../shared/remote.js';

export interface ElectronAPI {
  getState: () => Promise<ChassisState>;
  getLatestConstruct: () => Promise<HarvestedConstruct | null>;
  getLogs: () => Promise<any[]>;
  resumeAgent: () => Promise<{ ok: boolean; resumed?: boolean; error?: string }>;
  getHumanStatus: () => Promise<{ active: boolean; activeForMs: number; last: any }>;
  navigate: (url: string) => Promise<{ success: boolean }>;
  goBack: () => Promise<{ message: string }>;
  goForward: () => Promise<{ message: string }>;
  reload: () => Promise<{ message: string }>;
  getNavState: () => Promise<{ canGoBack: boolean; canGoForward: boolean }>;
  getInputProfile: () => Promise<{ mouseSpeedPxPerSec: number; typingWpm: number; clickDwellMs: number }>;
  saveInputProfile: (patch: {
    mouseSpeedPxPerSec?: number;
    typingWpm?: number;
    clickDwellMs?: number;
  }) => Promise<{
    ok: boolean;
    profile: { mouseSpeedPxPerSec: number; typingWpm: number; clickDwellMs: number };
    errors: string[];
  }>;
  harvest: () => Promise<HarvestedConstruct>;
  setViewportVisibility: (visible: boolean) => void;
  getSidebarMode: () => Promise<'docked' | 'floating' | 'collapsed'>;
  setSidebarMode: (mode: 'docked' | 'floating' | 'collapsed') => void;
  toggleSidebarMode: () => void;
  onSidebarMode: (callback: (mode: 'docked' | 'floating' | 'collapsed') => void) => () => void;
  getTabs: () => Promise<TabSummary[]>;
  createTab: (url?: string) => Promise<TabSummary>;
  switchTab: (tabId: string) => Promise<void>;
  closeTab: (tabId?: string) => Promise<void>;
  recallMemory: (query: string, options?: any) => Promise<any[]>;
  getHistory: (options?: any) => Promise<any[]>;
  clearHistory: (olderThan?: string) => Promise<{ success: boolean }>;
  suggestUrls: (query: string, options?: any) => Promise<any[]>;
  addBookmark: (bookmark: any) => Promise<any>;
  listBookmarks: (options?: any) => Promise<any[]>;
  deleteBookmark: (urlOrId: string) => Promise<boolean>;
  isBookmarked: (url: string) => Promise<boolean>;
  getDecisionSettings: () => Promise<{ stored: any; status: any }>;
  saveDecisionSettings: (config: any) => Promise<{ ok: boolean; status: any }>;
  testDecisionModel: () => Promise<any>;
  getDecisions: () => Promise<any[]>;
  copyToClipboard: (text: string) => Promise<{ ok: boolean }>;
  getUpdateStatus: () => Promise<any>;
  checkForUpdates: () => Promise<any>;
  installUpdate: () => Promise<boolean>;
  onUpdateStatus: (callback: (state: any) => void) => () => void;
  onDecision: (callback: (event: any) => void) => () => void;
  onDecisionStatus: (callback: (status: any) => void) => () => void;
  onTabsUpdated: (callback: (tabs: TabSummary[]) => void) => () => void;
  onStateUpdated: (callback: (state: ChassisState) => void) => () => void;
  onTelemetry: (callback: (event: TelemetryEvent) => void) => () => void;
  onConstructHarvested: (callback: (construct: HarvestedConstruct) => void) => () => void;
  onLog: (callback: (log: any) => void) => () => void;
  resolveHil: (id?: string, notes?: string) => Promise<boolean>;
  cancelHil: (id?: string) => Promise<boolean>;
  getActiveHil: () => Promise<any>;
  onHilRequested: (callback: (request: any) => void) => () => void;
  onHilCleared: (callback: () => void) => () => void;
  getRecordingConfig: () => Promise<any>;
  getConnectInfo: () => Promise<{
    platform: string;
    version: string;
    bridgeUrl: string;
    bridgePort: number;
    serverPath: string;
    serverExists: boolean;
    wrapServerPath: string;
    wrapServerExists: boolean;
    devlogsServerPath: string;
    devlogsServerExists: boolean;
    devlogsDir: string;
    devMode: boolean;
    wrapTokenFile: string;
    runtimePath: string;
    packaged: boolean;
    homedir: string;
  }>;
  saveRecordingConfig: (config: any) => Promise<any>;
  pickRecordingDir: () => Promise<string | null>;
  startRecording: (name?: string) => Promise<{ filename: string; config: any }>;
  stopRecording: () => Promise<any>;
  getRemoteInfo: () => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    token?: string;
    config?: string;
    tunnelHostname?: string;
    tunnelTokenConfigured?: boolean;
    oauthClient?: { clientId: string; clientSecret: string; createdAt: string };
    error?: string;
  }>;
  setRemoteEnabled: (enabled: boolean) => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    error?: string;
  }>;
  rotateRemoteToken: () => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    error?: string;
  }>;
  disconnectRemoteSessions: () => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    error?: string;
  }>;
  setRemoteTunnelEnabled: (enabled: boolean) => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    error?: string;
  }>;
  setRemoteTunnelConfig: (hostname: string, token?: string) => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    error?: string;
  }>;
  setCloudflaredMode: (mode: 'manual' | 'automatic') => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    error?: string;
  }>;
  checkCloudflared: () => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    error?: string;
  }>;
  installCloudflared: () => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    error?: string;
  }>;
  setRemoteAuthMode: (mode: 'bearer' | 'oauth') => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    error?: string;
  }>;
  rotateOAuthClient: () => Promise<{
    ok: boolean;
    status?: RemoteStatus;
    error?: string;
  }>;
  getRecordingStatus: () => Promise<any>;
  listRecordings: () => Promise<Array<{ path: string; filename: string; bytes: number; modified: number }>>;
  saveRecording: (buffer: ArrayBuffer, frames: number) => Promise<any>;
  recordingReady: () => void;
  recordingFailed: (message: string) => void;
  onRecordingBegin: (callback: (payload: any) => void) => () => void;
  onRecordingStop: (callback: () => void) => () => void;
  onRecordingStatus: (callback: (state: any) => void) => () => void;
  listWrapSecrets: () => Promise<{
    available: boolean;
    warning: string;
    secrets: Array<{
      name: string;
      allowedHosts: string[];
      header: string;
      prefix: string;
      createdAt: string;
      updatedAt: string;
      kind: 'static' | 'oauth2';
      oauth2?: { tokenUrl: string; clientId: string; scope?: string; audience?: string; tokenExpiresAt?: string };
    }>;
  }>;
  setWrapSecret: (input: {
    name: string;
    value: string;
    allowedHosts: string;
    header?: string;
    prefix?: string;
    kind?: 'static' | 'oauth2';
    tokenUrl?: string;
    clientId?: string;
    scope?: string;
    audience?: string;
  }) => Promise<{ ok: boolean; secret?: any; errors: string[] }>;
  deleteWrapSecret: (name: string) => Promise<{ ok: boolean; errors: string[] }>;
  listWrapAudit: (limit?: number) => Promise<any[]>;
  listWrapWrappers: () => Promise<any[]>;
  saveWrapWrapper: (wrapper: any) => Promise<{ ok: boolean; wrapper?: any; errors: string[] }>;
  deleteWrapWrapper: (id: string) => Promise<{ ok: boolean; errors: string[] }>;
  getResearchSettings: () => Promise<any>;
  saveResearchSettings: (settings: any) => Promise<{ ok: boolean; settings: any; errors: string[] }>;
  getShadowWalkSettings: () => Promise<any>;
  saveShadowWalkSettings: (settings: any) => Promise<{ ok: boolean; settings: any; errors: string[] }>;
  resetShadowWalkSettings: () => Promise<{ ok: boolean; settings: any; errors: string[] }>;
  detectShadowPatch: () => Promise<any>;
  resetResearchSession: () => Promise<{ ok: boolean; error?: string }>;
}

const api: ElectronAPI = {
  getState: () => ipcRenderer.invoke('chassis:get-state'),
  getLatestConstruct: () => ipcRenderer.invoke('chassis:get-latest-construct'),
  getLogs: () => ipcRenderer.invoke('chassis:get-logs'),
  resumeAgent: async () => {
    try {
      return { ok: true, ...(await ipcRenderer.invoke('chassis:resume-human')) };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  },
  getHumanStatus: () => ipcRenderer.invoke('chassis:get-human-status'),
  navigate: (url: string) => ipcRenderer.invoke('chassis:navigate', url),
  goBack: () => ipcRenderer.invoke('chassis:go-back'),
  goForward: () => ipcRenderer.invoke('chassis:go-forward'),
  reload: () => ipcRenderer.invoke('chassis:reload'),
  getNavState: () => ipcRenderer.invoke('chassis:get-nav-state'),
  getInputProfile: () => ipcRenderer.invoke('input:get-profile'),
  saveInputProfile: (patch) => ipcRenderer.invoke('input:save-profile', patch),
  harvest: () => ipcRenderer.invoke('chassis:harvest'),
  setViewportVisibility: (visible: boolean) => ipcRenderer.send('chassis:set-viewport-visibility', visible),
  getSidebarMode: () => ipcRenderer.invoke('chassis:get-sidebar-mode'),
  setSidebarMode: (mode) => ipcRenderer.send('chassis:set-sidebar-mode', mode),
  toggleSidebarMode: () => ipcRenderer.send('chassis:toggle-sidebar-mode'),
  onSidebarMode: (callback) => {
    const handler = (_: any, mode: 'docked' | 'floating' | 'collapsed') => callback(mode);
    ipcRenderer.on('chassis:sidebar-mode', handler);
    return () => ipcRenderer.removeListener('chassis:sidebar-mode', handler);
  },

  getTabs: () => ipcRenderer.invoke('chassis:get-tabs'),
  createTab: (url?: string) => ipcRenderer.invoke('chassis:create-tab', url),
  switchTab: (tabId: string) => ipcRenderer.invoke('chassis:switch-tab', tabId),
  closeTab: (tabId?: string) => ipcRenderer.invoke('chassis:close-tab', tabId),

  recallMemory: (query: string, options?: any) => ipcRenderer.invoke('cortex:recall', query, options),
  getHistory: (options?: any) => ipcRenderer.invoke('cortex:get-history', options),
  clearHistory: (olderThan?: string) => ipcRenderer.invoke('cortex:clear-history', olderThan),
  suggestUrls: (query: string, options?: any) => ipcRenderer.invoke('cortex:suggest-urls', query, options),
  addBookmark: (bookmark: any) => ipcRenderer.invoke('cortex:add-bookmark', bookmark),
  listBookmarks: (options?: any) => ipcRenderer.invoke('cortex:list-bookmarks', options),
  deleteBookmark: (urlOrId: string) => ipcRenderer.invoke('cortex:delete-bookmark', urlOrId),
  isBookmarked: (url: string) => ipcRenderer.invoke('cortex:is-bookmarked', url),

  getDecisionSettings: () => ipcRenderer.invoke('settings:get-decision'),
  saveDecisionSettings: (config: any) => ipcRenderer.invoke('settings:save-decision', config),
  testDecisionModel: () => ipcRenderer.invoke('settings:test-decision'),
  getDecisions: () => ipcRenderer.invoke('chassis:get-decisions'),
  copyToClipboard: (text: string) => ipcRenderer.invoke('app:copy-text', text),
  getUpdateStatus: () => ipcRenderer.invoke('app:update-status'),
  checkForUpdates: () => ipcRenderer.invoke('app:update-check'),
  installUpdate: () => ipcRenderer.invoke('app:update-install'),

  onUpdateStatus: (callback) => {
    const handler = (_: any, state: any) => callback(state);
    ipcRenderer.on('app:update-status', handler);
    return () => ipcRenderer.removeListener('app:update-status', handler);
  },

  onDecision: (callback) => {
    const handler = (_: any, event: any) => callback(event);
    ipcRenderer.on('chassis:decision', handler);
    return () => ipcRenderer.removeListener('chassis:decision', handler);
  },

  onDecisionStatus: (callback) => {
    const handler = (_: any, status: any) => callback(status);
    ipcRenderer.on('chassis:decision-status', handler);
    return () => ipcRenderer.removeListener('chassis:decision-status', handler);
  },

  onTabsUpdated: (callback) => {
    const handler = (_: any, tabs: TabSummary[]) => callback(tabs);
    ipcRenderer.on('chassis:tabs-updated', handler);
    return () => ipcRenderer.removeListener('chassis:tabs-updated', handler);
  },

  onStateUpdated: (callback) => {
    const handler = (_: any, state: ChassisState) => callback(state);
    ipcRenderer.on('chassis:state-updated', handler);
    return () => ipcRenderer.removeListener('chassis:state-updated', handler);
  },

  onTelemetry: (callback) => {
    const handler = (_: any, event: TelemetryEvent) => callback(event);
    ipcRenderer.on('chassis:telemetry', handler);
    return () => ipcRenderer.removeListener('chassis:telemetry', handler);
  },

  onConstructHarvested: (callback) => {
    const handler = (_: any, construct: HarvestedConstruct) => callback(construct);
    ipcRenderer.on('chassis:construct-harvested', handler);
    return () => ipcRenderer.removeListener('chassis:construct-harvested', handler);
  },

  onLog: (callback) => {
    const handler = (_: any, log: any) => callback(log);
    ipcRenderer.on('chassis:log', handler);
    return () => ipcRenderer.removeListener('chassis:log', handler);
  },

  resolveHil: (id?: string, notes?: string) => ipcRenderer.invoke('hil:resolve', { id, notes }),
  cancelHil: (id?: string) => ipcRenderer.invoke('hil:cancel', { id }),
  getActiveHil: () => ipcRenderer.invoke('hil:get-active'),

  onHilRequested: (callback) => {
    const handler = (_: any, req: any) => callback(req);
    ipcRenderer.on('hil:requested', handler);
    return () => ipcRenderer.removeListener('hil:requested', handler);
  },

  onHilCleared: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('hil:cleared', handler);
    return () => ipcRenderer.removeListener('hil:cleared', handler);
  },

  getRecordingConfig: () => ipcRenderer.invoke('recording:config:get'),
  getConnectInfo: () => ipcRenderer.invoke('app:connect-info'),
  getRemoteInfo: () => ipcRenderer.invoke('remote:info'),
  setRemoteEnabled: (enabled: boolean) => ipcRenderer.invoke('remote:set-enabled', enabled),
  rotateRemoteToken: () => ipcRenderer.invoke('remote:rotate-token'),
  disconnectRemoteSessions: () => ipcRenderer.invoke('remote:disconnect-sessions'),
  setRemoteTunnelEnabled: (enabled: boolean) => ipcRenderer.invoke('remote:set-tunnel-enabled', enabled),
  setRemoteTunnelConfig: (hostname: string, token?: string) => ipcRenderer.invoke('remote:set-tunnel-config', hostname, token),
  setCloudflaredMode: (mode: 'manual' | 'automatic') => ipcRenderer.invoke('remote:set-cloudflared-mode', mode),
  checkCloudflared: () => ipcRenderer.invoke('remote:check-cloudflared'),
  installCloudflared: () => ipcRenderer.invoke('remote:install-cloudflared'),
  setRemoteAuthMode: (mode: 'bearer' | 'oauth') => ipcRenderer.invoke('remote:set-auth-mode', mode),
  rotateOAuthClient: () => ipcRenderer.invoke('remote:rotate-oauth-client'),
  saveRecordingConfig: (config: any) => ipcRenderer.invoke('recording:config:save', config),
  pickRecordingDir: () => ipcRenderer.invoke('recording:pick-dir'),
  startRecording: (name?: string) => ipcRenderer.invoke('recording:start', name),
  stopRecording: () => ipcRenderer.invoke('recording:stop'),
  getRecordingStatus: () => ipcRenderer.invoke('recording:status'),
  listRecordings: () => ipcRenderer.invoke('recording:list'),
  saveRecording: (buffer: ArrayBuffer, frames: number) => ipcRenderer.invoke('recording:save', buffer, frames),
  recordingReady: () => ipcRenderer.send('recording:ready'),
  recordingFailed: (message: string) => ipcRenderer.send('recording:failed', message),

  onRecordingBegin: (callback) => {
    const handler = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('recording:begin', handler);
    return () => ipcRenderer.removeListener('recording:begin', handler);
  },

  onRecordingStop: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('recording:stop', handler);
    return () => ipcRenderer.removeListener('recording:stop', handler);
  },

  onRecordingStatus: (callback) => {
    const handler = (_: any, state: any) => callback(state);
    ipcRenderer.on('recording:status', handler);
    return () => ipcRenderer.removeListener('recording:status', handler);
  },

  listWrapSecrets: () => ipcRenderer.invoke('wrap:secrets:list'),
  setWrapSecret: (input: any) => ipcRenderer.invoke('wrap:secrets:set', input),
  deleteWrapSecret: (name: string) => ipcRenderer.invoke('wrap:secrets:delete', name),
  listWrapAudit: (limit?: number) => ipcRenderer.invoke('wrap:audit:list', limit),
  listWrapWrappers: () => ipcRenderer.invoke('wrap:wrappers:list'),
  saveWrapWrapper: (wrapper: any) => ipcRenderer.invoke('wrap:wrappers:save', wrapper),
  deleteWrapWrapper: (id: string) => ipcRenderer.invoke('wrap:wrappers:delete', id),
  getResearchSettings: () => ipcRenderer.invoke('research:settings:get'),
  saveResearchSettings: (settings: any) => ipcRenderer.invoke('research:settings:save', settings),
  getShadowWalkSettings: () => ipcRenderer.invoke('shadowwalk:settings:get'),
  saveShadowWalkSettings: (settings: any) => ipcRenderer.invoke('shadowwalk:settings:save', settings),
  resetShadowWalkSettings: () => ipcRenderer.invoke('shadowwalk:settings:reset'),
  detectShadowPatch: () => ipcRenderer.invoke('shadowwalk:detect'),
  resetResearchSession: () => ipcRenderer.invoke('research:session:reset'),
};

contextBridge.exposeInMainWorld('electronAPI', api);
