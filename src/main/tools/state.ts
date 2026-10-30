import { DEFAULT_TOOL_ORDER, TIER_LABELS, TOOL_TIERS, TOOLS_CATALOG } from '../../mcp/tools-catalog.js';
import {
  CONSOLIDATED_HIDDEN_TOOLS,
  META_TOOL_NAMES,
  TOOL_GROUPS,
} from '../../mcp/tool-groups.js';
import type { ToolManagerEntry, ToolManagerState, ToolSettings } from '../../shared/tool-settings.js';

const ADVERTISED_CATALOG = TOOLS_CATALOG.filter(
  (tool) => !tool.hidden && !CONSOLIDATED_HIDDEN_TOOLS.has(tool.name),
);
const ADVERTISED_NAMES = new Set([
  ...ADVERTISED_CATALOG.map((tool) => tool.name),
  ...META_TOOL_NAMES,
]);
const GROUP_ACTIONS = new Map(
  TOOL_GROUPS.map((group) => [group.name, new Set(group.actions.map((action) => action.action))]),
);

export function sanitizeToolSettings(input: unknown): ToolSettings {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const names = (value: unknown): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((name): name is string => typeof name === 'string' && ADVERTISED_NAMES.has(name)))]
      : [];
  const instructions: Record<string, string> = {};
  if (source.instructions && typeof source.instructions === 'object' && !Array.isArray(source.instructions)) {
    for (const [name, text] of Object.entries(source.instructions)) {
      if (ADVERTISED_NAMES.has(name) && typeof text === 'string' && text.trim()) {
        instructions[name] = text.trim().slice(0, 12_000);
      }
    }
  }
  const actionInstructions: Record<string, Record<string, string>> = {};
  if (source.actionInstructions && typeof source.actionInstructions === 'object' && !Array.isArray(source.actionInstructions)) {
    for (const [toolName, rawActions] of Object.entries(source.actionInstructions)) {
      const allowed = GROUP_ACTIONS.get(toolName);
      if (!allowed || !rawActions || typeof rawActions !== 'object' || Array.isArray(rawActions)) continue;
      const actions: Record<string, string> = {};
      for (const [actionName, text] of Object.entries(rawActions)) {
        if (allowed.has(actionName) && typeof text === 'string' && text.trim()) {
          actions[actionName] = text.trim().slice(0, 4_000);
        }
      }
      if (Object.keys(actions).length) actionInstructions[toolName] = actions;
    }
  }
  return {
    schemaVersion: 1,
    order: names(source.order),
    disabled: names(source.disabled),
    instructions,
    actionInstructions,
  };
}

export function buildToolManagerState(settings: ToolSettings): ToolManagerState {
  const defaultOrder = [
    ...DEFAULT_TOOL_ORDER,
    ...ADVERTISED_NAMES,
    ...Array.from(META_TOOL_NAMES),
  ].filter((name, index, all) => all.indexOf(name) === index);
  const fallback = new Map(defaultOrder.map((name, index) => [name, index]));
  const rank = new Map(settings.order.map((name, index) => [name, index]));
  const disabled = new Set(settings.disabled);

  const catalogEntries: ToolManagerEntry[] = ADVERTISED_CATALOG.map((tool) => {
    const tier = TOOL_TIERS[tool.name] ?? null;
    return {
      name: tool.name,
      description: tool.description,
      tier,
      tierLabel: tier ? TIER_LABELS[tier] : 'OTHER',
      enabled: !disabled.has(tool.name),
      instruction: settings.instructions[tool.name] ?? '',
    };
  });
  const groupedEntries: ToolManagerEntry[] = TOOL_GROUPS.map((group) => ({
    name: group.name,
    description: group.description,
    tier: group.tier,
    tierLabel: group.tier ? TIER_LABELS[group.tier] : 'OTHER',
    enabled: !disabled.has(group.name),
    instruction: settings.instructions[group.name] ?? '',
    actions: group.actions.map((action) => ({
      name: action.action,
      description: action.description,
      tool: action.tool || action.endpoint || '',
      instruction: settings.actionInstructions?.[group.name]?.[action.action] ?? '',
    })),
  }));

  const tools = [...catalogEntries, ...groupedEntries].sort((a, b) => {
    const aRank = rank.get(a.name);
    const bRank = rank.get(b.name);
    if (aRank !== undefined || bRank !== undefined) {
      if (aRank === undefined) return 1;
      if (bRank === undefined) return -1;
      if (aRank !== bRank) return aRank - bRank;
    }
    return (fallback.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
      (fallback.get(b.name) ?? Number.MAX_SAFE_INTEGER);
  });
  return { tools, settings };
}
