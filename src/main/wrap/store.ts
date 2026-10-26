/**
 * File-backed wrapper store.
 *
 * One file per wrapper under `<userData>/wrap/wrappers/<id>.json`. Writes are
 * atomic (temp file + rename) so an interrupted save cannot leave a half
 * wrapper behind. A malformed file is skipped rather than crashing the bridge;
 * `wrap_get` can still report the validation error if asked directly.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { WrapManifestEntry, WrapWrapper } from './types.ts';
import { validateWrapper } from './validate-wrapper.ts';

export interface StoreResult {
  ok: boolean;
  wrapper?: WrapWrapper;
  errors: string[];
}

export class WrapStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  ensure(): void {
    fs.mkdirSync(this.wrappersDir(), { recursive: true });
  }

  list(): WrapWrapper[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.wrappersDir(), { withFileTypes: true });
    } catch {
      return [];
    }

    const wrappers: WrapWrapper[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const wrapper = this.read(path.join(this.wrappersDir(), entry.name));
      if (wrapper) wrappers.push(wrapper);
    }
    return wrappers.sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): WrapWrapper | undefined {
    const file = this.pathFor(id);
    if (!file) return undefined;
    return this.read(file);
  }

  create(input: unknown): StoreResult {
    const validation = validateWrapper(input);
    if (!validation.ok || !validation.wrapper) return { ok: false, errors: validation.errors };

    const wrapper = validation.wrapper;
    if (fs.existsSync(this.pathFor(wrapper.id)!)) {
      return { ok: false, errors: [`wrapper "${wrapper.id}" already exists; use wrap_update`] };
    }

    return this.write(wrapper);
  }

  update(input: unknown): StoreResult {
    const validation = validateWrapper(input);
    if (!validation.ok || !validation.wrapper) return { ok: false, errors: validation.errors };

    const wrapper = validation.wrapper;
    if (!fs.existsSync(this.pathFor(wrapper.id)!)) {
      return { ok: false, errors: [`wrapper "${wrapper.id}" does not exist; use wrap_create`] };
    }

    return this.write(wrapper);
  }

  delete(id: string): boolean {
    const file = this.pathFor(id);
    if (!file) return false;
    try {
      fs.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  }

  manifest(): WrapManifestEntry[] {
    return this.list().map((wrapper) => {
      let host = '';
      try {
        host = new URL(wrapper.request.url).host;
      } catch {
        host = '';
      }
      return {
        id: wrapper.id,
        name: wrapper.name,
        description: wrapper.description,
        method: wrapper.request.method,
        methods: wrapper.request.methods,
        host,
        mutating: wrapper.mutating ?? (wrapper.request.methods?.length ? wrapper.request.methods : [wrapper.request.method]).some((method) => !['GET', 'HEAD'].includes(method)),
        required: wrapper.inputSchema?.required || [],
        exposeAsTool: Boolean(wrapper.exposeAsTool),
        secret: wrapper.request.auth,
        lastVerified: wrapper.lastVerified,
      };
    });
  }

  count(): number {
    try {
      return fs.readdirSync(this.wrappersDir()).filter((name) => name.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  /** Record a successful live run without going through full validation. */
  touchVerified(id: string, at: string = new Date().toISOString()): boolean {
    const wrapper = this.get(id);
    if (!wrapper) return false;
    return this.write({ ...wrapper, lastVerified: at }).ok;
  }

  private wrappersDir(): string {
    return path.join(this.dir, 'wrappers');
  }

  private pathFor(id: string): string | null {
    if (typeof id !== 'string' || !id || id.includes('..') || !/^[a-z0-9._-]+$/i.test(id)) return null;
    return path.join(this.wrappersDir(), `${id}.json`);
  }

  private read(file: string): WrapWrapper | undefined {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const validation = validateWrapper(parsed);
      return validation.ok ? validation.wrapper : undefined;
    } catch {
      return undefined;
    }
  }

  private write(wrapper: WrapWrapper): StoreResult {
    try {
      this.ensure();
      const target = this.pathFor(wrapper.id)!;
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(wrapper, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, target);
      return { ok: true, wrapper, errors: [] };
    } catch (err: any) {
      return { ok: false, errors: [err?.message || String(err)] };
    }
  }
}
