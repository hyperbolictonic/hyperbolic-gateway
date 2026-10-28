import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRemoteToken, readRemoteToken, remoteTokenFile } from './token.ts';
import { findCloudflared } from './cloudflared.ts';
import { QuickTunnel } from '../../../packages/quick-tunnel/src/index.ts';
import type { RemoteInfo, RemoteStatus, RemoteTunnelStatus } from '../../shared/remote.js';

export interface RemoteServiceOptions {
  serverPath: string;
  bridgeUrl: string;
  port: number;
  dataDir: string;
  cwd: string;
  runtimePath?: string;
  logFile?: string;
  cloudflaredPath?: string;
  cloudflaredArgsPrefix?: string[];
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
  private tunnel: QuickTunnel | null = null;
  private enabled = false;
  private tunnelEnabled = false;
  private tunnelError: string | undefined;
  private lastError = '';
  private readonly options: RemoteServiceOptions;
  private readonly tokenPath: string;
  private readonly logFile: string;
  private readonly tunnelLogFile: string;

  constructor(options: RemoteServiceOptions) {
    this.options = options;
    this.tokenPath = remoteTokenFile(options.dataDir);
    this.logFile = options.logFile || path.join(options.dataDir, 'remote-server.log');
    this.tunnelLogFile = path.join(options.dataDir, 'quick-tunnel.log');
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
      tunnel: this.tunnelStatus(),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  isRunning(): boolean {
    return Boolean(this.child);
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
      throw new Error('Start the remote gateway before enabling the Quick Tunnel.');
    }
    if (this.tunnel?.status().running) return this.status();
    if (this.tunnel) {
      await this.tunnel.stop();
      this.tunnel = null;
    }

    const binaryPath = findCloudflared(this.options.cloudflaredPath);
    if (!binaryPath) {
      this.tunnelError = 'cloudflared was not found. Install it and restart the app, or set HB_CLOUDFLARED_PATH.';
      this.tunnelEnabled = false;
      throw new Error(this.tunnelError);
    }

    this.tunnelEnabled = true;
    this.tunnelError = undefined;
    this.tunnel = new QuickTunnel({
      localUrl: `http://127.0.0.1:${this.options.port}`,
      binaryPath,
      argsPrefix: this.options.cloudflaredArgsPrefix,
      logFile: this.tunnelLogFile,
      onStatus: () => {
        // Status is read on demand by the Settings panel and app IPC.
      },
    });

    try {
      await this.tunnel.start();
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
    const tunnel = this.tunnel?.status();
    if (tunnel?.running && tunnel.url) return `${tunnel.url}/mcp/browser`;
    return this.localUrl();
  }

  private tunnelStatus(): RemoteTunnelStatus {
    const binaryPath = findCloudflared(this.options.cloudflaredPath);
    const status = this.tunnel?.status();
    return {
      enabled: this.tunnelEnabled,
      running: Boolean(status?.running),
      state: status?.state || (this.tunnelError ? 'error' : 'stopped'),
      available: Boolean(binaryPath),
      ...(binaryPath ? { binaryPath } : {}),
      ...(status?.url ? { url: status.url } : {}),
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
