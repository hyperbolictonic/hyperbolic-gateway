export interface RemoteCloudflaredStatus {
  available: boolean;
  managed: boolean;
  source: 'managed' | 'system' | 'none';
  version?: string;
  path?: string;
  updateMode: 'manual' | 'automatic';
  latestVersion?: string;
  updateAvailable?: boolean;
  error?: string;
}

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
  cloudflared: RemoteCloudflaredStatus;
  error?: string;
}

export interface RemoteInfo {
  status: RemoteStatus;
  token: string;
  config: string;
}
