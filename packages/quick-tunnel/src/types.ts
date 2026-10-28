export type QuickTunnelState = 'stopped' | 'starting' | 'running' | 'error';

export interface QuickTunnelStatus {
  state: QuickTunnelState;
  running: boolean;
  url?: string;
  error?: string;
  binaryPath: string;
}

export interface QuickTunnelOptions {
  localUrl: string;
  binaryPath: string;
  /** Optional executable arguments before the cloudflared args, for tests/fixtures. */
  argsPrefix?: string[];
  startupTimeoutMs?: number;
  logFile?: string;
  onStatus?: (status: QuickTunnelStatus) => void;
  onLog?: (line: string) => void;
}
