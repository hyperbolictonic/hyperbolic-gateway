export type CloudflaredUpdateMode = 'manual' | 'automatic';

export interface CloudflaredReleaseAsset {
  name: string;
  url: string;
  sha256: string;
  archive: 'binary' | 'tar';
}

export interface CloudflaredRelease {
  version: string;
  asset: CloudflaredReleaseAsset;
}

export interface CloudflaredInstallRecord {
  version: string;
  assetName: string;
  sha256: string;
  installedAt: string;
}

export interface CloudflaredCheck {
  installed?: CloudflaredInstallRecord;
  latest: CloudflaredRelease;
  updateAvailable: boolean;
}

export interface CloudflaredManagerOptions {
  dataDir: string;
  platform?: NodeJS.Platform;
  arch?: string;
  releaseApiUrl?: string;
  fetchImpl?: typeof fetch;
}
