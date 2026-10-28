export type TunnelState = 'stopped' | 'starting' | 'running' | 'error';

export interface TunnelStatus {
  state: TunnelState;
  running: boolean;
  error?: string;
  binaryPath: string;
}

export interface TunnelOptions {
  binaryPath: string;
  /** Optional executable arguments before the cloudflared args, for tests/fixtures. */
  argsPrefix?: string[];
  startupTimeoutMs?: number;
  logFile?: string;
  onStatus?: (status: TunnelStatus) => void;
  onLog?: (line: string) => void;
}
