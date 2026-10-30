import type { ElectronAPI } from '../preload/index.js';
import type { ToolManagerEntry, ToolManagerState, ToolSettings } from '../shared/tool-settings.js';

const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
const TIERS: Array<{ tier: 1 | 2 | 3 | null; label: string }> = [
  { tier: 1, label: 'TIER 1 · PREFER' },
  { tier: 2, label: 'TIER 2 · FALLBACK' },
  { tier: 3, label: 'TIER 3 · USE DELIBERATELY' },
  { tier: null, label: 'OTHER' },
];

const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

let initialized = false;
let entries: ToolManagerEntry[] = [];
let settings: ToolSettings = { schemaVersion: 1, order: [], disabled: [], instructions: {}, actionInstructions: {} };
let selected: string | null = null;
let dragging: string | null = null;
let dirty = false;

function entry(name: string): ToolManagerEntry | undefined {
  return entries.find((tool) => tool.name === name);
}

function applyState(state: ToolManagerState): void {
  entries = state.tools;
  settings = state.settings;
  if (!selected || !entry(selected)) selected = entries[0]?.name ?? null;
  dirty = false;
  render();
}

function showResult(kind: 'success' | 'error' | 'info', text: string): void {
  const target = byId<HTMLElement>('settings-tools-result');
  if (!target) return;
  target.className = `alert alert-${kind} alert-sm font-mono text-xs mt-3`;
  target.textContent = text;
  target.classList.remove('hidden');
}

function setDetailResult(text: string): void {
  const target = byId<HTMLElement>('settings-tools-detail-result');
  if (target) target.textContent = text;
}

function setDirty(next: boolean): void {
  dirty = next;
  byId<HTMLElement>('settings-tools-dirty')?.classList.toggle('hidden', !dirty);
}

function reorderWithinTier(source: string, target: string, tier: 1 | 2 | 3 | null): void {
  if (source === target) return;
  const group = entries.filter((tool) => tool.tier === tier);
  const from = group.findIndex((tool) => tool.name === source);
  const to = group.findIndex((tool) => tool.name === target);
  if (from < 0 || to < 0) return;
  const [moved] = group.splice(from, 1);
  group.splice(to, 0, moved);
  const grouped = TIERS.flatMap(({ tier: groupTier }) =>
    groupTier === tier ? group : entries.filter((tool) => tool.tier === groupTier),
  );
  const seen = new Set(grouped.map((tool) => tool.name));
  entries = [...grouped, ...entries.filter((tool) => !seen.has(tool.name))];
  setDirty(true);
  renderList();
}

function updateSummary(): void {
  const summary = byId<HTMLElement>('settings-tools-summary');
  if (summary) {
    const enabled = entries.filter((tool) => tool.enabled).length;
    summary.textContent = `${enabled}/${entries.length}`;
  }
}

function renderList(): void {
  const list = byId<HTMLElement>('settings-tools-list');
  if (!list) return;
  list.replaceChildren();
  for (const { tier, label } of TIERS) {
    const group = entries.filter((tool) => tool.tier === tier);
    if (!group.length) continue;
    const heading = document.createElement('div');
    heading.className = 'font-mono text-[10px] uppercase tracking-wider text-base-content/40 pt-1';
    heading.textContent = `${label} · ${group.length}`;
    list.append(heading);

    for (const tool of group) {
      const card = document.createElement('div');
      card.className = `group rounded border p-2 cursor-pointer transition-colors ${
        tool.name === selected
          ? 'border-accent bg-base-100'
          : 'border-base-300 bg-base-200/30 hover:border-base-content/30'
      } ${tool.enabled ? '' : 'opacity-50'}`;
      card.draggable = true;
      card.tabIndex = 0;
      card.dataset.name = tool.name;
      card.dataset.tier = String(tool.tier ?? 'other');
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Edit ${tool.name}`);
      card.addEventListener('click', () => selectTool(tool.name));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectTool(tool.name);
        }
      });
      card.addEventListener('dragstart', (event) => {
        dragging = tool.name;
        event.dataTransfer?.setData('text/plain', tool.name);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        card.classList.add('opacity-40');
      });
      card.addEventListener('dragend', () => {
        dragging = null;
        card.classList.remove('opacity-40');
      });
      card.addEventListener('dragover', (event) => {
        if (dragging && dragging !== tool.name && entry(dragging)?.tier === tool.tier) {
          event.preventDefault();
          card.classList.add('ring-1', 'ring-accent');
        }
      });
      card.addEventListener('dragleave', () => card.classList.remove('ring-1', 'ring-accent'));
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        card.classList.remove('ring-1', 'ring-accent');
        if (dragging) reorderWithinTier(dragging, tool.name, tool.tier);
        dragging = null;
      });

      const row = document.createElement('div');
      row.className = 'flex items-start gap-2';
      const handle = document.createElement('span');
      handle.className = 'text-base-content/30 font-mono text-[10px] pt-0.5 cursor-grab';
      handle.textContent = '⋮⋮';
      handle.title = 'Drag to reorder within this tier';
      const body = document.createElement('div');
      body.className = 'min-w-0 flex-1';
      const name = document.createElement('div');
      name.className = 'font-mono text-[11px] font-bold truncate';
      name.textContent = tool.name;
      const meta = document.createElement('div');
      meta.className = 'flex items-center gap-1.5 mt-1';
      const tierBadge = document.createElement('span');
      tierBadge.className = 'badge badge-ghost badge-xs font-mono text-[9px]';
      tierBadge.textContent = tool.tier ? `T${tool.tier}` : '—';
      const custom = document.createElement('span');
      custom.className = `badge badge-xs font-mono text-[9px] ${tool.instruction ? 'badge-info' : 'hidden'}`;
      custom.dataset.role = 'custom';
      custom.textContent = 'CUSTOM';
      meta.append(tierBadge, custom);
      body.append(name, meta);
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'toggle toggle-xs toggle-success shrink-0';
      toggle.checked = tool.enabled;
      toggle.title = tool.enabled ? 'Disable this tool' : 'Enable this tool';
      toggle.addEventListener('click', (event) => event.stopPropagation());
      toggle.addEventListener('change', () => setEnabled(tool.name, toggle.checked));
      row.append(handle, body, toggle);
      card.append(row);
      list.append(card);
    }
  }
  updateSummary();
}

function renderDetail(): void {
  const empty = byId<HTMLElement>('settings-tools-empty');
  const detail = byId<HTMLElement>('settings-tools-detail');
  const tool = selected ? entry(selected) : undefined;
  if (!tool) {
    empty?.classList.remove('hidden');
    detail?.classList.add('hidden');
    return;
  }
  empty?.classList.add('hidden');
  detail?.classList.remove('hidden');

  const name = byId<HTMLElement>('settings-tools-name');
  const tier = byId<HTMLElement>('settings-tools-tier');
  const state = byId<HTMLElement>('settings-tools-state');
  const enabled = byId<HTMLInputElement>('settings-tools-enabled');
  const defaultText = byId<HTMLElement>('settings-tools-default');
  const defaultChars = byId<HTMLElement>('settings-tools-default-chars');
  const instructions = byId<HTMLTextAreaElement>('settings-tools-instructions');
  const overrideChars = byId<HTMLElement>('settings-tools-override-chars');
  if (name) name.textContent = tool.name;
  if (tier) tier.textContent = tool.tierLabel;
  if (state) {
    state.textContent = tool.enabled ? 'ON' : 'OFF';
    state.className = `badge badge-sm font-mono text-[10px] ${tool.enabled ? 'badge-success' : 'badge-ghost'}`;
  }
  if (enabled) enabled.checked = tool.enabled;
  if (defaultText) defaultText.textContent = tool.description;
  if (defaultChars) defaultChars.textContent = `${tool.description.length.toLocaleString()} chars`;
  if (instructions && instructions.value !== (settings.instructions[tool.name] || '')) {
    instructions.value = settings.instructions[tool.name] || '';
  }
  if (instructions) instructions.placeholder = `Default: ${tool.description.slice(0, 160)}${tool.description.length > 160 ? '…' : ''}`;
  if (overrideChars) {
    const length = (settings.instructions[tool.name] || '').length;
    overrideChars.textContent = length ? `${length.toLocaleString()} chars` : 'using default';
  }
  const actionsSection = byId<HTMLElement>('settings-tools-actions-section');
  const actionsHost = byId<HTMLElement>('settings-tools-actions');
  const actionsCount = byId<HTMLElement>('settings-tools-actions-count');
  if (actionsSection && actionsHost && actionsCount) {
    const actions = tool.actions || [];
    actionsSection.classList.toggle('hidden', actions.length === 0);
    actionsCount.textContent = actions.length ? `(${actions.length})` : '';
    actionsHost.replaceChildren();
    for (const action of actions) {
      const row = document.createElement('details');
      row.className = 'rounded bg-base-200/40 px-2 py-1';
      const summary = document.createElement('summary');
      summary.className = 'flex flex-wrap items-baseline gap-2 cursor-pointer';
      const name = document.createElement('code');
      name.className = 'font-mono text-[10px] text-accent';
      name.textContent = action.name;
      const desc = document.createElement('span');
      desc.className = 'text-[10px] text-base-content/60 flex-1 min-w-0';
      desc.textContent = action.description;
      const target = document.createElement('span');
      target.className = 'font-mono text-[9px] text-base-content/35';
      target.textContent = action.tool;
      const custom = document.createElement('span');
      custom.className = `badge badge-xs font-mono text-[9px] ${action.instruction ? 'badge-info' : 'hidden'}`;
      custom.textContent = 'CUSTOM';
      summary.append(name, desc, target, custom);
      const editor = document.createElement('textarea');
      editor.className = 'textarea textarea-xs w-full mt-2 h-20 font-mono text-[10px]';
      editor.placeholder = `Default: ${action.description}`;
      editor.value = action.instruction;
      editor.addEventListener('input', () => {
        if (!selected) return;
        const all = { ...(settings.actionInstructions || {}) };
        const group = { ...(all[selected] || {}) };
        if (editor.value.trim()) group[action.name] = editor.value;
        else delete group[action.name];
        if (Object.keys(group).length) all[selected] = group;
        else delete all[selected];
        settings = { ...settings, actionInstructions: all };
        action.instruction = editor.value.trim();
        custom.classList.toggle('hidden', !action.instruction);
        setDirty(true);
      });
      row.append(summary, editor);
      actionsHost.append(row);
    }
  }
  setDetailResult(tool.instruction ? 'Custom instructions active.' : 'Using catalog default.');
}

function render(): void {
  renderList();
  renderDetail();
  setDirty(dirty);
}

function selectTool(name: string): void {
  selected = name;
  renderList();
  renderDetail();
}

function setEnabled(name: string, enabled: boolean): void {
  const tool = entry(name);
  if (!tool) return;
  tool.enabled = enabled;
  const disabled = new Set(settings.disabled);
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  settings = { ...settings, disabled: [...disabled] };
  setDirty(true);
  renderList();
  renderDetail();
}

function currentPayload(): Pick<ToolSettings, 'order' | 'disabled' | 'instructions' | 'actionInstructions'> {
  return {
    order: entries.map((tool) => tool.name),
    disabled: settings.disabled,
    instructions: settings.instructions,
    actionInstructions: settings.actionInstructions || {},
  };
}

async function refresh(): Promise<void> {
  try {
    const result = await api?.getToolManager();
    if (!result?.ok || !result.state) {
      showResult('error', result?.errors?.join('; ') || 'Could not load tool settings.');
      return;
    }
    applyState(result.state);
  } catch (error: any) {
    showResult('error', `Could not load tool settings: ${error?.message || error}`);
  }
}

async function save(): Promise<void> {
  const saveButton = byId<HTMLButtonElement>('settings-tools-save');
  if (saveButton) saveButton.disabled = true;
  try {
    const result = await api?.saveToolManager(currentPayload());
    if (!result?.ok || !result.state) {
      showResult('error', result?.errors?.join('; ') || 'Could not save tool settings.');
      return;
    }
    applyState(result.state);
    showResult('success', 'Tool settings saved. Restart MCP clients to apply them.');
  } catch (error: any) {
    showResult('error', `Could not save tool settings: ${error?.message || error}`);
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

async function resetAll(): Promise<void> {
  if (!window.confirm('Reset every tool to its catalog defaults, including order, enabled state and instructions?')) return;
  const result = await api?.resetToolManager();
  if (!result?.ok || !result.state) {
    showResult('error', result?.errors?.join('; ') || 'Could not reset tool settings.');
    return;
  }
  selected = null;
  applyState(result.state);
  showResult('success', 'All tools reset to defaults.');
}

const PRESETS: Record<string, Set<string>> = {
  core: new Set(['navigate', 'observe', 'find', 'act', 'wait_for', 'extract', 'capture', 'evaluate_javascript', 'human_in_loop', 'help']),
  research: new Set(['navigate', 'observe', 'find', 'act', 'wait_for', 'extract', 'capture', 'evaluate_javascript', 'human_in_loop', 'help', 'devtools', 'research', 'memory']),
  automation: new Set(['navigate', 'observe', 'find', 'act', 'wait_for', 'extract', 'capture', 'evaluate_javascript', 'human_in_loop', 'help', 'devtools', 'browser_workspace', 'shadow_iframes']),
};

function applyPreset(name: string): void {
  if (name !== 'full' && !PRESETS[name]) return;
  const preset = name === 'full' ? null : PRESETS[name];
  settings = {
    ...settings,
    disabled: entries.filter((tool) => preset ? !preset.has(tool.name) : false).map((tool) => tool.name),
  };
  for (const tool of entries) tool.enabled = preset ? preset.has(tool.name) : true;
  setDirty(true);
  renderList();
  renderDetail();
  showResult('info', `${name.toUpperCase()} preset applied. Save changes to keep it.`);
}

function resetTool(): void {
  const tool = selected ? entry(selected) : undefined;
  if (!tool) return;
  tool.enabled = true;
  const disabled = new Set(settings.disabled);
  disabled.delete(tool.name);
  const instructions = { ...settings.instructions };
  delete instructions[tool.name];
  const actionInstructions = { ...(settings.actionInstructions || {}) };
  delete actionInstructions[tool.name];
  settings = { ...settings, disabled: [...disabled], instructions, actionInstructions };
  setDirty(true);
  renderList();
  renderDetail();
}

export function initToolsPanel(): void {
  if (initialized) return;
  initialized = true;

  byId<HTMLButtonElement>('settings-tools-save')?.addEventListener('click', () => void save());
  byId<HTMLButtonElement>('settings-tools-reset-all')?.addEventListener('click', () => void resetAll());
  byId<HTMLSelectElement>('settings-tools-preset')?.addEventListener('change', (event) => {
    const target = event.currentTarget as HTMLSelectElement;
    if (target.value) applyPreset(target.value);
    target.value = '';
  });
  byId<HTMLButtonElement>('settings-tools-reset')?.addEventListener('click', resetTool);
  byId<HTMLInputElement>('settings-tools-enabled')?.addEventListener('change', (event) => {
    const target = event.currentTarget as HTMLInputElement;
    if (selected) setEnabled(selected, target.checked);
  });
  byId<HTMLTextAreaElement>('settings-tools-instructions')?.addEventListener('input', (event) => {
    const target = event.currentTarget as HTMLTextAreaElement;
    if (!selected) return;
    const instructions = { ...settings.instructions };
    if (target.value.trim()) instructions[selected] = target.value;
    else delete instructions[selected];
    settings = { ...settings, instructions };
    const tool = entry(selected);
    if (tool) tool.instruction = instructions[selected] || '';
    const chars = byId<HTMLElement>('settings-tools-override-chars');
    if (chars) chars.textContent = instructions[selected] ? `${instructions[selected].length.toLocaleString()} chars` : 'using default';
    setDetailResult(instructions[selected] ? 'Custom instructions active.' : 'Using catalog default.');
    const badge = document.querySelector<HTMLElement>(
      `[data-name="${selected}"] [data-role="custom"]`,
    );
    badge?.classList.toggle('hidden', !instructions[selected]);
    setDirty(true);
  });
}

export function refreshToolsPanel(): void {
  initToolsPanel();
  void refresh();
}
