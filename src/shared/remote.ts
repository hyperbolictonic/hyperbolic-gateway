export interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  url: string;
  tokenFile: string;
  error?: string;
}

export interface RemoteInfo {
  status: RemoteStatus;
  token: string;
  config: string;
}
