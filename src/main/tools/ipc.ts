import { ipcMain } from 'electron';
import type { ToolManagerResult } from '../../shared/tool-settings.js';
import { ToolSettingsStore, type ToolSettingsValidation } from './settings.js';
import { buildToolManagerState, sanitizeToolSettings } from './state.js';

function result(store: ToolSettingsStore, saved?: ToolSettingsValidation): ToolManagerResult {
  if (saved && !saved.ok) return { ok: false, errors: saved.errors };
  return { ok: true, errors: [], state: buildToolManagerState(store.load()) };
}

/** Human-only writes over IPC. The bridge exposes a read-only config route to MCP processes. */
export function registerToolSettingsIpc(store: ToolSettingsStore): void {
  ipcMain.handle('tools:get', () => result(store));
  ipcMain.handle('tools:save', (_event, input: unknown) =>
    result(store, store.save(sanitizeToolSettings(input))),
  );
  ipcMain.handle('tools:reset', () => result(store, store.reset()));
}
