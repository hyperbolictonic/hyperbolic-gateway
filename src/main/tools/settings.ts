import fs from 'node:fs';
import path from 'node:path';
import type { ToolSettings } from '../../shared/tool-settings.js';

export interface ToolSettingsValidation {
  ok: boolean;
  settings?: ToolSettings;
  errors: string[];
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  schemaVersion: 1,
  order: [],
  disabled: [],
  instructions: {},
  actionInstructions: {},
};

const MAX_INSTRUCTION_CHARS = 12_000;
const MAX_NAMES = 500;

function cloneDefaults(): ToolSettings {
  return { ...DEFAULT_TOOL_SETTINGS, order: [], disabled: [], instructions: {}, actionInstructions: {} };
}

function uniqueNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (seen.size >= MAX_NAMES) break;
  }
  return [...seen];
}

function normalizeInstructions(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [rawName, rawText] of Object.entries(value)) {
    const name = rawName.trim();
    if (!name || typeof rawText !== 'string') continue;
    const text = rawText.trim();
    if (!text) continue;
    out[name] = text.slice(0, MAX_INSTRUCTION_CHARS);
  }
  return out;
}

function normalizeActionInstructions(value: unknown): Record<string, Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [rawTool, rawActions] of Object.entries(value)) {
    const tool = rawTool.trim();
    if (!tool || !rawActions || typeof rawActions !== 'object' || Array.isArray(rawActions)) continue;
    const actions = normalizeInstructions(rawActions);
    if (Object.keys(actions).length) out[tool] = actions;
  }
  return out;
}

export function normalizeToolSettings(input: unknown): ToolSettingsValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['tool settings must be an object'] };
  }
  const source = input as Record<string, unknown>;
  return {
    ok: true,
    errors: [],
    settings: {
      schemaVersion: 1,
      order: uniqueNames(source.order),
      disabled: uniqueNames(source.disabled),
      instructions: normalizeInstructions(source.instructions),
      actionInstructions: normalizeActionInstructions(source.actionInstructions),
    },
  };
}

/** File-backed store. One instance is shared by the IPC handlers and the local bridge. */
export class ToolSettingsStore {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  load(): ToolSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const normalized = normalizeToolSettings(parsed);
      return normalized.ok && normalized.settings ? normalized.settings : cloneDefaults();
    } catch {
      return cloneDefaults();
    }
  }

  save(input: unknown): ToolSettingsValidation {
    const normalized = normalizeToolSettings(input);
    if (!normalized.ok || !normalized.settings) return normalized;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(normalized.settings, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.file);
      return normalized;
    } catch (error: any) {
      return { ok: false, errors: [`Could not save tool settings: ${error?.message || error}`] };
    }
  }

  reset(): ToolSettingsValidation {
    return this.save(cloneDefaults());
  }
}
