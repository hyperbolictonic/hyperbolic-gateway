/**
 * One-shot yt-dlp process runner shared by metadata, transcript and preview.
 *
 * The job runner has its own streaming spawn (progress, tree-kill). This one is
 * for calls that finish in seconds and return a payload.
 */

import { spawn } from 'node:child_process';

export interface CommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly overflowed: boolean;
}

export async function runYtDlpProcess(
  binary: string,
  args: readonly string[],
  options: { timeoutMs: number; maxStdoutBytes: number; maxStderrBytes?: number; env: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  const maxStderrBytes = options.maxStderrBytes ?? 256 * 1024;

  return new Promise((resolve) => {
    const child = spawn(binary, [...args], {
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let overflowed = false;
    let settled = false;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.byteLength;
      if (outBytes > options.maxStdoutBytes) {
        overflowed = true;
        child.kill();
        return;
      }
      out.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (errBytes >= maxStderrBytes) return;
      const room = maxStderrBytes - errBytes;
      err.push(chunk.subarray(0, Math.max(0, room)));
      errBytes += chunk.byteLength;
    });

    child.on('error', (error) => {
      finish({
        code: null,
        signal: null,
        stdout: '',
        stderr: error.message,
        timedOut,
        overflowed,
      });
    });

    child.on('close', (code, signal) => {
      finish({
        code,
        signal,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
        overflowed,
      });
    });
  });
}
