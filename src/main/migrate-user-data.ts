import fs from 'node:fs';
import path from 'node:path';
import { LEGACY_USER_DATA_NAMES } from '../shared/brand.ts';

/**
 * Marker written after a successful legacy import. Its presence stops every later launch from
 * re-scanning a large directory tree.
 */
const MARKER = '.migrated-user-data';

export interface UserDataMigration {
  /** Directory the data was copied from, or null when nothing was migrated. */
  from: string | null;
  target: string;
}

/**
 * Import a previous release's Electron `userData` into the current one.
 *
 * Electron derives `userData` from `productName`, so renaming the product gives every existing
 * user an empty profile: no settings, no Cortex database, no session snapshots, no wrap or remote
 * token. This copies the old tree in once.
 *
 * The copy is **additive** (`force: false`), so an already-populated install is never overwritten,
 * and it runs before the single-instance lock creates an empty target directory — hence the marker
 * rather than a bare "does the directory exist" check. Failures are swallowed: a fresh profile is
 * still usable, and a broken migration must not stop the app from starting.
 */
export function migrateLegacyUserData(
  appDataDir: string,
  currentName: string,
  legacyNames: readonly string[] = LEGACY_USER_DATA_NAMES,
): UserDataMigration {
  const target = path.join(appDataDir, currentName);
  if (fs.existsSync(path.join(target, MARKER))) return { from: null, target };

  for (const legacy of legacyNames) {
    if (legacy === currentName) continue;
    const from = path.join(appDataDir, legacy);
    try {
      if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) continue;
      fs.mkdirSync(target, { recursive: true });
      fs.cpSync(from, target, { recursive: true, force: false, errorOnExist: false });
      fs.writeFileSync(path.join(target, MARKER), `from=${legacy}\nat=${new Date().toISOString()}\n`, 'utf8');
      return { from, target };
    } catch {
      // Best effort: try the next legacy name, then give up quietly.
    }
  }

  return { from: null, target };
}
