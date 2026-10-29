/** Persisted overrides for the advertised browser MCP tool surface. */
export interface ToolSettings {
  schemaVersion: 1;
  /** Global display/registration order. Unknown names are ignored by the server. */
  order: string[];
  /** Canonical advertised tool names hidden from tools/list. */
  disabled: string[];
  /** Per-tool description overrides. An empty value means "use the catalog default". */
  instructions: Record<string, string>;
}

export interface ToolManagerEntry {
  name: string;
  description: string;
  tier: 1 | 2 | 3 | null;
  tierLabel: string;
  enabled: boolean;
  instruction: string;
}

export interface ToolManagerState {
  tools: ToolManagerEntry[];
  settings: ToolSettings;
}

export interface ToolManagerResult {
  ok: boolean;
  state?: ToolManagerState;
  errors: string[];
}
