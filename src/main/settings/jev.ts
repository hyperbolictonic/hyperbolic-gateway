import fs from 'node:fs';
import path from 'node:path';

export type JevMode = 'prefer' | 'enforce';

export interface JevSettings {
  /** Hard on/off. Off gates the JEV tools off and never touches observe. */
  power: boolean;
  /** How reads are steered while power is on. */
  mode: JevMode;
}

export const DEFAULT_JEV_SETTINGS: JevSettings = { power: false, mode: 'prefer' };

const isMode = (value: unknown): value is JevMode => value === 'prefer' || value === 'enforce';

/**
 * JEV is an optional feature (not an experimental one): it is offered only when
 * a decision model is configured, and stays off until the human opts in.
 * Written only from the Settings panel over IPC.
 *
 * `power` is the master switch; `mode` only matters while it is on. A legacy
 * `{ enabled: true }` file migrates to prefer — never silently to enforce.
 */
export class JevSettingsStore {
  private settings: JevSettings = { ...DEFAULT_JEV_SETTINGS };
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    this.load();
  }

  private load(): void {
    try {
      // Windows editors (and some PowerShell defaults) write a UTF-8 BOM; JSON.parse rejects it.
      const raw = fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      this.settings = {
        power: parsed?.power === true || parsed?.enabled === true,
        mode: isMode(parsed?.mode) ? parsed.mode : 'prefer',
      };
    } catch {
      this.settings = { ...DEFAULT_JEV_SETTINGS };
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.file);
    } catch {
      // Keep the in-memory value; the next save retries.
    }
  }

  get(): JevSettings {
    return { ...this.settings };
  }

  savePatch(patch: unknown): JevSettings {
    const next = (patch ?? {}) as { power?: unknown; mode?: unknown; enabled?: unknown };
    const power = next.power !== undefined ? next.power === true : next.enabled === true ? true : this.settings.power;
    const mode = isMode(next.mode) ? next.mode : this.settings.mode;
    this.settings = { power, mode };
    this.save();
    return this.get();
  }
}
