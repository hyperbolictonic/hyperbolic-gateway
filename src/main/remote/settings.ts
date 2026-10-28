import fs from 'node:fs';
import path from 'node:path';
import type { CloudflaredUpdateMode } from '../../../packages/cloudflared/src/index.ts';

export interface RemoteSettings {
  schemaVersion: 1;
  cloudflaredUpdateMode: CloudflaredUpdateMode;
}

const DEFAULT_SETTINGS: RemoteSettings = {
  schemaVersion: 1,
  cloudflaredUpdateMode: 'manual',
};

export function loadRemoteSettings(file: string): RemoteSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RemoteSettings>;
    return {
      schemaVersion: 1,
      cloudflaredUpdateMode: parsed.cloudflaredUpdateMode === 'automatic' ? 'automatic' : 'manual',
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
