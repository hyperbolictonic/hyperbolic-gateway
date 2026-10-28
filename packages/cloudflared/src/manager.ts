import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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

function findExtractedBinary(directory: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findExtractedBinary(full, name);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === name) {
      return full;
    }
  }
  return undefined;
}

async function extractTar(archive: string, directory: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archive, '-C', directory], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Could not extract cloudflared archive: ${stderr || `tar exited ${code}`}`));
    });
  });
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
    const tempRoot = fs.mkdtempSync(path.join(this.options.dataDir, 'download-'));
    const archivePath = path.join(tempRoot, release.asset.name);
    let binaryPath = archivePath;
    try {
      fs.writeFileSync(archivePath, bytes);
      if (release.asset.archive === 'tar') {
        const extractDir = path.join(tempRoot, 'extract');
        fs.mkdirSync(extractDir, { recursive: true });
        await extractTar(archivePath, extractDir);
        const extracted = findExtractedBinary(extractDir, 'cloudflared');
        if (!extracted) throw new Error('cloudflared archive did not contain a cloudflared binary.');
        binaryPath = extracted;
      }

      const target = this.managedPath();
      const tempTarget = `${target}.${process.pid}.${Date.now()}.tmp`;
      fs.copyFileSync(binaryPath, tempTarget);
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
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  uninstall(): void {
    fs.rmSync(this.managedPath(), { force: true });
    fs.rmSync(this.metadataPath(), { force: true });
  }
}
