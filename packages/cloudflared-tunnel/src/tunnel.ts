import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { TunnelOptions, TunnelStatus } from './types.ts';

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 3_000;
const CONNECTED_PATTERN = /registered tunnel connection/i;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Owns a Cloudflare named tunnel process.
 *
 * The public hostname and ingress mapping are configured in Cloudflare; this
 * class only runs the connector with a tunnel token. It intentionally never
 * logs or reports the token.
 */
export class CloudflaredTunnel {
  private child: ChildProcess | null = null;
  private state: TunnelStatus['state'] = 'stopped';
  private error: string | undefined;
  private stopping = false;
  private readonly options: TunnelOptions;
  private readonly logFile: string | null;

  constructor(options: TunnelOptions) {
    this.options = options;
    this.logFile = options.logFile || null;
  }

  status(): TunnelStatus {
    return {
      state: this.state,
      running: Boolean(this.child),
      ...(this.error ? { error: this.error } : {}),
      binaryPath: this.options.binaryPath,
    };
  }

  async start(token: string): Promise<TunnelStatus> {
    if (this.child) return this.status();
    if (!token) throw new Error('A Cloudflare tunnel token is required.');

    this.stopping = false;
    this.state = 'starting';
    this.error = undefined;
    this.emit();

    const args = [
      ...(this.options.argsPrefix || []),
      'tunnel',
      '--no-autoupdate',
      'run',
    ];
    const child = spawn(this.options.binaryPath, args, {
      env: { ...process.env, TUNNEL_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    let connected = false;
    let startTimer: NodeJS.Timeout | undefined;
    let resolveStart!: (status: TunnelStatus) => void;
    let rejectStart!: (error: Error) => void;
    const started = new Promise<TunnelStatus>((resolve, reject) => {
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
      if (!connected && CONNECTED_PATTERN.test(text)) {
        connected = true;
        settleStart();
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
      if (!connected) {
        this.state = 'error';
        this.error = `cloudflared exited before registering the tunnel (${signal || code}).`;
        this.emit();
        rejectStart(new Error(this.error));
        return;
      }
      this.state = code === 0 ? 'stopped' : 'error';
      if (code !== 0) this.error = `cloudflared exited (${signal || code}).`;
      this.emit();
    });

    startTimer = setTimeout(() => {
      if (connected) return;
      settleStart();
      rejectStart(new Error(`Timed out waiting for cloudflared to register the tunnel. ${this.error || ''}`.trim()));
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
    try {
      this.options.onStatus?.(this.status());
    } catch {
      // Status callbacks must never break process lifecycle.
    }
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
