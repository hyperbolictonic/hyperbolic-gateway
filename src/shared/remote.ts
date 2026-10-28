export interface RemoteTunnelStatus {
  enabled: boolean;
  running: boolean;
  state: 'stopped' | 'starting' | 'running' | 'error';
  available: boolean;
  binaryPath?: string;
  url?: string;
  error?: string;
}

export interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  localUrl: string;
  url: string;
  tokenFile: string;
  tunnel: RemoteTunnelStatus;
  error?: string;
}

export interface RemoteInfo {
  status: RemoteStatus;
  token: string;
  config: string;
}
