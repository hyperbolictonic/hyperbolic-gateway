import { DEFAULT_TOOL_ORDER, TIER_LABELS, TOOL_TIERS, TOOLS_CATALOG } from '../../mcp/tools-catalog.js';
import type { ToolManagerState, ToolSettings } from '../../shared/tool-settings.js';

const ADVERTISED = TOOLS_CATALOG.filter((tool) => !tool.hidden);
const ADVERTISED_NAMES = new Set(ADVERTISED.map((tool) => tool.name));

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
  return {
    schemaVersion: 1,
    order: names(source.order),
    disabled: names(source.disabled),
    instructions,
  };
}

export function buildToolManagerState(settings: ToolSettings): ToolManagerState {
  const defaultOrder = [
    ...DEFAULT_TOOL_ORDER,
    ...ADVERTISED.map((tool) => tool.name).filter((name) => !DEFAULT_TOOL_ORDER.includes(name)),
  ];
  const fallback = new Map(defaultOrder.map((name, index) => [name, index]));
  const rank = new Map(settings.order.map((name, index) => [name, index]));
  const disabled = new Set(settings.disabled);
  const tools = [...ADVERTISED]
    .sort((a, b) => {
      const aRank = rank.get(a.name);
      const bRank = rank.get(b.name);
      if (aRank !== undefined || bRank !== undefined) {
        if (aRank === undefined) return 1;
        if (bRank === undefined) return -1;
        if (aRank !== bRank) return aRank - bRank;
      }
      return (fallback.get(a.name) ?? 0) - (fallback.get(b.name) ?? 0);
    })
    .map((tool) => {
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
  return { tools, settings };
}
