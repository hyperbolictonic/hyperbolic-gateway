import fs from 'node:fs';
import path from 'node:path';
import type { CloudflaredUpdateMode } from '../../../packages/cloudflared/src/index.ts';

export interface RemoteSettings {
  schemaVersion: 1;
  cloudflaredUpdateMode: CloudflaredUpdateMode;
  authMode: 'bearer' | 'oauth';
  tunnelHostname: string;
}

const DEFAULT_SETTINGS: RemoteSettings = {
  schemaVersion: 1,
  cloudflaredUpdateMode: 'manual',
  authMode: 'bearer',
  tunnelHostname: '',
};

export function loadRemoteSettings(file: string): RemoteSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RemoteSettings>;
    return {
      schemaVersion: 1,
      cloudflaredUpdateMode: parsed.cloudflaredUpdateMode === 'automatic' ? 'automatic' : 'manual',
      authMode: parsed.authMode === 'oauth' ? 'oauth' : 'bearer',
      tunnelHostname: typeof parsed.tunnelHostname === 'string' ? parsed.tunnelHostname : '',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveRemoteSettings(file: string, settings: RemoteSettings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}
