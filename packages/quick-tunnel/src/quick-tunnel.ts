import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { QuickTunnelOptions, QuickTunnelStatus } from './types.ts';

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 3_000;
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Owns a Cloudflare Quick Tunnel process.
 *
 * It intentionally knows nothing about MCP or Electron: it starts cloudflared,
 * extracts the public URL, bounds startup/shutdown, and publishes state.
 */
export class QuickTunnel {
  private child: ChildProcess | null = null;
  private state: QuickTunnelStatus['state'] = 'stopped';
  private url: string | undefined;
  private error: string | undefined;
  private stopping = false;
  private readonly options: QuickTunnelOptions;
  private readonly logFile: string | null;

  constructor(options: QuickTunnelOptions) {
    this.options = options;
    this.logFile = options.logFile || null;
  }

  status(): QuickTunnelStatus {
    return {
      state: this.state,
      running: Boolean(this.child),
      ...(this.url ? { url: this.url } : {}),
      ...(this.error ? { error: this.error } : {}),
      binaryPath: this.options.binaryPath,
    };
  }

  async start(): Promise<QuickTunnelStatus> {
    if (this.child) return this.status();

    this.stopping = false;
    this.state = 'starting';
    this.url = undefined;
    this.error = undefined;
    this.emit();

    const args = [
      ...(this.options.argsPrefix || []),
      'tunnel',
      '--url',
      this.options.localUrl,
      '--no-autoupdate',
    ];
    const child = spawn(this.options.binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    let sawUrl = false;
    let resolveStart!: (status: QuickTunnelStatus) => void;
    let rejectStart!: (error: Error) => void;
    let startTimer: NodeJS.Timeout | undefined;
    const started = new Promise<QuickTunnelStatus>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });

    const settleStart = (): void => {
      if (startTimer) {
        clearTimeout(startTimer);
        startTimer = undefined;
      }
    };

    const readOutput = (chunk: Buffer): void => {
      const text = chunk.toString();
      this.appendLog(text);
      this.options.onLog?.(text);
      const match = text.match(URL_PATTERN);
      if (match && !sawUrl) {
        sawUrl = true;
        settleStart();
        this.url = match[0];
        this.state = 'running';
        this.emit();
        resolveStart(this.status());
      }
    };

    child.stdout?.on('data', readOutput);
    child.stderr?.on('data', readOutput);
    child.once('error', (error) => {
      settleStart();
      if (this.stopping) return;
      if (this.child === child) this.child = null;
      this.state = 'error';
      this.error = error.message;
      this.emit();
      rejectStart(error);
    });
    child.once('exit', (code, signal) => {
      settleStart();
      if (this.stopping) {
        if (this.child === child) this.child = null;
        return;
      }
      if (this.child === child) this.child = null;
      if (!sawUrl) {
        this.state = 'error';
        this.error = `cloudflared exited before publishing a URL (${signal || code}).`;
        this.emit();
        rejectStart(new Error(this.error));
        return;
      }
      this.url = undefined;
      this.state = code === 0 ? 'stopped' : 'error';
      if (code !== 0) this.error = `cloudflared exited (${signal || code}).`;
      this.emit();
    });

    startTimer = setTimeout(() => {
      if (sawUrl) return;
      settleStart();
      rejectStart(new Error(`Timed out waiting for the Cloudflare Quick Tunnel URL. ${this.error || ''}`.trim()));
    }, this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);

    try {
      return await started;
    } catch (error) {
      if (!this.error) this.error = error instanceof Error ? error.message : String(error);
      this.state = 'error';
      await this.stop(true);
      throw error;
    }
  }

  async stop(preserveError = false): Promise<void> {
    const child = this.child;
    this.stopping = true;
    this.child = null;
    if (!preserveError) {
      this.state = 'stopped';
      this.url = undefined;
      this.error = undefined;
      this.emit();
    }
    if (!child || child.exitCode !== null) {
      this.stopping = false;
      return;
    }

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
    this.stopping = false;
  }

  private emit(): void {
    this.options.onStatus?.(this.status());
  }

  private appendLog(text: string): void {
    if (!this.logFile) return;
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      fs.appendFileSync(this.logFile, text, 'utf8');
    } catch {
      // Diagnostics are best-effort.
    }
  }
}
