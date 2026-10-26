import fs from 'node:fs';
import path from 'node:path';
import type { Session, WebContents, CookiesSetDetails } from 'electron';
import { dataPath } from '../data-paths.js';

export interface SessionSnapshot {
  name: string;
  domain?: string;
  url?: string;
  timestamp: string;
  cookiesCount: number;
  cookies: any[];
  storage?: Record<string, string>;
}

export class SessionVault {
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = dataPath('sessions');
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Captures active session cookies and local storage state into a persistent JSON vault.
   */
  public async saveSession(
    session: Session,
    wc?: WebContents,
    name?: string
  ): Promise<{ saved: boolean; name: string; cookiesCount: number; filePath: string }> {
    const currentUrl = wc?.getURL() || '';
    let domain = '';
    if (currentUrl && !currentUrl.startsWith('about:') && !currentUrl.startsWith('mark-eleven:')) {
      try {
        domain = new URL(currentUrl).hostname;
      } catch {}
    }

    const sessionName = name || domain || `session_${Date.now()}`;
    const cleanFileName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    const filePath = path.join(this.sessionsDir, cleanFileName);

    // Retrieve cookies from session
    const cookies = await session.cookies.get(domain ? { domain } : {});

    // Retrieve localStorage if active webContents is provided
    let storage: Record<string, string> | undefined;
    if (wc && currentUrl && !currentUrl.startsWith('about:')) {
      try {
        storage = await wc.executeJavaScript(`
          (() => {
            const out = {};
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k) out[k] = localStorage.getItem(k);
            }
            return out;
          })()
        `);
      } catch {}
    }

    const snapshot: SessionSnapshot = {
      name: sessionName,
      domain: domain || undefined,
      url: currentUrl || undefined,
      timestamp: new Date().toISOString(),
      cookiesCount: cookies.length,
      cookies,
      storage,
    };

    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');

    return {
      saved: true,
      name: sessionName,
      cookiesCount: cookies.length,
      filePath,
    };
  }

  /**
   * Restores cookies and storage items from a saved session vault snapshot.
   */
  public async restoreSession(
    session: Session,
    wc?: WebContents,
    name: string = ''
  ): Promise<{ restored: boolean; name: string; cookiesRestored: number }> {
    const cleanFileName = name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    const filePath = path.join(this.sessionsDir, cleanFileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Session snapshot not found: "${name}" at ${filePath}`);
    }

    const snapshot: SessionSnapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let cookiesRestored = 0;

    for (const cookie of snapshot.cookies) {
      try {
        const protocol = cookie.secure ? 'https://' : 'http://';
        const domainClean = cookie.domain.replace(/^\./, '');
        const cookieUrl = `${protocol}${domainClean}${cookie.path || '/'}`;

        const details: CookiesSetDetails = {
          url: cookieUrl,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: cookie.expirationDate,
          sameSite: cookie.sameSite as any,
        };

        await session.cookies.set(details);
        cookiesRestored++;
      } catch {}
    }

    // Restore localStorage if active webContents is provided and on same domain
    if (wc && snapshot.storage && Object.keys(snapshot.storage).length > 0) {
      try {
        await wc.executeJavaScript(`
          (() => {
            const items = ${JSON.stringify(snapshot.storage)};
            for (const [k, v] of Object.entries(items)) {
              localStorage.setItem(k, v);
            }
          })()
        `);
      } catch {}
    }

    return {
      restored: true,
      name: snapshot.name,
      cookiesRestored,
    };
  }

  /**
   * Returns a list of all saved session snapshots.
   */
  public listSessions(): Array<{ name: string; domain?: string; timestamp: string; cookiesCount: number }> {
    if (!fs.existsSync(this.sessionsDir)) return [];

    const files = fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'));
    const list: Array<{ name: string; domain?: string; timestamp: string; cookiesCount: number }> = [];

    for (const f of files) {
      try {
        const data: SessionSnapshot = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, f), 'utf8'));
        list.push({
          name: data.name,
          domain: data.domain,
          timestamp: data.timestamp,
          cookiesCount: data.cookiesCount,
        });
      } catch {}
    }

    return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Deletes a saved session snapshot.
   */
  public deleteSession(name: string): boolean {
    const cleanFileName = name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    const filePath = path.join(this.sessionsDir, cleanFileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }
}
