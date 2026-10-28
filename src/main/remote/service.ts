import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRemoteToken, readRemoteToken, remoteTokenFile } from './token.ts';
import { findCloudflared } from './cloudflared.ts';
import { ensureOAuthClient, oauthClientFile, createOAuthClient } from './oauth-client.ts';
import type { OAuthClientCredentials } from './oauth-client.ts';
import { CloudflaredManager } from '../../../packages/cloudflared/src/index.ts';
import type { CloudflaredCheck, CloudflaredUpdateMode } from '../../../packages/cloudflared/src/index.ts';
import { CloudflaredTunnel } from '../../../packages/cloudflared-tunnel/src/index.ts';
import { loadRemoteSettings, saveRemoteSettings } from './settings.ts';
import type { RemoteInfo, RemoteStatus, RemoteTunnelStatus, RemoteCloudflaredStatus } from '../../shared/remote.js';

export interface RemoteServiceOptions {
  serverPath: string;
  bridgeUrl: string;
  port: number;
  dataDir: string;
  cwd: string;
  runtimePath?: string;
  logFile?: string;
  cloudflaredPath?: string;
  tunnelArgsPrefix?: string[];
}

const START_TIMEOUT_MS = 8000;
const STOP_TIMEOUT_MS = 3000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Owns the app-level remote MCP gateway process.
 *
 * The service is deliberately independent of Electron: the app injects paths
 * and the bridge URL. It never exposes a non-loopback listener and never
 * proxies the raw bridge.
 */
export class RemoteService {
  private child: ChildProcess | null = null;
  private tunnel: CloudflaredTunnel | null = null;
  private enabled = false;
  private tunnelEnabled = false;
  private tunnelError: string | undefined;
  private lastError = '';
  private readonly options: RemoteServiceOptions;
  private readonly tokenPath: string;
  private readonly logFile: string;
  private readonly tunnelLogFile: string;
  private readonly tunnelTokenPath: string;
  private tunnelHostname: string;
  private readonly cloudflared: CloudflaredManager;
  private readonly settingsPath: string;
  private readonly oauthClientPath: string;
  private updateMode: CloudflaredUpdateMode;
  private authMode: 'bearer' | 'oauth';
  private lastCloudflaredCheck: CloudflaredCheck | undefined;
  private cloudflaredError: string | undefined;

  constructor(options: RemoteServiceOptions) {
    this.options = options;
    this.tokenPath = remoteTokenFile(options.dataDir);
    this.logFile = options.logFile || path.join(options.dataDir, 'remote-server.log');
    this.tunnelLogFile = path.join(options.dataDir, 'named-tunnel.log');
    this.tunnelTokenPath = path.join(options.dataDir, 'tunnel-token');
    this.cloudflared = new CloudflaredManager({ dataDir: options.dataDir });
    this.settingsPath = path.join(options.dataDir, 'settings.json');
    this.oauthClientPath = oauthClientFile(options.dataDir);
    const settings = loadRemoteSettings(this.settingsPath);
    this.updateMode = settings.cloudflaredUpdateMode;
    this.authMode = settings.authMode;
    this.tunnelHostname = settings.tunnelHostname;
  }

  ensureToken(): string {
    const existing = readRemoteToken(this.tokenPath);
    if (existing) return existing;
    fs.mkdirSync(this.options.dataDir, { recursive: true });
    return createRemoteToken(this.options.dataDir);
  }

  getToken(): string {
    return this.ensureToken();
  }

  getInfo(): RemoteInfo {
    return {
      status: this.status(),
      token: this.getToken(),
      config: this.getConfig(),
      tunnelHostname: this.tunnelHostname,
      tunnelTokenConfigured: Boolean(this.readTunnelToken()),
      ...(this.authMode === 'oauth' ? { oauthClient: this.getOAuthClient() } : {}),
    };
  }

  getConfig(): string {
    return JSON.stringify(
      {
        mcpServers: {
          'hyperbolic-browser': {
            httpUrl: this.publicUrl(),
            headers: { Authorization: `Bearer ${this.getToken()}` },
          },
        },
      },
      null,
      2,
    );
  }

  status(): RemoteStatus {
    return {
      enabled: this.enabled,
      running: Boolean(this.child),
      port: this.options.port,
      localUrl: this.localUrl(),
      url: this.publicUrl(),
      tokenFile: this.tokenPath,
      authMode: this.authMode,
      tunnel: this.tunnelStatus(),
      cloudflared: this.cloudflaredStatus(),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  isRunning(): boolean {
    return Boolean(this.child);
  }

  async setCloudflaredUpdateMode(mode: CloudflaredUpdateMode): Promise<RemoteStatus> {
    this.updateMode = mode === 'automatic' ? 'automatic' : 'manual';
    this.saveSettings();
    return this.status();
  }

  getOAuthClient(): OAuthClientCredentials {
    return ensureOAuthClient(this.oauthClientPath);
  }

  async setAuthMode(mode: 'bearer' | 'oauth'): Promise<RemoteStatus> {
    const next = mode === 'oauth' ? 'oauth' : 'bearer';
    if (next === this.authMode) return this.status();
    const wasRunning = Boolean(this.child);
    if (wasRunning) await this.stopChild();
    this.authMode = next;
    if (next === 'oauth') ensureOAuthClient(this.oauthClientPath);
    this.saveSettings();
    if (wasRunning) {
      this.enabled = true;
      try {
        await this.startChild();
      } catch (error) {
        this.enabled = false;
        throw error;
      }
    }
    return this.status();
  }

  async rotateOAuthClient(): Promise<RemoteStatus> {
    const wasRunning = Boolean(this.child);
    if (wasRunning) await this.stopChild();
    createOAuthClient(this.oauthClientPath);
    if (wasRunning) {
      this.enabled = true;
      try {
        await this.startChild();
      } catch (error) {
        this.enabled = false;
        throw error;
      }
    }
    return this.status();
  }

  private saveSettings(): void {
    saveRemoteSettings(this.settingsPath, {
      schemaVersion: 1,
      cloudflaredUpdateMode: this.updateMode,
      authMode: this.authMode,
      tunnelHostname: this.tunnelHostname,
    });
  }

  async setTunnelHostname(hostname: string): Promise<RemoteStatus> {
    const normalized = this.normalizeHostname(hostname);
    const wasEnabled = this.tunnelEnabled;
    if (wasEnabled) await this.stopTunnel();
    this.tunnelHostname = normalized;
    this.saveSettings();
    if (wasEnabled) await this.setTunnelEnabled(true);
    return this.status();
  }

  async setTunnelToken(token: string): Promise<RemoteStatus> {
    const value = token.trim();
    if (!value) throw new Error('Tunnel token cannot be empty.');
    const wasEnabled = this.tunnelEnabled;
    if (wasEnabled) await this.stopTunnel();
    this.writeTunnelToken(value);
    if (wasEnabled) await this.setTunnelEnabled(true);
    return this.status();
  }

  async setTunnelConfig(hostname: string, token?: string): Promise<RemoteStatus> {
    const normalized = this.normalizeHostname(hostname);
    const value = token?.trim();
    const wasEnabled = this.tunnelEnabled;
    if (wasEnabled) await this.stopTunnel();
    if (value) this.writeTunnelToken(value);
    this.tunnelHostname = normalized;
    this.saveSettings();
    if (wasEnabled) await this.setTunnelEnabled(true);
    return this.status();
  }

  private writeTunnelToken(value: string): void {
    fs.mkdirSync(this.options.dataDir, { recursive: true });
    const temp = `${this.tunnelTokenPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.tunnelTokenPath);
    try {
      fs.chmodSync(this.tunnelTokenPath, 0o600);
    } catch {
      // Windows uses ACLs; the userData directory is already user-private.
    }
  }

  private readTunnelToken(): string | undefined {
    try {
      const value = fs.readFileSync(this.tunnelTokenPath, 'utf8').trim();
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  private normalizeHostname(value: string): string {
    const raw = value.trim();
    if (!raw) throw new Error('Public hostname is required.');
    let hostname = raw;
    try {
      const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
      hostname = parsed.hostname;
    } catch {
      throw new Error('Public hostname is not valid.');
    }
    hostname = hostname.toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) || !hostname.includes('.')) {
      throw new Error('Public hostname must be a full DNS name, for example mcp.example.com.');
    }
    return hostname;
  }

  async checkCloudflared(): Promise<RemoteStatus> {
    try {
      this.lastCloudflaredCheck = await this.cloudflared.checkForUpdate();
      this.cloudflaredError = undefined;
    } catch (error) {
      this.cloudflaredError = error instanceof Error ? error.message : String(error);
      throw error;
    }
    return this.status();
  }

  async installCloudflared(): Promise<RemoteStatus> {
    const wasTunnelEnabled = this.tunnelEnabled;
    if (wasTunnelEnabled) await this.stopTunnel();
    try {
      await this.cloudflared.installLatest();
      this.lastCloudflaredCheck = undefined;
      this.cloudflaredError = undefined;
      if (wasTunnelEnabled) await this.setTunnelEnabled(true);
    } catch (error) {
      this.cloudflaredError = error instanceof Error ? error.message : String(error);
      throw error;
    }
    return this.status();
  }

  async maybeAutoUpdateCloudflared(): Promise<RemoteStatus> {
    if (this.updateMode !== 'automatic') return this.status();
    if (!this.cloudflared.installed()) return this.status();
    try {
      const check = await this.cloudflared.checkForUpdate();
      this.lastCloudflaredCheck = check;
      if (check.updateAvailable) await this.installCloudflared();
    } catch (error) {
      this.cloudflaredError = error instanceof Error ? error.message : String(error);
    }
    return this.status();
  }

  private managedCloudflaredPath(): string {
    return this.cloudflared.managedPath();
  }

  private localCloudflaredPath(): string | undefined {
    return findCloudflared(this.options.cloudflaredPath, this.managedCloudflaredPath());
  }

  private cloudflaredStatus(): RemoteCloudflaredStatus {
    const installed = this.cloudflared.installed();
    const path = this.localCloudflaredPath();
    const managed = Boolean(installed && path === this.managedCloudflaredPath());
    return {
      available: Boolean(path),
      managed,
      source: managed ? 'managed' : path ? 'system' : 'none',
      ...(installed?.version ? { version: installed.version } : {}),
      ...(path ? { path } : {}),
      updateMode: this.updateMode,
      ...(this.lastCloudflaredCheck?.latest.version ? { latestVersion: this.lastCloudflaredCheck.latest.version } : {}),
      ...(this.lastCloudflaredCheck ? { updateAvailable: this.lastCloudflaredCheck.updateAvailable } : {}),
      ...(this.cloudflaredError ? { error: this.cloudflaredError } : {}),
    };
  }

  async setEnabled(enabled: boolean): Promise<RemoteStatus> {
    if (enabled) {
      this.enabled = true;
      try {
        await this.startChild();
      } catch (error) {
        this.enabled = false;
        throw error;
      }
    } else {
      this.enabled = false;
      await this.stopTunnel();
      await this.stopChild();
    }
    return this.status();
  }

  async setTunnelEnabled(enabled: boolean): Promise<RemoteStatus> {
    if (!enabled) {
      await this.stopTunnel();
      return this.status();
    }
    if (!this.child) {
      this.enabled = true;
      try {
        await this.startChild();
      } catch (error) {
        this.enabled = false;
        throw error;
      }
    }
    if (!this.tunnelHostname) {
      throw new Error('Set a public hostname and tunnel token first.');
    }
    if (this.tunnel?.status().running) return this.status();
    if (this.tunnel) {
      await this.tunnel.stop();
      this.tunnel = null;
    }

    const token = this.readTunnelToken();
    if (!token) {
      throw new Error('A Cloudflare tunnel token is required. Save one in Remote settings.');
    }
    const binaryPath = this.localCloudflaredPath();
    if (!binaryPath) {
      this.tunnelError = 'cloudflared is not installed. Use INSTALL / UPDATE in Remote settings, or set HB_CLOUDFLARED_PATH.';
      this.tunnelEnabled = false;
      throw new Error(this.tunnelError);
    }

    this.tunnelEnabled = true;
    this.tunnelError = undefined;
    this.tunnel = new CloudflaredTunnel({
      binaryPath,
      argsPrefix: this.options.tunnelArgsPrefix,
      logFile: this.tunnelLogFile,
      onStatus: () => {
        // Status is read on demand by the Settings panel and app IPC.
      },
    });

    try {
      await this.tunnel.start(token);
    } catch (error) {
      this.tunnelEnabled = false;
      this.tunnelError = error instanceof Error ? error.message : String(error);
      throw error;
    }
    return this.status();
  }

  async rotateToken(): Promise<RemoteStatus> {
    const wasEnabled = this.enabled;
    await this.stopChild();
    createRemoteToken(this.options.dataDir);
    this.lastError = '';
    if (wasEnabled) {
      this.enabled = true;
      await this.startChild();
    }
    return this.status();
  }

  async disconnectSessions(): Promise<RemoteStatus> {
    if (!this.enabled) return this.status();
    await this.stopChild();
    await this.startChild();
    return this.status();
  }

  async stop(): Promise<void> {
    this.enabled = false;
    await this.stopTunnel();
    await this.stopChild();
  }

  private localUrl(): string {
    return `http://127.0.0.1:${this.options.port}/mcp/browser`;
  }

  private publicUrl(): string {
    const status = this.tunnel?.status();
    if (status?.running && this.tunnelHostname) return `https://${this.tunnelHostname}/mcp/browser`;
    return this.localUrl();
  }

  private tunnelStatus(): RemoteTunnelStatus {
    const binaryPath = this.localCloudflaredPath();
    const status = this.tunnel?.status();
    return {
      enabled: this.tunnelEnabled,
      running: Boolean(status?.running),
      state: status?.state || (this.tunnelError ? 'error' : 'stopped'),
      available: Boolean(binaryPath),
      ...(binaryPath ? { binaryPath } : {}),
      ...(this.tunnelHostname ? { hostname: this.tunnelHostname } : {}),
      tokenConfigured: Boolean(this.readTunnelToken()),
      ...(status?.running && this.tunnelHostname ? { url: `https://${this.tunnelHostname}` } : {}),
      ...(this.tunnelError || status?.error ? { error: this.tunnelError || status?.error } : {}),
    };
  }

  private async stopTunnel(): Promise<void> {
    this.tunnelEnabled = false;
    this.tunnelError = undefined;
    if (this.tunnel) {
      await this.tunnel.stop();
      this.tunnel = null;
    }
  }

  private async startChild(): Promise<void> {
    if (this.child) return;
    this.ensureToken();
    if (this.authMode === 'oauth') ensureOAuthClient(this.oauthClientPath);
    if (!fs.existsSync(this.options.serverPath)) {
      throw new Error(`Remote gateway binary not found: ${this.options.serverPath}`);
    }

    this.lastError = '';
    const child = spawn(this.options.runtimePath || process.execPath, [this.options.serverPath], {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        HB_BRIDGE_URL: this.options.bridgeUrl,
        HB_REMOTE_TOKEN_FILE: this.tokenPath,
        HB_REMOTE_PORT: String(this.options.port),
        HB_REMOTE_HOST: '127.0.0.1',
        HB_REMOTE_PATH: '/mcp/browser',
        HB_REMOTE_LOG_FILE: this.logFile,
        HB_REMOTE_AUTH_MODE: this.authMode,
        HB_OAUTH_CLIENT_FILE: this.oauthClientPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child = child;
    child.stdout?.resume();
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.lastError = `${this.lastError}${text}`.slice(-4000);
      this.appendLog(text);
    });
    child.once('error', (error) => {
      this.lastError = `${error.message}\n${this.lastError}`.slice(-4000);
      this.appendLog(`${error.message}\n`);
    });
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (code !== 0 && this.enabled) {
        this.lastError = `Remote gateway exited (${signal || code}).\n${this.lastError}`.slice(-4000);
      }
      if (this.enabled && this.tunnelEnabled) void this.stopTunnel();
      this.appendLog(`gateway exited code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
    });

    try {
      await this.waitForPort();
    } catch (error) {
      await this.stopChild();
      throw error;
    }
  }

  private async waitForPort(): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!this.child) {
        throw new Error(this.lastError || 'Remote gateway exited during startup.');
      }
      if (await canConnect('127.0.0.1', this.options.port)) return;
      await delay(150);
    }
    throw new Error(`Remote gateway did not start on 127.0.0.1:${this.options.port}. ${this.lastError}`.trim());
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    try {
      child.kill('SIGTERM');
    } catch (error) {
      this.appendLog(`SIGTERM failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await Promise.race([once(child, 'exit').then(() => undefined), delay(STOP_TIMEOUT_MS)]);
    if (child.exitCode === null) {
      try {
        child.kill('SIGKILL');
      } catch (error) {
        this.appendLog(`SIGKILL failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }

  private appendLog(text: string): void {
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      fs.appendFileSync(this.logFile, text, 'utf8');
    } catch {
      // Diagnostics are best-effort.
    }
  }
}
