import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type {
  CloudflaredCheck,
  CloudflaredInstallRecord,
  CloudflaredManagerOptions,
  CloudflaredRelease,
} from './types.ts';

const RELEASE_API = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest';
const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 120_000;

function assetName(platform: NodeJS.Platform, arch: string): { name: string; archive: 'binary' | 'tar' } {
  if (platform === 'win32' && arch === 'x64') return { name: 'cloudflared-windows-amd64.exe', archive: 'binary' };
  if (platform === 'darwin' && arch === 'arm64') return { name: 'cloudflared-darwin-arm64.tgz', archive: 'tar' };
  if (platform === 'darwin' && arch === 'x64') return { name: 'cloudflared-darwin-amd64.tgz', archive: 'tar' };
  if (platform === 'linux' && arch === 'x64') return { name: 'cloudflared-linux-amd64', archive: 'binary' };
  if (platform === 'linux' && arch === 'arm64') return { name: 'cloudflared-linux-arm64', archive: 'binary' };
  throw new Error(`Unsupported cloudflared platform: ${platform}/${arch}`);
}

function compareVersions(a: string, b: string): number {
  const left = a.replace(/^v/, '').split('.').map((part) => Number(part) || 0);
  const right = b.replace(/^v/, '').split('.').map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function readTarString(header: Buffer, offset: number, length: number): string {
  return header.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/s, '');
}

function readTarSize(header: Buffer): number {
  const field = header.subarray(124, 136);
  if (field[0] & 0x80) {
    let value = 0n;
    for (const byte of field.subarray(1)) value = (value << 8n) | BigInt(byte);
    return Number(value);
  }
  const text = field.toString('ascii').replace(/\0.*$/s, '').trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function paxPath(data: Buffer): string | undefined {
  const text = data.toString('utf8');
  for (const line of text.split('\n')) {
    const space = line.indexOf(' ');
    if (space < 1) continue;
    const entry = line.slice(space + 1);
    if (entry.startsWith('path=')) return entry.slice(5);
  }
  return undefined;
}

/**
 * Extract the `cloudflared` file from a gzipped tar archive in pure Node.
 * This avoids depending on the host's tar binary in GUI-launched macOS apps.
 */
function extractCloudflaredFromTar(archive: Buffer): Buffer {
  const tar = zlib.gunzipSync(archive);
  let offset = 0;
  let pendingPath: string | undefined;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const size = readTarSize(header);
    const type = String.fromCharCode(header[156] || 0);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error('Cloudflared archive has a truncated tar entry.');
    const data = tar.subarray(dataStart, dataEnd);
    if (type === 'x' || type === 'g') {
      pendingPath = paxPath(data) || pendingPath;
    } else if (type === '0' || type === '\0' || type === '7') {
      const pathValue = pendingPath || entryPath;
      pendingPath = undefined;
      if (path.basename(pathValue) === 'cloudflared') return Buffer.from(data);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error('cloudflared archive did not contain a cloudflared binary.');
}

/** Download and install the official cloudflared binary into a managed app directory. */
export class CloudflaredManager {
  private readonly options: CloudflaredManagerOptions;

  constructor(options: CloudflaredManagerOptions) {
    this.options = options;
  }

  managedPath(): string {
    const platform = this.options.platform ?? process.platform;
    return path.join(this.options.dataDir, 'bin', platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  }

  private metadataPath(): string {
    return path.join(this.options.dataDir, 'bin', 'cloudflared.json');
  }

  installed(): CloudflaredInstallRecord | undefined {
    try {
      const record = JSON.parse(fs.readFileSync(this.metadataPath(), 'utf8')) as CloudflaredInstallRecord;
      if (!record.version || !record.sha256) return undefined;
      if (!fs.existsSync(this.managedPath())) return undefined;
      return record;
    } catch {
      return undefined;
    }
  }

  async checkForUpdate(): Promise<CloudflaredCheck> {
    const platform = this.options.platform ?? process.platform;
    const arch = this.options.arch ?? process.arch;
    const selected = assetName(platform, arch);
    const response = await (this.options.fetchImpl || fetch)(this.options.releaseApiUrl || RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'hyperbolic-gateway-cloudflared-manager',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Cloudflare release lookup failed: HTTP ${response.status}`);

    const payload = (await response.json()) as {
      tag_name?: unknown;
      assets?: Array<{ name?: unknown; browser_download_url?: unknown; digest?: unknown }>;
    };
    const version = typeof payload.tag_name === 'string' ? payload.tag_name : '';
    const asset = (payload.assets || []).find((candidate) => candidate.name === selected.name);
    const url = typeof asset?.browser_download_url === 'string' ? asset.browser_download_url : '';
    const digest = typeof asset?.digest === 'string' ? asset.digest.replace(/^sha256:/i, '') : '';
    if (!version || !url || !/^[a-f0-9]{64}$/i.test(digest)) {
      throw new Error(`Cloudflare release does not provide ${selected.name} with a SHA-256 digest.`);
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
      throw new Error('Cloudflare release asset URL is not an official GitHub HTTPS URL.');
    }

    const release: CloudflaredRelease = {
      version,
      asset: { name: selected.name, url, sha256: digest.toLowerCase(), archive: selected.archive },
    };
    const installed = this.installed();
    return {
      ...(installed ? { installed } : {}),
      latest: release,
      updateAvailable: !installed || compareVersions(release.version, installed.version) > 0,
    };
  }

  async installLatest(): Promise<CloudflaredInstallRecord> {
    const check = await this.checkForUpdate();
    if (!check.updateAvailable && check.installed) return check.installed;
    return this.install(check.latest);
  }

  async install(release: CloudflaredRelease): Promise<CloudflaredInstallRecord> {
    const response = await (this.options.fetchImpl || fetch)(release.asset.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`cloudflared download failed: HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_DOWNLOAD_BYTES) {
      throw new Error('cloudflared download is larger than the safety limit.');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new Error('cloudflared download is larger than the safety limit.');
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== release.asset.sha256) {
      throw new Error('cloudflared checksum did not match the published GitHub digest.');
    }

    fs.mkdirSync(path.join(this.options.dataDir, 'bin'), { recursive: true });
    const binary = release.asset.archive === 'tar' ? extractCloudflaredFromTar(bytes) : bytes;
    const target = this.managedPath();
    const tempTarget = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempTarget, binary);
    try {
      fs.chmodSync(tempTarget, 0o755);
    } catch {
      // Windows uses ACLs; the userData directory is already user-private.
    }
    fs.renameSync(tempTarget, target);

    const record: CloudflaredInstallRecord = {
      version: release.version,
      assetName: release.asset.name,
      sha256: release.asset.sha256,
      installedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.metadataPath(), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return record;
  }

  uninstall(): void {
    fs.rmSync(this.managedPath(), { force: true });
    fs.rmSync(this.metadataPath(), { force: true });
  }
}
