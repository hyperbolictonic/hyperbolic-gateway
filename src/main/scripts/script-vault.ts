import fs from 'node:fs';
import path from 'node:path';
import type { WebContents } from 'electron';
import { cortex, type ScriptItem } from '../cortex/cortex-db.js';
import { dataPath } from '../data-paths.js';

export interface SavedScriptMeta {
  name: string;
  description: string;
  code: string;
  domain?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export class ScriptVault {
  private scriptsDir: string;

  constructor() {
    this.scriptsDir = dataPath('scripts');
    if (!fs.existsSync(this.scriptsDir)) {
      fs.mkdirSync(this.scriptsDir, { recursive: true });
    }
  }

  /**
   * Persists a script to the local filesystem and indexes it in LanceDB Cortex.
   */
  public async saveScript(script: {
    name: string;
    code: string;
    description?: string;
    domain?: string;
    tags?: string[];
  }): Promise<ScriptItem> {
    const cleanName = script.name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(this.scriptsDir, `${cleanName}.json`);

    // Index into LanceDB Cortex vector table
    const indexed = await cortex.saveScript({
      name: script.name.trim(),
      code: script.code,
      description: script.description,
      domain: script.domain,
      tags: script.tags,
    });

    // Mirror to JSON file for portability and inspection
    const filePayload: SavedScriptMeta = {
      name: indexed.name,
      description: indexed.description,
      code: indexed.code,
      domain: indexed.domain,
      tags: indexed.tags,
      createdAt: indexed.createdAt,
      updatedAt: indexed.updatedAt,
    };
    fs.writeFileSync(filePath, JSON.stringify(filePayload, null, 2), 'utf8');

    return indexed;
  }

  /**
   * Semantically recalls scripts matching a natural language query or domain.
   */
  public async recallScripts(
    query?: string,
    options?: { domain?: string; tag?: string; limit?: number }
  ): Promise<ScriptItem[]> {
    return await cortex.recallScripts(query, options);
  }

  /**
   * Retrieves a script by exact name from memory/DB or file system.
   */
  public async getScript(name: string): Promise<ScriptItem | null> {
    const fromDb = await cortex.getScriptByName(name);
    if (fromDb) return fromDb;

    const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(this.scriptsDir, `${cleanName}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const data: SavedScriptMeta = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return await cortex.saveScript(data);
      } catch {}
    }

    return null;
  }

  /**
   * Executes a saved script inside the target WebContents, injecting dynamic arguments.
   */
  public async runScript(
    wc: WebContents,
    name: string,
    args: Record<string, any> = {}
  ): Promise<{ success: boolean; name: string; result: any; executionDurationMs: number }> {
    if (!wc || wc.isDestroyed()) {
      throw new Error('Target WebContents is uninitialized or destroyed');
    }

    const script = await this.getScript(name);
    if (!script) {
      throw new Error(`Script "${name}" not found in vault. Call recall_scripts() to search available macros.`);
    }

    const startTime = Date.now();

    // Wrap script inside an async IIFE with args injected
    const wrappedCode = `
      (async () => {
        const args = ${JSON.stringify(args)};
        try {
          const fn = ${script.code.trim().startsWith('async') || script.code.trim().startsWith('function') || script.code.trim().startsWith('(')
            ? script.code
            : `async (args) => { ${script.code} }`};
          if (typeof fn === 'function') {
            return await fn(args);
          } else {
            return fn;
          }
        } catch (err) {
          return { __error: true, message: err.message, stack: err.stack };
        }
      })()
    `;

    const rawResult = await wc.executeJavaScript(wrappedCode);
    const duration = Date.now() - startTime;

    if (rawResult && typeof rawResult === 'object' && rawResult.__error) {
      throw new Error(`Script "${name}" execution failed: ${rawResult.message}`);
    }

    return {
      success: true,
      name: script.name,
      result: rawResult,
      executionDurationMs: duration,
    };
  }

  /**
   * Deletes a script from both LanceDB Cortex and filesystem.
   */
  public async deleteScript(name: string): Promise<boolean> {
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(this.scriptsDir, `${cleanName}.json`);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    }

    return await cortex.deleteScript(name);
  }

  /**
   * Lists all scripts from the vault.
   */
  public async listScripts(domain?: string, tag?: string): Promise<ScriptItem[]> {
    return await cortex.recallScripts(undefined, { domain, tag, limit: 100 });
  }
}
