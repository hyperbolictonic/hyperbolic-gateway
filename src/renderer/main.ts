import type { ElectronAPI } from '../preload/index.js';
import type { ChassisState, HarvestedConstruct, TelemetryEvent } from '../shared/types.js';
import { beginRecording, finishRecording } from './recording';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// UI Elements
const urlForm = document.getElementById('url-form') as HTMLFormElement;
const urlInput = document.getElementById('url-input') as HTMLInputElement;
const viewportUrlDisplay = document.getElementById('viewport-url-display') as HTMLElement;
const viewportLoadingSpinner = document.getElementById('viewport-loading-spinner') as HTMLElement;
const agentStatusBadge = document.getElementById('agent-status-badge') as HTMLElement;
const activeActionText = document.getElementById('active-action-text') as HTMLElement;
const harvestBtn = document.getElementById('harvest-btn') as HTMLButtonElement;
const copyConstructBtn = document.getElementById('copy-construct-btn') as HTMLButtonElement;

// Stat elements
const statCoords = document.getElementById('stat-coords') as HTMLElement;
const statVelocity = document.getElementById('stat-velocity') as HTMLElement;
const statTokens = document.getElementById('stat-tokens') as HTMLElement;
const statInteractions = document.getElementById('stat-interactions') as HTMLElement;

// Tabs
const tabBtnTelemetry = document.getElementById('tab-btn-telemetry') as HTMLButtonElement;
const tabBtnConstruct = document.getElementById('tab-btn-construct') as HTMLButtonElement;
const tabBtnLogs = document.getElementById('tab-btn-logs') as HTMLButtonElement;

const tabContentTelemetry = document.getElementById('tab-content-telemetry') as HTMLElement;
const tabContentConstruct = document.getElementById('tab-content-construct') as HTMLElement;
const tabContentLogs = document.getElementById('tab-content-logs') as HTMLElement;
const tabBtnDecisions = document.getElementById('tab-btn-decisions') as HTMLButtonElement;
const tabContentDecisions = document.getElementById('tab-content-decisions') as HTMLElement;
const decisionFeed = document.getElementById('decision-feed') as HTMLElement;
const decisionCount = document.getElementById('decision-count') as HTMLElement;
const decisionBackendBadge = document.getElementById('decision-backend-badge') as HTMLElement;
let decisionCalls = 0;

// Dynamic Lists & Preview
const telemetryFeed = document.getElementById('telemetry-feed') as HTMLElement;
const telemetryCount = document.getElementById('telemetry-count') as HTMLElement;
const constructCodeBlock = document.getElementById('construct-code-block') as HTMLElement;
const constructTokenBadge = document.getElementById('construct-token-badge') as HTMLElement;
const logsContainer = document.getElementById('logs-container') as HTMLElement;
const logCount = document.getElementById('log-count') as HTMLElement;

// Radar Canvas for Cursor Tracking
const canvas = document.getElementById('radar-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
const cursorTrail: Array<{ x: number; y: number; alpha: number }> = [];

let totalTelemetryPulses = 0;
let totalLogEvents = 0;
let currentConstructMarkdown = '';

function resizeCanvas() {
  if (!canvas || !canvas.parentElement) return;
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

// ---- Native floating Cyberdeck panel ------------------------------------------------------
// The panel is rendered in its own WebContentsView (`?sidebar=1`) so it can sit
// above the native browser view. The main window keeps this DOM copy hidden.
const SIDEBAR_MODE = new URLSearchParams(window.location.search).has('sidebar');
document.documentElement.classList.toggle('sidebar-mode', SIDEBAR_MODE);

const sidebarPanel = document.getElementById('sidebar-panel') as HTMLElement | null;
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn') as HTMLButtonElement | null;
const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn') as HTMLButtonElement | null;
const sidebarDockBtn = document.getElementById('sidebar-dock-btn') as HTMLButtonElement | null;
const sidebarRailToggle = document.getElementById('sidebar-rail-toggle') as HTMLButtonElement | null;
type SidebarMode = 'docked' | 'floating' | 'collapsed';
let currentSidebarMode: SidebarMode = 'floating';

function applySidebarMode(mode: SidebarMode): void {
  currentSidebarMode = mode;
  document.documentElement.classList.toggle('sidebar-collapsed', mode === 'collapsed');
  document.documentElement.classList.toggle('sidebar-docked', mode === 'docked');
  document.documentElement.classList.toggle('sidebar-floating', mode === 'floating');

  // Direct DOM fallback in addition to the CSS mode classes: the native view
  // may receive this before its stylesheet has settled.
  sidebarPanel?.classList.toggle('hidden', mode === 'collapsed');
  if (sidebarRailToggle) {
    sidebarRailToggle.style.display = mode === 'collapsed' ? 'flex' : 'none';
  }

  if (sidebarToggleBtn) {
    sidebarToggleBtn.textContent = mode === 'collapsed' ? '◨' : '◧';
    sidebarToggleBtn.title =
      mode === 'collapsed'
        ? 'Show the floating Cyberdeck panel (Ctrl+Shift+B)'
        : 'Collapse the Cyberdeck panel (Ctrl+Shift+B)';
  }

  if (sidebarDockBtn) {
    sidebarDockBtn.textContent = mode === 'docked' ? 'FLOAT' : 'DOCK';
    sidebarDockBtn.disabled = mode === 'collapsed';
  }
}

function toggleSidebar(): void {
  window.electronAPI?.toggleSidebarMode();
}

sidebarToggleBtn?.addEventListener('click', toggleSidebar);
sidebarCollapseBtn?.addEventListener('click', () => {
  // Apply locally first so the panel gives immediate feedback even if the
  // native bounds update is delayed.
  applySidebarMode('collapsed');
  window.electronAPI?.setSidebarMode('collapsed');
});
sidebarDockBtn?.addEventListener('click', () => {
  const target: SidebarMode = currentSidebarMode === 'docked' ? 'floating' : 'docked';
  applySidebarMode(target);
  window.electronAPI?.setSidebarMode(target);
});
sidebarRailToggle?.addEventListener('click', () => {
  applySidebarMode('floating');
  window.electronAPI?.setSidebarMode('floating');
});
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    toggleSidebar();
  }
});

// Paint the overlay in its intended translucent state before the async mode
// round-trip. If the main process reports docked/collapsed, the response
// replaces this immediately.
if (SIDEBAR_MODE) applySidebarMode('floating');
window.electronAPI?.getSidebarMode().then(applySidebarMode).catch(() => undefined);
window.electronAPI?.onSidebarMode((mode) => applySidebarMode(mode as SidebarMode));
resizeCanvas();

// Render loop for organic Ghost Cursor trail
function renderTrail() {
  if (SIDEBAR_MODE || !ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = cursorTrail.length - 1; i >= 0; i--) {
    const pt = cursorTrail[i];
    pt.alpha -= 0.02;

    if (pt.alpha <= 0) {
      cursorTrail.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 210, 255, ${pt.alpha})`;
    ctx.shadowColor = '#00d2ff';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }

  // Draw connecting line between last points
  if (cursorTrail.length > 1) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cursorTrail[0].x, cursorTrail[0].y);
    for (let i = 1; i < cursorTrail.length; i++) {
      ctx.lineTo(cursorTrail[i].x, cursorTrail[i].y);
    }
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  requestAnimationFrame(renderTrail);
}
requestAnimationFrame(renderTrail);

// Tab switching
function switchTab(activeTab: 'telemetry' | 'construct' | 'logs' | 'decisions') {
  tabBtnTelemetry.classList.toggle('tab-active', activeTab === 'telemetry');
  tabBtnConstruct.classList.toggle('tab-active', activeTab === 'construct');
  tabBtnLogs.classList.toggle('tab-active', activeTab === 'logs');
  tabBtnDecisions.classList.toggle('tab-active', activeTab === 'decisions');

  tabContentTelemetry.classList.toggle('hidden', activeTab !== 'telemetry');
  tabContentConstruct.classList.toggle('hidden', activeTab !== 'construct');
  tabContentLogs.classList.toggle('hidden', activeTab !== 'logs');
  tabContentDecisions.classList.toggle('hidden', activeTab !== 'decisions');

  tabContentConstruct.classList.toggle('flex', activeTab === 'construct');
  tabContentLogs.classList.toggle('flex', activeTab === 'logs');
  tabContentDecisions.classList.toggle('flex', activeTab === 'decisions');
}

tabBtnTelemetry.addEventListener('click', () => switchTab('telemetry'));
tabBtnConstruct.addEventListener('click', () => switchTab('construct'));
tabBtnLogs.addEventListener('click', () => switchTab('logs'));
tabBtnDecisions.addEventListener('click', () => switchTab('decisions'));

// ---- Decision model mirror (tab appears only when a backend is configured) -------------------
let decisionTabActive = false;
function setDecisionTabVisible(visible: boolean, status?: any) {
  tabBtnDecisions.classList.toggle('hidden', !visible);
  decisionBackendBadge.textContent = status?.configured ? `${status.protocol} · ${status.model}` : '—';
  decisionBackendBadge.className = status?.local ? 'badge badge-xs badge-warning' : 'badge badge-xs badge-secondary';

  const tablist = document.querySelector('[role="tablist"]');
  if (visible && tablist && tablist.firstElementChild !== tabBtnDecisions) {
    // First tab while a decision model is active: this is the live view of what it is choosing.
    tablist.prepend(tabBtnDecisions);
  }
  if (visible && !decisionTabActive) {
    decisionTabActive = true;
    switchTab('decisions');
  }
  if (!visible) {
    decisionTabActive = false;
    if (tabBtnDecisions.classList.contains('tab-active')) switchTab('telemetry');
  }
}

async function refreshDecisionTab() {
  try {
    const { status } = await window.electronAPI!.getDecisionSettings();
    setDecisionTabVisible(Boolean(status?.configured), status);
  } catch {
    setDecisionTabVisible(false);
  }
}

const seenDecisions = new Set<string>();
const decisionKey = (event: any) => `${event.ts}|${event.model}|${event.latencyMs}`;

function appendDecision(event: any) {
  const key = decisionKey(event);
  if (seenDecisions.has(key)) return;
  seenDecisions.add(key);

  decisionCalls++;
  decisionCount.textContent = `${decisionCalls} call${decisionCalls === 1 ? '' : 's'}`;
  decisionFeed.querySelector('.italic')?.remove();

  const row = document.createElement('div');
  row.className = `border-l-2 pl-2 py-1 ${event.ok ? 'border-secondary/60' : 'border-error'}`;

  const head = document.createElement('div');
  head.className = 'text-[10px] text-base-content/50';
  head.textContent = `${new Date(event.ts).toLocaleTimeString()} · ${event.protocol || '?'} · ${event.model || '?'} · ${event.latencyMs ?? '?'}ms`;

  const body = document.createElement('div');
  if (event.ok) {
    const parts = Object.entries(event.answers || {}).map(([key, value]: [string, any]) => {
      if (value && typeof value === 'object') {
        if (typeof value.noul === 'number') return `${key}=${value.noul >= 0.5 ? 'yes' : 'no'} (${value.noul.toFixed(2)})`;
        if (value.choice !== undefined) return `${key}=${value.choice} (${Number(value.confidence ?? 0).toFixed(2)})`;
        if (value.score !== undefined) return `${key}=${value.score} ${value.level ?? ''}`;
      }
      return `${key}=${String(value)}`;
    });
    body.textContent = parts.join(' · ') || '(no answers)';
  } else {
    body.className = 'text-error';
    body.textContent = `${event.error?.code || 'ERROR'} — ${event.error?.message || 'no answer'}`;
  }

  const state = document.createElement('div');
  state.className = 'text-[10px] text-base-content/40 truncate';
  state.textContent = event.statePreview || '';

  row.append(head, body, state);
  decisionFeed.prepend(row);
  while (decisionFeed.children.length > 40) decisionFeed.lastElementChild?.remove();

  // A decision just arrived: the backend must be configured, so reveal the tab even if the
  // last visibility check ran before the config existed.
  if (tabBtnDecisions.classList.contains('hidden')) void refreshDecisionTab();
}

window.electronAPI?.onDecision(appendDecision);
window.electronAPI?.onDecisionStatus((status) => {
  setDecisionTabVisible(Boolean(status?.configured), status);
});

// The ring buffer lives in the main process and resets on restart, so re-sync periodically and
// whenever the tab is opened: a decision made before the window loaded still shows up.
async function syncDecisions() {
  try {
    const events = await window.electronAPI!.getDecisions();
    (events || []).forEach(appendDecision);
  } catch {}
  await refreshDecisionTab();
}

tabBtnDecisions.addEventListener('click', () => {
  void syncDecisions();
});

// One-click copy for the HUD panels: selection + Ctrl+C is unreliable when a native menu or the
// browsing view owns focus, and the construct panel already had a COPY button of its own.
const copyLogsBtn = document.getElementById('copy-logs-btn') as HTMLButtonElement | null;
copyLogsBtn?.addEventListener('click', async () => {
  await window.electronAPI?.copyToClipboard(logsContainer.innerText);
  copyLogsBtn.textContent = 'COPIED';
  setTimeout(() => (copyLogsBtn.textContent = 'COPY'), 1200);
});

const copyDecisionsBtn = document.getElementById('copy-decisions-btn') as HTMLButtonElement | null;
copyDecisionsBtn?.addEventListener('click', async () => {
  await window.electronAPI?.copyToClipboard(decisionFeed.innerText);
  copyDecisionsBtn.textContent = 'COPIED';
  setTimeout(() => (copyDecisionsBtn.textContent = 'COPY'), 1200);
});

// The sidebar overlay is a hidden WebContentsView, so gating this on
// document.visibilityState would stop it from ever re-checking the decision
// backend. Keep the poll unconditional; it is one small IPC round-trip.
setInterval(() => {
  void syncDecisions();
}, 8000);

void syncDecisions();
// The sidebar view can load before the decision config probe settles; retry
// once shortly after startup so its DECISIONS tab appears without waiting for
// the next poll interval.
window.setTimeout(() => {
  void refreshDecisionTab();
}, 1500);

// Form Submit (Manual Navigation)
urlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;
  if (window.electronAPI) {
    await window.electronAPI.navigate(url);
  }
});

// Browser history controls: the toolbar buttons, Alt+Left/Right and F5 all funnel into the same
// IPC the MCP navigate_history tool uses.
const navBackBtn = document.getElementById('nav-back-btn') as HTMLButtonElement | null;
const navForwardBtn = document.getElementById('nav-forward-btn') as HTMLButtonElement | null;
const navReloadBtn = document.getElementById('nav-reload-btn') as HTMLButtonElement | null;

navBackBtn?.addEventListener('click', () => {
  void window.electronAPI?.goBack();
});
navForwardBtn?.addEventListener('click', () => {
  void window.electronAPI?.goForward();
});
navReloadBtn?.addEventListener('click', () => {
  void window.electronAPI?.reload();
});

// Harvest Action
harvestBtn.addEventListener('click', async () => {
  if (window.electronAPI) {
    const icon = document.getElementById('harvest-icon');
    const spinner = document.getElementById('harvest-spinner');
    harvestBtn.disabled = true;
    icon?.classList.add('hidden');
    spinner?.classList.remove('hidden');
    try {
      const construct = await window.electronAPI.harvest();
      renderConstruct(construct);
      switchTab('construct');
    } finally {
      harvestBtn.disabled = false;
      spinner?.classList.add('hidden');
      icon?.classList.remove('hidden');
    }
  }
});

// Copy Construct Markdown
copyConstructBtn.addEventListener('click', async () => {
  if (!currentConstructMarkdown) return;
  await navigator.clipboard.writeText(currentConstructMarkdown);
  const prevText = copyConstructBtn.innerText;
  copyConstructBtn.innerText = 'COPIED!';
  setTimeout(() => {
    copyConstructBtn.innerText = prevText;
  }, 1500);
});

// Render Construct Payload
function renderConstruct(construct: HarvestedConstruct) {
  currentConstructMarkdown = construct.content;
  constructCodeBlock.textContent = construct.content;
  constructTokenBadge.textContent = `~${construct.estimatedTokens} tokens (${(construct.markdownLength / 1024).toFixed(1)} KB)`;
}

// Render Telemetry Event
function appendTelemetry(event: TelemetryEvent) {
  totalTelemetryPulses++;
  telemetryCount.textContent = totalTelemetryPulses.toString();

  if (event.x !== undefined && event.y !== undefined) {
    cursorTrail.push({ x: event.x, y: event.y, alpha: 1.0 });
    if (cursorTrail.length > 40) cursorTrail.shift();
    statCoords.textContent = `X: ${event.x} Y: ${event.y}`;
  }

  const item = document.createElement('div');
  item.className = 'flex items-center justify-between bg-base-200 px-2 py-1.5 rounded border border-base-300 text-[10px]';

  let badgeColor = 'badge-neutral';
  if (event.type === 'click') badgeColor = 'badge-primary';
  else if (event.type === 'keystroke') badgeColor = 'badge-secondary';
  else if (event.type === 'scroll') badgeColor = 'badge-accent';

  item.innerHTML = `
    <div class="flex items-center gap-1.5 truncate">
      <span class="badge ${badgeColor} badge-xs font-mono uppercase">${event.type}</span>
      <span class="text-base-content/70 truncate">${event.details || ''}</span>
    </div>
    <span class="opacity-40 shrink-0 font-mono">${new Date(event.timestamp).toLocaleTimeString()}</span>
  `;

  if (telemetryFeed.children.length === 1 && telemetryFeed.firstElementChild?.classList.contains('italic')) {
    telemetryFeed.innerHTML = '';
  }

  telemetryFeed.insertBefore(item, telemetryFeed.firstChild);
  if (telemetryFeed.children.length > 30) {
    telemetryFeed.removeChild(telemetryFeed.lastChild!);
  }
}

// Render Log Event
function appendLog(log: { id: string; time: string; level: 'info' | 'warn' | 'action'; message: string }) {
  totalLogEvents++;
  logCount.textContent = `${totalLogEvents} events`;

  const item = document.createElement('div');
  item.className = 'p-1.5 bg-base-200 rounded border border-base-300 flex items-start gap-2 text-[10px] leading-relaxed';

  let levelBadge = '<span class="badge badge-info badge-xs">INFO</span>';
  if (log.level === 'warn') levelBadge = '<span class="badge badge-warning badge-xs">WARN</span>';
  if (log.level === 'action') levelBadge = '<span class="badge badge-accent badge-xs">ACTION</span>';

  item.innerHTML = `
    <span class="shrink-0 text-base-content/40 font-mono">${log.time}</span>
    ${levelBadge}
    <span class="text-base-content/90 font-mono break-all">${log.message}</span>
  `;

  if (logsContainer.children.length === 1 && logsContainer.firstElementChild?.classList.contains('italic')) {
    logsContainer.innerHTML = '';
  }

  logsContainer.insertBefore(item, logsContainer.firstChild);
}

// Update State from Electron
function updateState(state: ChassisState) {
  viewportUrlDisplay.textContent = state.currentUrl;
  activeActionText.textContent = state.activeAction;
  activeUrl = state.currentUrl;
  activeTitle = state.pageTitle;
  checkCurrentBookmarkState(state.currentUrl);

  // Grey out history buttons the active tab cannot honour, instead of letting a click no-op
  // (Electron's navigationHistory silently returns undefined at either end of the stack).
  if (navBackBtn) navBackBtn.disabled = state.canGoBack !== true;
  if (navForwardBtn) navForwardBtn.disabled = state.canGoForward !== true;

  if (state.isLoading) {
    viewportLoadingSpinner.classList.remove('hidden');
  } else {
    viewportLoadingSpinner.classList.add('hidden');
  }

  // Update Agent Status Badge
  agentStatusBadge.textContent = state.agentStatus;
  agentStatusBadge.className = 'badge badge-sm font-mono tracking-tight';
  switch (state.agentStatus) {
    case 'IDLE':
      agentStatusBadge.classList.add('badge-accent');
      break;
    case 'TRAVERSING':
      agentStatusBadge.classList.add('badge-primary');
      break;
    case 'SIMULATING_INPUT':
      agentStatusBadge.classList.add('badge-secondary');
      break;
    case 'HARVESTING':
      agentStatusBadge.classList.add('badge-info');
      break;
    case 'ERROR':
      agentStatusBadge.classList.add('badge-error');
      break;
    case 'AWAITING_INPUT':
      agentStatusBadge.classList.add('badge-warning', 'animate-pulse');
      break;
    case 'HUMAN_INPUT':
      agentStatusBadge.classList.add('badge-info', 'animate-pulse');
      break;
  }

  // Update Stats
  statTokens.textContent = `${state.stats.tokensHarvested.toLocaleString()} tkn`;
  statInteractions.textContent = `${state.stats.totalInteractions} interactions`;

  if (state.tabs) {
    renderTabs(state.tabs);
  }
}

// Tab Management in Renderer
const tabList = document.getElementById('tab-list') as HTMLElement;
const newTabBtn = document.getElementById('new-tab-btn') as HTMLButtonElement;

function renderTabs(tabs: import('../shared/types.js').TabSummary[]) {
  if (!tabList) return;
  tabList.innerHTML = '';

  tabs.forEach((tab) => {
    const pill = document.createElement('div');
    const isActive = tab.isActive;

    pill.className = `group flex items-center gap-1.5 px-3 py-1 rounded-t-md border-t border-x text-xs font-mono transition-all cursor-pointer select-none max-w-[200px] shrink-0 ${
      isActive
        ? 'bg-base-100 text-accent font-semibold border-base-100 shadow-sm'
        : 'bg-base-300/60 text-base-content/60 hover:bg-base-200 hover:text-base-content border-base-200/40'
    }`;

    // Status dot (pulsing when loading or cyan when active)
    const dot = document.createElement('span');
    dot.className = `w-1.5 h-1.5 rounded-full shrink-0 ${
      tab.isLoading ? 'bg-warning animate-ping' : isActive ? 'bg-accent' : 'bg-base-content/30'
    }`;

    // Title label
    const titleSpan = document.createElement('span');
    titleSpan.className = 'truncate text-[11px] leading-tight flex-1';
    titleSpan.textContent = tab.title || 'New Tab';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'opacity-30 group-hover:opacity-100 hover:text-error text-[10px] ml-1 p-0.5 rounded leading-none';
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'Close tab';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.electronAPI?.closeTab(tab.id);
    });

    pill.appendChild(dot);
    pill.appendChild(titleSpan);
    pill.appendChild(closeBtn);

    pill.addEventListener('click', () => {
      if (!tab.isActive) {
        window.electronAPI?.switchTab(tab.id);
      }
    });

    tabList.appendChild(pill);
  });
}

if (newTabBtn) {
  newTabBtn.addEventListener('click', () => {
    window.electronAPI?.createTab('https://news.ycombinator.com');
  });
}

// Initialize IPC listeners
if (window.electronAPI) {
  window.electronAPI.getState().then(updateState);
  window.electronAPI.getTabs().then(renderTabs);
  window.electronAPI.getLatestConstruct().then((construct) => {
    if (construct) renderConstruct(construct);
  });
  window.electronAPI.getLogs().then((logs) => {
    logs.forEach(appendLog);
  });

  window.electronAPI.onStateUpdated(updateState);
  window.electronAPI.onTabsUpdated(renderTabs);
  window.electronAPI.onTelemetry(appendTelemetry);
  window.electronAPI.onConstructHarvested(renderConstruct);
  window.electronAPI.onLog(appendLog);
  window.electronAPI.onHilRequested(showHilBanner);
  window.electronAPI.onHilCleared(removeHilBanner);

  // Check if HIL request is already active on load
  window.electronAPI.getActiveHil().then((active) => {
    if (active) showHilBanner(active);
  });
}

function showHilBanner(req: { id: string; reason: string }) {
  removeHilBanner();
  const banner = document.createElement('div');
  banner.id = 'hud-hil-banner';
  // Anchored to the side panel (right), not across the middle: a human is being asked to act in
  // the *browser*, so the notice must not cover the thing they need to look at.
  banner.className =
    'alert alert-warning shadow-2xl fixed bottom-10 right-3 z-50 w-[min(420px,calc(100vw-1.5rem))] flex items-center justify-between border-2 border-warning font-mono text-xs';

  // Built with textContent, never innerHTML: `reason` can quote page copy (the sensitive-gate rule
  // puts matched lines in it), and page copy is attacker-controlled.
  const wrap = document.createElement('div');
  wrap.className = 'flex items-center gap-2';
  const icon = document.createElement('span');
  icon.className = 'text-base';
  icon.textContent = '⚠️';
  const col = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'font-bold text-[10px] uppercase tracking-wider text-warning-content';
  title.textContent = 'Human Action Needed';
  const reason = document.createElement('div');
  reason.className = 'text-xs text-base-content';
  reason.textContent = req.reason;
  col.append(title, reason);
  wrap.append(icon, col);

  const btn = document.createElement('button');
  btn.id = 'hud-hil-resolve-btn';
  btn.className = 'btn btn-xs btn-success font-mono font-bold ml-4';
  btn.textContent = 'DONE';

  banner.append(wrap, btn);
  document.body.appendChild(banner);

  btn.addEventListener('click', async () => {
    btn.textContent = 'RESUMING...';
    await window.electronAPI.resolveHil(req.id, 'User clicked DONE in Cyberdeck HUD');
    removeHilBanner();
  });
}

function removeHilBanner() {
  const b = document.getElementById('hud-hil-banner');
  if (b) b.remove();
}

// Keyboard shortcuts (Ctrl+H to harvest). The sidebar overlay renderer is a
// passive surface; it must not trigger browser actions while a human clicks a
// tab there.
window.addEventListener('keydown', (e) => {
  if (SIDEBAR_MODE) return;
  if (e.ctrlKey && e.key.toLowerCase() === 'h') {
    e.preventDefault();
    harvestBtn.click();
  }
  // Browser muscle memory. The browsing view owns focus most of the time, so these only fire when
  // the app shell has focus; the same actions are in the right-click menu on the page itself.
  if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    void window.electronAPI?.goBack();
  }
  if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    void window.electronAPI?.goForward();
  }
  if (e.key === 'F5') {
    e.preventDefault();
    void window.electronAPI?.reload();
  }
});

// ---- Timelapse recorder (Settings → Recording, or the REC button) ---------------------------
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement | null;
const recordLabel = document.getElementById('record-label') as HTMLElement | null;
const recordDot = document.getElementById('record-dot') as HTMLElement | null;
const settingsRecStatus = document.getElementById('settings-rec-status') as HTMLElement | null;
const settingsRecList = document.getElementById('settings-rec-list') as HTMLElement | null;
const settingsRecForm = document.getElementById('settings-rec-form') as HTMLFormElement | null;
const settingsRecEnabled = document.getElementById('settings-rec-enabled') as HTMLInputElement | null;
const settingsRecTools = document.getElementById('settings-rec-tools') as HTMLInputElement | null;
const settingsRecDir = document.getElementById('settings-rec-dir') as HTMLInputElement | null;
const settingsRecInterval = document.getElementById('settings-rec-interval') as HTMLInputElement | null;
const settingsRecFps = document.getElementById('settings-rec-fps') as HTMLInputElement | null;
const settingsRecWidth = document.getElementById('settings-rec-width') as HTMLInputElement | null;
const settingsRecBitrate = document.getElementById('settings-rec-bitrate') as HTMLInputElement | null;
const settingsRecResult = document.getElementById('settings-rec-result') as HTMLElement | null;
const settingsRecRefresh = document.getElementById('settings-rec-refresh') as HTMLButtonElement | null;
const settingsRecBrowse = document.getElementById('settings-rec-browse') as HTMLButtonElement | null;

let lastRecordingStatus: any = { recording: false, enabled: true };
let recordTicker: number | null = null;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function showRecResult(kind: 'success' | 'error' | 'info', text: string) {
  if (!settingsRecResult) return;
  settingsRecResult.className = `alert alert-${kind} alert-sm font-mono text-xs`;
  settingsRecResult.textContent = text;
}

function stopRecordTicker() {
  if (recordTicker !== null) {
    window.clearInterval(recordTicker);
    recordTicker = null;
  }
}

function applyRecordingStatus(state: any) {
  if (!state) return;
  lastRecordingStatus = state;
  const recording = Boolean(state.recording);
  const enabled = state.enabled !== false;

  if (recordDot) {
    recordDot.className = recording
      ? 'text-error animate-pulse'
      : enabled
        ? 'text-error/60'
        : 'text-base-content/30';
  }
  if (recordBtn) {
    recordBtn.classList.toggle('btn-error', recording);
    recordBtn.classList.toggle('btn-ghost', !recording);
    recordBtn.classList.toggle('opacity-50', !enabled && !recording);
    // The toolbar button is icon-only now, so the label lives in the tooltip instead of a native
    // title (which would render a second, delayed tooltip on top of the daisyUI one).
    recordBtn.removeAttribute('title');
  }
  const recordTooltip = document.getElementById('record-tooltip');
  if (recordTooltip) {
    recordTooltip.dataset.tip = recording
      ? `Stop and save the timelapse · ${formatElapsed(Date.now() - (state.startedAt || Date.now()))}`
      : enabled
        ? 'Record a timelapse of this window'
        : 'Recording is disabled — open Settings → Recording';
  }
  if (recordLabel) {
    recordLabel.textContent = recording ? `STOP · ${formatElapsed(Date.now() - (state.startedAt || Date.now()))}` : 'REC';
  }
  if (settingsRecStatus) {
    if (recording) {
      settingsRecStatus.className = 'badge badge-error font-mono text-xs whitespace-nowrap';
      settingsRecStatus.textContent = `recording · ${formatElapsed(Date.now() - (state.startedAt || Date.now()))}`;
    } else if (state.error) {
      settingsRecStatus.className = 'badge badge-warning font-mono text-xs whitespace-nowrap';
      settingsRecStatus.textContent = 'error';
      settingsRecStatus.title = state.error;
    } else {
      settingsRecStatus.className = 'badge badge-ghost font-mono text-xs whitespace-nowrap';
      settingsRecStatus.textContent = enabled ? 'idle' : 'disabled';
      settingsRecStatus.title = '';
    }
  }

  if (state.error && !recording) {
    if (recordTooltip) recordTooltip.dataset.tip = `Recording failed: ${state.error}`;
    if (settingsRecResult) showRecResult('error', state.error);
  }

  stopRecordTicker();
  if (recording) {
    recordTicker = window.setInterval(() => {
      if (!lastRecordingStatus?.recording) {
        stopRecordTicker();
        return;
      }
      const elapsed = formatElapsed(Date.now() - (lastRecordingStatus.startedAt || Date.now()));
      if (recordLabel) recordLabel.textContent = `STOP · ${elapsed}`;
      if (settingsRecStatus) settingsRecStatus.textContent = `recording · ${elapsed}`;
    }, 1000);
  }
}

function openSettingsTab(tab: 'decision' | 'recording') {
  settingsBtn?.click();
  document.querySelector<HTMLButtonElement>(`[data-settings-tab="${tab}"]`)?.click();
}

async function refreshRecordingList() {
  if (!settingsRecList) return;
  const items = await window.electronAPI!.listRecordings();
  settingsRecList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'font-mono text-[11px] text-base-content/50';
    empty.textContent = 'No timelapses yet.';
    settingsRecList.append(empty);
    return;
  }
  for (const item of items.slice(0, 12)) {
    const row = document.createElement('li');
    row.className = 'flex items-center gap-2 bg-base-200/60 border border-base-100 rounded px-2 py-1.5';

    const name = document.createElement('span');
    name.className = 'font-mono text-[11px] text-base-content/80 whitespace-nowrap';
    name.textContent = item.filename;

    const size = document.createElement('span');
    size.className = 'font-mono text-[10px] text-base-content/40 whitespace-nowrap';
    size.textContent = `${(item.bytes / 1024 / 1024).toFixed(1)} MB`;

    const fullPath = document.createElement('span');
    fullPath.className = 'flex-1 font-mono text-[10px] text-base-content/50 truncate';
    fullPath.textContent = item.path;
    fullPath.title = item.path;

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-xs btn-ghost font-mono text-[10px]';
    copy.textContent = 'COPY PATH';
    copy.addEventListener('click', async () => {
      await window.electronAPI?.copyToClipboard(item.path);
      copy.textContent = 'COPIED';
      window.setTimeout(() => (copy.textContent = 'COPY PATH'), 1500);
    });

    row.append(name, size, fullPath, copy);
    settingsRecList.append(row);
  }
}

async function loadRecordingSettings() {
  try {
    const config = await window.electronAPI!.getRecordingConfig();
    if (settingsRecEnabled) settingsRecEnabled.checked = Boolean(config.enabled);
    if (settingsRecTools) settingsRecTools.checked = config.toolsEnabled !== false;
    if (settingsRecDir) settingsRecDir.value = config.outputDir || '';
    if (settingsRecInterval) settingsRecInterval.value = String(config.intervalMs);
    if (settingsRecFps) settingsRecFps.value = String(config.fps);
    if (settingsRecWidth) settingsRecWidth.value = String(config.maxWidth);
    if (settingsRecBitrate) settingsRecBitrate.value = (config.bitrate / 1_000_000).toFixed(1);
    applyRecordingStatus(await window.electronAPI!.getRecordingStatus());
    await refreshRecordingList();
  } catch (err: any) {
    showRecResult('error', `Could not read recording settings: ${err?.message || err}`);
  }
}

recordBtn?.addEventListener('click', async () => {
  if (!recordBtn) return;
  recordBtn.disabled = true;
  try {
    const status = await window.electronAPI!.getRecordingStatus();
    if (status.recording) {
      if (recordLabel) recordLabel.textContent = 'SAVING…';
      const result = await window.electronAPI!.stopRecording();
      if (result?.path) {
        showRecResult('success', `Saved ${result.path}`);
        await refreshRecordingList();
      }
    } else if (status.enabled === false) {
      openSettingsTab('recording');
      showRecResult('info', 'Recording is disabled — enable it here first.');
    } else {
      await window.electronAPI!.startRecording();
    }
  } catch (err: any) {
    const message = String(err?.message || err);
    const tip = document.getElementById('record-tooltip');
    if (tip) tip.dataset.tip = `Recording failed: ${message}`;
    showRecResult('error', message);
  } finally {
    recordBtn.disabled = false;
    try {
      applyRecordingStatus(await window.electronAPI!.getRecordingStatus());
    } catch {
      // The status poll is best-effort.
    }
  }
});

settingsRecBrowse?.addEventListener('click', async () => {
  const dir = await window.electronAPI!.pickRecordingDir();
  if (dir && settingsRecDir) settingsRecDir.value = dir;
});

settingsRecRefresh?.addEventListener('click', () => void refreshRecordingList());

settingsRecForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const saved = await window.electronAPI!.saveRecordingConfig({
      enabled: settingsRecEnabled?.checked !== false,
      toolsEnabled: settingsRecTools?.checked !== false,
      outputDir: settingsRecDir?.value.trim(),
      intervalMs: Number(settingsRecInterval?.value),
      fps: Number(settingsRecFps?.value),
      maxWidth: Number(settingsRecWidth?.value),
      bitrate: Math.round(Number(settingsRecBitrate?.value) * 1_000_000),
    });
    if (settingsRecDir) settingsRecDir.value = saved.outputDir;
    applyRecordingStatus({ ...lastRecordingStatus, enabled: saved.enabled });
    showRecResult('success', `Saved. Timelapses are written to ${saved.outputDir}.`);
    await refreshRecordingList();
  } catch (err: any) {
    showRecResult('error', `Save failed: ${err?.message || err}`);
  }
});

window.electronAPI?.onRecordingBegin((payload) => {
  void beginRecording(payload).catch((err) => window.electronAPI?.recordingFailed?.(String(err?.message || err)));
});
window.electronAPI?.onRecordingStop(() => {
  void finishRecording();
});
window.electronAPI?.onRecordingStatus((state) => applyRecordingStatus(state));
void window.electronAPI?.getRecordingStatus().then(applyRecordingStatus).catch(() => undefined);

// Settings Modal — decision model + recording (full viewport, tabbed)
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement | null;
const settingsModal = document.getElementById('settings-modal') as HTMLDialogElement | null;

if (settingsBtn && settingsModal) {
  const protocolEl = document.getElementById('settings-protocol') as HTMLSelectElement;
  const modelEl = document.getElementById('settings-model') as HTMLInputElement;
  const urlEl = document.getElementById('settings-url') as HTMLInputElement;
  const keyEl = document.getElementById('settings-key') as HTMLInputElement;
  const revisionEl = document.getElementById('settings-revision') as HTMLInputElement;
  const deviceEl = document.getElementById('settings-device') as HTMLSelectElement;
  const badgeEl = document.getElementById('settings-status-badge') as HTMLElement;
  const formEl = document.getElementById('settings-form') as HTMLFormElement;
  const testBtn = document.getElementById('settings-test-btn') as HTMLButtonElement;
  const closeBtn = document.getElementById('settings-close-btn') as HTMLButtonElement;
  const resultEl = document.getElementById('settings-test-result') as HTMLElement;
  const settingsTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-settings-tab]'));
  const settingsPanels = Array.from(document.querySelectorAll<HTMLElement>('[data-settings-panel]'));

  // Research / stealth settings.
  const researchFormEl = document.getElementById('settings-research-form') as HTMLFormElement;
  const researchEnabledEl = document.getElementById('settings-research-enabled') as HTMLInputElement;
  const researchEnginesEl = document.getElementById('settings-research-engines') as HTMLInputElement;
  const researchUrlTemplateEl = document.getElementById('settings-research-url-template') as HTMLInputElement;
  const researchProxyEl = document.getElementById('settings-research-proxy') as HTMLInputElement;
  const researchCooldownEl = document.getElementById('settings-research-cooldown') as HTMLInputElement;
  const researchDelayEl = document.getElementById('settings-research-delay') as HTMLInputElement;
  const researchConcurrencyEl = document.getElementById('settings-research-concurrency') as HTMLInputElement;
  const researchPreferLlmEl = document.getElementById('settings-research-prefer-llm') as HTMLInputElement;
  const researchMaxPagesEl = document.getElementById('settings-research-max-pages') as HTMLInputElement;
  const researchMaxSourcesEl = document.getElementById('settings-research-max-sources') as HTMLInputElement;
  const researchMaxResultsEl = document.getElementById('settings-research-max-results') as HTMLInputElement;
  const researchActivateEl = document.getElementById('settings-research-activate-view') as HTMLInputElement;
  const researchResultEl = document.getElementById('settings-research-result') as HTMLElement;
  const researchResetEl = document.getElementById('settings-research-reset') as HTMLButtonElement;

  // Shadow Walk settings.
  const shadowFormEl = document.getElementById('settings-shadow-form') as HTMLFormElement;
  const shadowEnabledEl = document.getElementById('shadow-enabled') as HTMLInputElement;
  const shadowAxSealedEl = document.getElementById('shadow-ax-sealed') as HTMLInputElement;
  const shadowDeepOpenEl = document.getElementById('shadow-deep-open') as HTMLInputElement;
  const shadowTabWalkEl = document.getElementById('shadow-tab-walk') as HTMLInputElement;
  const shadowTabStepsEl = document.getElementById('shadow-tab-steps') as HTMLInputElement;
  const shadowTabRestoreEl = document.getElementById('shadow-tab-restore') as HTMLInputElement;
  const shadowFrameGeometryEl = document.getElementById('shadow-frame-geometry') as HTMLInputElement;
  const shadowFrameControlsEl = document.getElementById('shadow-frame-controls') as HTMLInputElement;
  const shadowFrameScreenshotsEl = document.getElementById('shadow-frame-screenshots') as HTMLInputElement;
  const shadowMaxFramesEl = document.getElementById('shadow-max-frames') as HTMLInputElement;
  const shadowMaxControlsEl = document.getElementById('shadow-max-controls') as HTMLInputElement;
  const shadowShotSideEl = document.getElementById('shadow-shot-side') as HTMLInputElement;
  const shadowResetEl = document.getElementById('settings-shadow-reset') as HTMLButtonElement;
  const shadowResultEl = document.getElementById('settings-shadow-result') as HTMLElement;
  let shadowLoaded: any = null;

  const showShadowResult = (kind: 'success' | 'error' | 'info', text: string) => {
    shadowResultEl.className = `alert alert-${kind} alert-sm font-mono text-xs`;
    shadowResultEl.textContent = text;
    shadowResultEl.classList.remove('hidden');
  };

  async function loadShadowWalkSettings(): Promise<void> {
    try {
      const settings = await window.electronAPI?.getShadowWalkSettings();
      if (!settings) return;
      shadowLoaded = settings;
      shadowEnabledEl.checked = settings.enabled !== false;
      shadowAxSealedEl.checked = settings.shadow?.axSealed !== false;
      shadowDeepOpenEl.checked = settings.shadow?.deepOpenRoots !== false;
      shadowTabWalkEl.checked = settings.shadow?.tabWalk !== false;
      shadowTabStepsEl.value = String(settings.shadow?.tabWalkMaxSteps ?? 8);
      shadowTabRestoreEl.checked = settings.shadow?.tabWalkRestoreFocus !== false;
      shadowFrameGeometryEl.checked = settings.frames?.geometry !== false;
      shadowFrameControlsEl.checked = settings.frames?.controls !== false;
      shadowFrameScreenshotsEl.checked = settings.frames?.screenshots !== false;
      shadowMaxFramesEl.value = String(settings.frames?.maxFrames ?? 6);
      shadowMaxControlsEl.value = String(settings.frames?.maxControls ?? 40);
      shadowShotSideEl.value = String(settings.frames?.screenshotMaxSide ?? 1024);
    } catch (err: any) {
      showShadowResult('error', `Could not load Shadow Walk settings: ${err?.message || err}`);
    }
  }

  shadowFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = shadowFormEl.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.classList.add('loading');
    }
    try {
      const base = shadowLoaded || {};
      const result = await window.electronAPI?.saveShadowWalkSettings({
        enabled: shadowEnabledEl.checked,
        shadow: {
          ...(base.shadow || {}),
          deepOpenRoots: shadowDeepOpenEl.checked,
          axSealed: shadowAxSealedEl.checked,
          tabWalk: shadowTabWalkEl.checked,
          tabWalkMaxSteps: Number(shadowTabStepsEl.value) || 8,
          tabWalkRestoreFocus: shadowTabRestoreEl.checked,
        },
        frames: {
          ...(base.frames || {}),
          geometry: shadowFrameGeometryEl.checked,
          controls: shadowFrameControlsEl.checked,
          screenshots: shadowFrameScreenshotsEl.checked,
          maxFrames: Number(shadowMaxFramesEl.value) || 6,
          maxControls: Number(shadowMaxControlsEl.value) || 40,
          screenshotMaxSide: Number(shadowShotSideEl.value) || 1024,
        },
        cloneLab: base.cloneLab || { enabled: false },
      });
      if (result?.ok) {
        shadowLoaded = result.settings;
        showShadowResult('success', 'Shadow Walk settings saved. They apply to the next MCP call.');
      } else {
        showShadowResult('error', (result?.errors || []).join('; ') || 'Save failed.');
      }
    } catch (err: any) {
      showShadowResult('error', `Save failed: ${err?.message || err}`);
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('loading');
      }
    }
  });

  shadowResetEl.addEventListener('click', async () => {
    try {
      const result = await window.electronAPI?.resetShadowWalkSettings();
      if (result?.ok) {
        await loadShadowWalkSettings();
        showShadowResult('success', 'Shadow Walk defaults restored.');
      } else {
        showShadowResult('error', (result?.errors || []).join('; ') || 'Reset failed.');
      }
    } catch (err: any) {
      showShadowResult('error', `Reset failed: ${err?.message || err}`);
    }
  });

  const showResearchResult = (kind: 'success' | 'error' | 'info', text: string) => {
    researchResultEl.className = `alert alert-${kind} alert-sm font-mono text-xs`;
    researchResultEl.textContent = text;
    researchResultEl.classList.remove('hidden');
  };

  async function loadResearchSettings(): Promise<void> {
    try {
      const settings = await window.electronAPI?.getResearchSettings();
      if (!settings) return;
      researchEnabledEl.checked = Boolean(settings.enabled);
      researchEnginesEl.value = Array.isArray(settings.engineChain) ? settings.engineChain.join(', ') : '';
      researchUrlTemplateEl.value = settings.urlTemplate || '';
      researchProxyEl.value = settings.proxyUrl || '';
      researchCooldownEl.value = String(settings.domainCooldownSec ?? 300);
      researchDelayEl.value = String(settings.delayMs ?? 1000);
      researchConcurrencyEl.value = String(settings.crawlConcurrency ?? 1);
      researchPreferLlmEl.checked = settings.preferLlm !== false;
      researchMaxPagesEl.value = String(settings.defaultMaxPages ?? 5);
      researchMaxSourcesEl.value = String(settings.defaultMaxSources ?? 5);
      researchMaxResultsEl.value = String(settings.searchMaxResults ?? 8);
      researchActivateEl.checked = settings.activateView !== false;
    } catch (err: any) {
      showResearchResult('error', `Could not load research settings: ${err?.message || err}`);
    }
  }

  researchFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = researchFormEl.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.classList.add('loading');
    }
    try {
      const result = await window.electronAPI?.saveResearchSettings({
        enabled: researchEnabledEl.checked,
        engineChain: researchEnginesEl.value,
        urlTemplate: researchUrlTemplateEl.value.trim(),
        proxyUrl: researchProxyEl.value.trim(),
        domainCooldownSec: Number(researchCooldownEl.value) || 300,
        delayMs: Number(researchDelayEl.value) || 0,
        crawlConcurrency: Number(researchConcurrencyEl.value) || 1,
        preferLlm: researchPreferLlmEl.checked,
        defaultMaxPages: Number(researchMaxPagesEl.value) || 5,
        defaultMaxSources: Number(researchMaxSourcesEl.value) || 5,
        searchMaxResults: Number(researchMaxResultsEl.value) || 8,
        activateView: researchActivateEl.checked,
      });
      if (result?.ok) {
        showResearchResult('success', 'Research stealth settings saved. They apply to the next search/crawl.');
        await loadResearchSettings();
      } else {
        showResearchResult('error', (result?.errors || []).join('; ') || 'Save failed.');
      }
    } catch (err: any) {
      showResearchResult('error', `Save failed: ${err?.message || err}`);
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('loading');
      }
    }
  });

  researchResetEl.addEventListener('click', async () => {
    if (!window.confirm('Clear research cookies, cache, and domain cooldowns?')) return;
    try {
      const result = await window.electronAPI?.resetResearchSession();
      showResearchResult(result?.ok ? 'success' : 'error', result?.ok ? 'Research session cleared.' : result?.error || 'Reset failed.');
    } catch (err: any) {
      showResearchResult('error', `Reset failed: ${err?.message || err}`);
    }
  });

  // Kuang Wrap secrets: write-only from this panel.
  const wrapWarningEl = document.getElementById('settings-wrap-warning') as HTMLElement;
  const wrapFormEl = document.getElementById('settings-wrap-secret-form') as HTMLFormElement;
  const wrapNameEl = document.getElementById('settings-wrap-name') as HTMLInputElement;
  const wrapHeaderEl = document.getElementById('settings-wrap-header') as HTMLInputElement;
  const wrapValueEl = document.getElementById('settings-wrap-value') as HTMLInputElement;
  const wrapHostsEl = document.getElementById('settings-wrap-hosts') as HTMLInputElement;
  const wrapPrefixEl = document.getElementById('settings-wrap-prefix') as HTMLInputElement;
  const wrapKindEl = document.getElementById('settings-wrap-kind') as HTMLSelectElement;
  const wrapOAuthEl = document.getElementById('settings-wrap-oauth') as HTMLElement;
  const wrapTokenUrlEl = document.getElementById('settings-wrap-token-url') as HTMLInputElement;
  const wrapClientIdEl = document.getElementById('settings-wrap-client-id') as HTMLInputElement;
  const wrapScopeEl = document.getElementById('settings-wrap-scope') as HTMLInputElement;
  const wrapResultEl = document.getElementById('settings-wrap-result') as HTMLElement;
  const wrapRefreshEl = document.getElementById('settings-wrap-refresh') as HTMLButtonElement;
  const wrapSaveEl = document.querySelector<HTMLButtonElement>('#settings-wrap-secret-form button[type="submit"]');
  const wrapListEl = document.getElementById('settings-wrap-secret-list') as HTMLElement;
  const wrapCancelEditEl = document.getElementById('settings-wrap-cancel-edit') as HTMLButtonElement;

  const wrapSubTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-wrap-tab]'));
  const wrapSubPanels = Array.from(document.querySelectorAll<HTMLElement>('[data-wrap-panel]'));

  const wrapWrapperModalEl = document.getElementById('wrap-wrapper-modal') as HTMLDialogElement;
  const wrapWrapperCloseEl = document.getElementById('settings-wrap-wrapper-close') as HTMLButtonElement;
  const wrapWrapperCancelEl = document.getElementById('settings-wrap-wrapper-cancel') as HTMLButtonElement;
  const wrapWrapperListEl = document.getElementById('settings-wrap-wrapper-list') as HTMLElement;
  const wrapWrapperFilterEl = document.getElementById('settings-wrap-wrapper-filter') as HTMLInputElement;
  const wrapWrapperHeadingEl = document.getElementById('settings-wrap-wrapper-heading') as HTMLElement;
  const wrapWrapperTitleEl = document.getElementById('settings-wrap-wrapper-title') as HTMLElement;
  const wrapWrapperBadgeEl = document.getElementById('settings-wrap-wrapper-badge') as HTMLElement;
  const wrapWrapperFormEl = document.getElementById('settings-wrap-wrapper-form') as HTMLFormElement;
  const wrapWrapperResultEl = document.getElementById('settings-wrap-wrapper-result') as HTMLElement;
  const wrapWrapperSaveEl = document.getElementById('settings-wrap-wrapper-save') as HTMLButtonElement;
  const wrapWrapperDeleteEl = document.getElementById('settings-wrap-wrapper-delete') as HTMLButtonElement;
  const wrapWrapperNewEl = document.getElementById('settings-wrap-wrapper-new') as HTMLButtonElement;
  const wrapWrapperRefreshEl = document.getElementById('settings-wrap-wrapper-refresh') as HTMLButtonElement;

  const wrapFieldNameEl = document.getElementById('settings-wrap-field-name') as HTMLInputElement;
  const wrapFieldIdEl = document.getElementById('settings-wrap-field-id') as HTMLInputElement;
  const wrapFieldDescriptionEl = document.getElementById('settings-wrap-field-description') as HTMLInputElement;
  const wrapFieldMethodEl = document.getElementById('settings-wrap-field-method') as HTMLSelectElement;
  const wrapFieldUrlEl = document.getElementById('settings-wrap-field-url') as HTMLInputElement;
  const wrapFieldAuthEl = document.getElementById('settings-wrap-field-auth') as HTMLSelectElement;
  const wrapFieldMutatingEl = document.getElementById('settings-wrap-field-mutating') as HTMLInputElement;
  const wrapCredentialPanelEl = document.getElementById('settings-wrap-credential-panel') as HTMLElement;
  const wrapCredentialNameEl = document.getElementById('settings-wrap-credential-name') as HTMLInputElement;
  const wrapCredentialValueEl = document.getElementById('settings-wrap-credential-value') as HTMLInputElement;
  const wrapCredentialHostsEl = document.getElementById('settings-wrap-credential-hosts') as HTMLInputElement;
  const wrapCredentialHeaderEl = document.getElementById('settings-wrap-credential-header') as HTMLInputElement;
  const wrapCredentialPrefixEl = document.getElementById('settings-wrap-credential-prefix') as HTMLInputElement;
  const wrapFieldInputSchemaEl = document.getElementById('settings-wrap-field-input-schema') as HTMLTextAreaElement;
  const wrapFieldQueryEl = document.getElementById('settings-wrap-field-query') as HTMLTextAreaElement;
  const wrapFieldHeadersEl = document.getElementById('settings-wrap-field-headers') as HTMLTextAreaElement;
  const wrapFieldBodyEl = document.getElementById('settings-wrap-field-body') as HTMLTextAreaElement;
  const wrapFieldBodyFormatEl = document.getElementById('settings-wrap-field-body-format') as HTMLSelectElement;
  const wrapFieldResponseEl = document.getElementById('settings-wrap-field-response') as HTMLTextAreaElement;
  const wrapFieldNotesEl = document.getElementById('settings-wrap-field-notes') as HTMLInputElement;

  let wrapSecretsAvailable = true;
  let wrapWrappers: any[] = [];
  let wrapSecretNames: string[] = [];
  let selectedWrapperId: string | null = null;
  let editingSecretName: string | null = null;
  let wrapperIdTouched = false;

  const DEFAULT_INPUT_SCHEMA = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };

  const showWrapResult = (kind: 'success' | 'error' | 'info', text: string) => {
    wrapResultEl.className = `alert alert-${kind} alert-sm font-mono text-xs`;
    wrapResultEl.textContent = text;
    wrapResultEl.classList.remove('hidden');
  };

  /** Show the OAuth2 fields only when that credential type is selected. */
  const syncWrapKind = () => {
    const oauth = wrapKindEl.value === 'oauth2';
    wrapOAuthEl.classList.toggle('hidden', !oauth);
    wrapValueEl.placeholder = oauth
      ? 'client secret; it is never shown again'
      : 'paste the credential; it is never shown again';
  };

  const showWrapperResult = (kind: 'success' | 'error' | 'info', text: string) => {
    wrapWrapperResultEl.className = `alert alert-${kind} alert-sm font-mono text-xs mt-2`;
    wrapWrapperResultEl.textContent = text;
    wrapWrapperResultEl.classList.remove('hidden');
  };

  function renderWrapWrappers(): void {
    wrapWrapperListEl.replaceChildren();
    const query = wrapWrapperFilterEl.value.trim().toLowerCase();
    const visible = query
      ? wrapWrappers.filter((wrapper) =>
          `${wrapper.id} ${wrapper.name} ${safeHostLabel(wrapper.request?.url)}`.toLowerCase().includes(query),
        )
      : wrapWrappers;

    if (!visible.length) {
      const empty = document.createElement('li');
      empty.className = 'font-mono text-[11px] text-base-content/50 px-1 py-2';
      empty.textContent = wrapWrappers.length
        ? 'No wrappers match that filter.'
        : 'No wrappers saved. Press NEW or ask an agent to create one.';
      wrapWrapperListEl.append(empty);
      return;
    }

    for (const wrapper of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className =
        'w-full text-left rounded-box border px-3 py-2 transition-colors ' +
        (wrapper.id === selectedWrapperId
          ? 'border-primary bg-primary/10'
          : 'border-base-100 bg-base-200/60 hover:bg-base-200');
      const id = document.createElement('div');
      id.className = 'font-mono text-xs text-base-content truncate';
      id.textContent = wrapper.id;
      const meta = document.createElement('div');
      meta.className = 'font-mono text-[10px] text-base-content/50 truncate';
      meta.textContent = `${wrapper.name} · ${wrapper.request?.method || 'GET'} ${safeHostLabel(wrapper.request?.url)}`;
      button.append(id, meta);
      button.addEventListener('click', () => selectWrapWrapper(wrapper.id));
      wrapWrapperListEl.append(button);
    }
  }

  function safeHostLabel(url: unknown): string {
    try {
      return new URL(String(url || '')).host;
    } catch {
      return String(url || '');
    }
  }

  function openWrapWrapperModal(): void {
    if (!wrapWrapperModalEl.open) wrapWrapperModalEl.showModal();
  }

  function slugifyWrapperId(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[^a-z]+/, '')
      .replace(/[._-]{2,}/g, '-')
      .replace(/[._-]+$/g, '')
      .slice(0, 80);
  }

  function hostFromUrl(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  function prettyJson(value: unknown): string {
    return value === undefined ? '' : JSON.stringify(value, null, 2);
  }

  function populateAuthOptions(selected?: string): void {
    const current = selected !== undefined ? selected : wrapFieldAuthEl.value;
    const names = [...wrapSecretNames];
    if (current && current !== '__new__' && !names.includes(current)) names.unshift(current);

    wrapFieldAuthEl.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No credential';
    wrapFieldAuthEl.append(none);

    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = wrapSecretNames.includes(name) ? name : `${name} (missing)`;
      wrapFieldAuthEl.append(option);
    }

    const add = document.createElement('option');
    add.value = '__new__';
    add.textContent = '+ New credential…';
    wrapFieldAuthEl.append(add);

    wrapFieldAuthEl.value =
      current === '__new__' || current === '' || names.includes(current) ? current : '';
    updateCredentialPanel();
  }

  function updateCredentialPanel(): void {
    const isNew = wrapFieldAuthEl.value === '__new__';
    wrapCredentialPanelEl.classList.toggle('hidden', !isNew);
    if (isNew && !wrapCredentialHostsEl.value) {
      const host = hostFromUrl(wrapFieldUrlEl.value);
      if (host) wrapCredentialHostsEl.value = host;
    }
  }

  function resetCredentialPanel(): void {
    wrapCredentialNameEl.value = '';
    wrapCredentialValueEl.value = '';
    wrapCredentialHostsEl.value = '';
    wrapCredentialHeaderEl.value = 'Authorization';
    wrapCredentialPrefixEl.value = 'Bearer ';
  }

  function setWrapperForm(wrapper: any | null): void {
    wrapWrapperResultEl.classList.add('hidden');
    resetCredentialPanel();

    if (wrapper) {
      selectedWrapperId = wrapper.id;
      wrapWrapperHeadingEl.textContent = 'EDIT WRAPPER';
      wrapWrapperTitleEl.textContent = wrapper.id;
      const bits = [wrapper.request?.method || 'GET'];
      if (wrapper.mutating) bits.push('mutating');
      if (wrapper.request?.auth) bits.push(`secret: ${wrapper.request.auth}`);
      wrapWrapperBadgeEl.textContent = bits.join(' · ');
      wrapWrapperBadgeEl.className = 'badge badge-ghost badge-xs font-mono';

      wrapFieldNameEl.value = wrapper.name || '';
      wrapFieldIdEl.value = wrapper.id || '';
      wrapFieldIdEl.disabled = true;
      wrapperIdTouched = true;
      wrapFieldDescriptionEl.value = wrapper.description || '';
      wrapFieldMethodEl.value = wrapper.request?.method || 'GET';
      wrapFieldUrlEl.value = wrapper.request?.url || '';
      wrapFieldMutatingEl.checked = Boolean(wrapper.mutating);
      wrapFieldInputSchemaEl.value = prettyJson(wrapper.inputSchema || DEFAULT_INPUT_SCHEMA);
      wrapFieldQueryEl.value = prettyJson(wrapper.request?.query);
      wrapFieldHeadersEl.value = prettyJson(wrapper.request?.headers);
      wrapFieldBodyEl.value = prettyJson(wrapper.request?.body);
      wrapFieldBodyFormatEl.value = wrapper.request?.bodyFormat || '';
      wrapFieldResponseEl.value = prettyJson(wrapper.response);
      wrapFieldNotesEl.value = wrapper.notes || '';
      wrapWrapperDeleteEl.disabled = false;
      populateAuthOptions(wrapper.request?.auth || '');
    } else {
      selectedWrapperId = null;
      wrapWrapperHeadingEl.textContent = 'NEW WRAPPER';
      wrapWrapperTitleEl.textContent = 'Not saved';
      wrapWrapperBadgeEl.className = 'badge badge-ghost badge-xs font-mono hidden';
      wrapFieldNameEl.value = '';
      wrapFieldIdEl.value = '';
      wrapFieldIdEl.disabled = false;
      wrapperIdTouched = false;
      wrapFieldDescriptionEl.value = '';
      wrapFieldMethodEl.value = 'GET';
      wrapFieldUrlEl.value = '';
      wrapFieldMutatingEl.checked = false;
      wrapFieldInputSchemaEl.value = prettyJson(DEFAULT_INPUT_SCHEMA);
      wrapFieldQueryEl.value = '';
      wrapFieldHeadersEl.value = '';
      wrapFieldBodyEl.value = '';
      wrapFieldBodyFormatEl.value = '';
      wrapFieldResponseEl.value = '';
      wrapFieldNotesEl.value = '';
      wrapWrapperDeleteEl.disabled = true;
      populateAuthOptions('');
    }

    wrapWrapperSaveEl.disabled = false;
    renderWrapWrappers();
  }

  function selectWrapWrapper(id: string, open = true): void {
    const wrapper = wrapWrappers.find((entry) => entry.id === id);
    if (!wrapper) return;
    setWrapperForm(wrapper);
    if (open) openWrapWrapperModal();
  }

  function newWrapWrapper(): void {
    setWrapperForm(null);
    openWrapWrapperModal();
    wrapFieldNameEl.focus();
  }

  async function loadWrapWrappers(selectId?: string, open = true): Promise<void> {
    try {
      const wrappers = await window.electronAPI?.listWrapWrappers();
      if (!Array.isArray(wrappers)) return;
      wrapWrappers = wrappers;
      const wanted = selectId ?? selectedWrapperId;
      const next = wanted ? wrappers.find((wrapper) => wrapper.id === wanted) : undefined;
      if (next) {
        selectWrapWrapper(next.id, open);
      } else {
        selectedWrapperId = null;
        wrapWrapperHeadingEl.textContent = 'NEW WRAPPER';
        wrapWrapperTitleEl.textContent = 'Not saved';
        wrapWrapperBadgeEl.className = 'badge badge-ghost badge-xs font-mono hidden';
        wrapWrapperDeleteEl.disabled = true;
        wrapWrapperSaveEl.disabled = true;
        if (wrapWrapperModalEl.open) wrapWrapperModalEl.close();
        renderWrapWrappers();
      }
    } catch (err: any) {
      showWrapperResult('error', `Could not load wrappers: ${err?.message || err}`);
    }
  }

  const renderWrapSecrets = (secrets: any[]) => {
    wrapListEl.replaceChildren();
    if (!secrets.length) {
      const empty = document.createElement('li');
      empty.className = 'font-mono text-[11px] text-base-content/50';
      empty.textContent = 'No secrets yet. Add one above; agents will see its name and allowed hosts.';
      wrapListEl.append(empty);
      return;
    }

    for (const secret of secrets) {
      const row = document.createElement('li');
      row.className =
        'flex items-center justify-between gap-3 rounded-box border border-base-100 bg-base-200/60 px-3 py-2';

      const text = document.createElement('div');
      text.className = 'min-w-0';
      const name = document.createElement('div');
      name.className = 'font-mono text-xs text-base-content';
      name.textContent = secret.name;
      const meta = document.createElement('div');
      meta.className = 'font-mono text-[10px] text-base-content/50 truncate';
      meta.textContent = `${secret.header}: ${secret.allowedHosts.join(', ')}`;
      text.append(name, meta);

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-1 shrink-0';

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-xs btn-ghost font-mono text-[10px]';
      edit.textContent = 'EDIT';
      edit.addEventListener('click', () => beginEditSecret(secret));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-xs btn-ghost font-mono text-[10px]';
      remove.textContent = 'DELETE';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Delete secret "${secret.name}"? Wrappers using it will stop working.`)) return;
        const result = await window.electronAPI?.deleteWrapSecret(secret.name);
        showWrapResult(result?.ok ? 'success' : 'error', result?.ok ? `Deleted ${secret.name}.` : (result?.errors || []).join('; ') || 'Delete failed.');
        if (editingSecretName === secret.name) resetSecretForm();
        await loadWrapSettings();
      });

      actions.append(edit, remove);
      row.append(text, actions);
      wrapListEl.append(row);
    }
  };

  function beginEditSecret(secret: any): void {
    editingSecretName = secret.name;
    wrapNameEl.value = secret.name;
    wrapHeaderEl.value = secret.header;
    wrapHostsEl.value = (secret.allowedHosts || []).join(', ');
    wrapPrefixEl.value = secret.prefix;
    wrapValueEl.value = '';
    wrapKindEl.value = secret.kind === 'oauth2' ? 'oauth2' : 'static';
    wrapTokenUrlEl.value = secret.oauth2?.tokenUrl || '';
    wrapClientIdEl.value = secret.oauth2?.clientId || '';
    wrapScopeEl.value = secret.oauth2?.scope || '';
    syncWrapKind();
    wrapCancelEditEl.classList.remove('hidden');
    if (wrapSaveEl) wrapSaveEl.textContent = 'UPDATE SECRET';
    showWrapResult('info', `Editing ${secret.name}. Leave the value blank to keep the current credential.`);
    wrapNameEl.focus();
  }

  function resetSecretForm(): void {
    editingSecretName = null;
    wrapNameEl.value = '';
    wrapValueEl.value = '';
    wrapHostsEl.value = '';
    wrapHeaderEl.value = 'Authorization';
    wrapPrefixEl.value = 'Bearer ';
    wrapKindEl.value = 'static';
    wrapTokenUrlEl.value = '';
    wrapClientIdEl.value = '';
    wrapScopeEl.value = '';
    syncWrapKind();
    wrapCancelEditEl.classList.add('hidden');
    if (wrapSaveEl) wrapSaveEl.textContent = 'SAVE SECRET';
  }

  function showWrapSubTab(tab: string): void {
    for (const button of wrapSubTabs) {
      button.classList.toggle('tab-active', button.dataset.wrapTab === tab);
    }
    for (const panel of wrapSubPanels) {
      panel.classList.toggle('hidden', panel.dataset.wrapPanel !== tab);
    }
    if (tab === 'credentials') void loadWrapSettings();
    if (tab === 'wrappers') void loadWrapWrappers(undefined, false);
  }

  for (const button of wrapSubTabs) {
    button.addEventListener('click', () => showWrapSubTab(button.dataset.wrapTab || 'wrappers'));
  }

  async function loadWrapSettings(): Promise<void> {
    try {
      const data = await window.electronAPI?.listWrapSecrets();
      if (!data) return;
      wrapSecretsAvailable = Boolean(data.available);
      if (data.warning) {
        wrapWarningEl.textContent = data.warning;
        wrapWarningEl.classList.remove('hidden');
      } else {
        wrapWarningEl.classList.add('hidden');
      }
      if (wrapSaveEl) wrapSaveEl.disabled = !data.available;
      wrapSecretNames = (data.secrets || []).map((secret: any) => secret.name).filter(Boolean);
      renderWrapSecrets(data.secrets || []);
      if (wrapWrapperModalEl.open) populateAuthOptions(wrapFieldAuthEl.value);
    } catch (err: any) {
      showWrapResult('error', `Could not load secrets: ${err?.message || err}`);
    }
  }

  wrapHeaderEl.addEventListener('change', () => {
    if (wrapHeaderEl.value.trim().toLowerCase() !== 'authorization' && wrapPrefixEl.value === 'Bearer ') {
      wrapPrefixEl.value = '';
    }
  });

  wrapRefreshEl.addEventListener('click', () => {
    void loadWrapSettings();
  });

  wrapFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = wrapNameEl.value.trim();
    const value = wrapValueEl.value;
    const allowedHosts = wrapHostsEl.value.trim();
    const editing = Boolean(editingSecretName) && editingSecretName === name;

    if (!name || !allowedHosts) {
      showWrapResult('error', 'Name and at least one allowed host are required.');
      return;
    }
    if (!value && !editing) {
      showWrapResult('error', 'Value is required for a new secret or a renamed secret.');
      return;
    }

    const kind = wrapKindEl.value === 'oauth2' ? 'oauth2' : 'static';
    const tokenUrl = wrapTokenUrlEl.value.trim();
    const clientId = wrapClientIdEl.value.trim();
    const scope = wrapScopeEl.value.trim();
    if (kind === 'oauth2' && (!tokenUrl || !clientId)) {
      showWrapResult('error', 'An OAuth2 credential needs a token URL and a client ID.');
      return;
    }

    if (wrapSaveEl) {
      wrapSaveEl.disabled = true;
      wrapSaveEl.classList.add('loading');
    }
    try {
      const header = wrapHeaderEl.value.trim() || 'Authorization';
      const prefix =
        header.toLowerCase() !== 'authorization' && wrapPrefixEl.value === 'Bearer ' ? '' : wrapPrefixEl.value;
      const result = await window.electronAPI?.setWrapSecret({
        name,
        value,
        allowedHosts,
        header,
        prefix,
        kind,
        ...(kind === 'oauth2' ? { tokenUrl, clientId, scope } : {}),
      });
      if (result?.ok) {
        resetSecretForm();
        showWrapResult('success', `Saved ${name}. Agents can reference it by name; the value stays here.`);
        await loadWrapSettings();
      } else {
        showWrapResult('error', (result?.errors || []).join('; ') || 'Save failed.');
      }
    } catch (err: any) {
      showWrapResult('error', `Save failed: ${err?.message || err}`);
    } finally {
      if (wrapSaveEl) {
        wrapSaveEl.disabled = !wrapSecretsAvailable;
        wrapSaveEl.classList.remove('loading');
      }
    }
  });

  wrapCancelEditEl.addEventListener('click', resetSecretForm);
  wrapKindEl.addEventListener('change', syncWrapKind);

  wrapWrapperFilterEl.addEventListener('input', renderWrapWrappers);

  wrapWrapperCloseEl.addEventListener('click', () => wrapWrapperModalEl.close());
  wrapWrapperCancelEl.addEventListener('click', () => wrapWrapperModalEl.close());
  wrapWrapperModalEl.addEventListener('close', () => {
    wrapWrapperResultEl.classList.add('hidden');
    wrapCredentialValueEl.value = '';
  });

  wrapWrapperRefreshEl.addEventListener('click', () => {
    void loadWrapWrappers(undefined, false);
  });

  wrapWrapperNewEl.addEventListener('click', newWrapWrapper);

  wrapFieldNameEl.addEventListener('input', () => {
    if (!wrapperIdTouched) wrapFieldIdEl.value = slugifyWrapperId(wrapFieldNameEl.value);
  });

  wrapFieldIdEl.addEventListener('input', () => {
    wrapperIdTouched = wrapFieldIdEl.value.trim().length > 0;
  });

  wrapFieldMethodEl.addEventListener('change', () => {
    wrapFieldMutatingEl.checked = !['GET', 'HEAD'].includes(wrapFieldMethodEl.value);
  });

  wrapFieldAuthEl.addEventListener('change', updateCredentialPanel);

  const prefillCredentialHost = () => {
    if (wrapFieldAuthEl.value === '__new__' && !wrapCredentialHostsEl.value.trim()) {
      const host = hostFromUrl(wrapFieldUrlEl.value);
      if (host) wrapCredentialHostsEl.value = host;
    }
  };
  wrapFieldUrlEl.addEventListener('input', prefillCredentialHost);
  wrapFieldUrlEl.addEventListener('blur', prefillCredentialHost);

  wrapCredentialHeaderEl.addEventListener('change', () => {
    if (
      wrapCredentialHeaderEl.value.trim().toLowerCase() !== 'authorization' &&
      wrapCredentialPrefixEl.value === 'Bearer '
    ) {
      wrapCredentialPrefixEl.value = '';
    }
  });

  function readJsonField(
    element: HTMLTextAreaElement,
    label: string,
    fallback?: unknown,
  ): { ok: true; value: unknown } | { ok: false; error: string } {
    const text = element.value.trim();
    if (!text) return { ok: true, value: fallback };
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (err: any) {
      return { ok: false, error: `${label}: ${err?.message || err}` };
    }
  }

  wrapWrapperFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = wrapFieldNameEl.value.trim();
    const id = wrapFieldIdEl.value.trim();
    const url = wrapFieldUrlEl.value.trim();
    const method = wrapFieldMethodEl.value;
    const description = wrapFieldDescriptionEl.value.trim();

    const errors: string[] = [];
    if (!name) errors.push('Name is required.');
    if (!id) errors.push('ID is required.');
    if (!url) errors.push('URL is required.');

    const inputSchemaResult = readJsonField(wrapFieldInputSchemaEl, 'Input schema', DEFAULT_INPUT_SCHEMA);
    const queryResult = readJsonField(wrapFieldQueryEl, 'Query template');
    const headersResult = readJsonField(wrapFieldHeadersEl, 'Headers');
    const bodyResult = readJsonField(wrapFieldBodyEl, 'Body template');
    const responseResult = readJsonField(wrapFieldResponseEl, 'Response recipe');

    for (const result of [inputSchemaResult, queryResult, headersResult, bodyResult, responseResult]) {
      if (!result.ok) errors.push(result.error);
    }

    if (errors.length) {
      showWrapperResult('error', errors.join(' '));
      return;
    }

    const inputSchemaValue = inputSchemaResult.ok ? inputSchemaResult.value : DEFAULT_INPUT_SCHEMA;
    const queryValue = queryResult.ok ? queryResult.value : undefined;
    const headersValue = headersResult.ok ? headersResult.value : undefined;
    const bodyValue = bodyResult.ok ? bodyResult.value : undefined;
    const responseValue = responseResult.ok ? responseResult.value : undefined;

    const original = selectedWrapperId ? wrapWrappers.find((wrapper) => wrapper.id === selectedWrapperId) : undefined;
    let auth = wrapFieldAuthEl.value;

    wrapWrapperSaveEl.disabled = true;
    wrapWrapperSaveEl.classList.add('loading');
    try {
      if (auth === '__new__') {
        const credentialName = wrapCredentialNameEl.value.trim();
        const credentialValue = wrapCredentialValueEl.value;
        const allowedHosts = wrapCredentialHostsEl.value.trim() || hostFromUrl(url);
        if (!credentialName || !credentialValue || !allowedHosts) {
          showWrapperResult('error', 'New credential needs a name, value, and allowed host.');
          return;
        }

        const header = wrapCredentialHeaderEl.value.trim() || 'Authorization';
        const prefix =
          header.toLowerCase() !== 'authorization' && wrapCredentialPrefixEl.value === 'Bearer '
            ? ''
            : wrapCredentialPrefixEl.value;
        const credential = await window.electronAPI?.setWrapSecret({
          name: credentialName,
          value: credentialValue,
          allowedHosts,
          header,
          prefix,
        });
        if (!credential?.ok) {
          showWrapperResult('error', `Credential rejected: ${(credential?.errors || []).join('; ') || 'unknown error'}`);
          return;
        }

        auth = credentialName;
        await loadWrapSettings();
        wrapFieldAuthEl.value = credentialName;
        updateCredentialPanel();
      }

      const request: Record<string, unknown> = { method, url };
      if (auth && auth !== '__new__') request.auth = auth;
      if (queryValue !== undefined) request.query = queryValue;
      if (headersValue !== undefined) request.headers = headersValue;
      if (bodyValue !== undefined) request.body = bodyValue;
      if (wrapFieldBodyFormatEl.value) request.bodyFormat = wrapFieldBodyFormatEl.value;
      if (original?.request?.timeoutMs) request.timeoutMs = original.request.timeoutMs;

      const wrapper: Record<string, unknown> = {
        schemaVersion: 1,
        id,
        name,
        request,
        inputSchema: inputSchemaValue,
        mutating: wrapFieldMutatingEl.checked,
      };
      if (description) wrapper.description = description;
      if (responseValue !== undefined) wrapper.response = responseValue;
      if (wrapFieldNotesEl.value.trim()) wrapper.notes = wrapFieldNotesEl.value.trim();
      if (original?.exposeAsTool !== undefined) wrapper.exposeAsTool = original.exposeAsTool;
      if (original?.lastVerified !== undefined) wrapper.lastVerified = original.lastVerified;

      const result = await window.electronAPI?.saveWrapWrapper(wrapper);
      if (result?.ok) {
        const savedId = result.wrapper?.id || id;
        await loadWrapWrappers(savedId, false);
        wrapWrapperModalEl.close();
      } else {
        showWrapperResult('error', (result?.errors || []).join('; ') || 'Save failed.');
      }
    } catch (err: any) {
      showWrapperResult('error', `Save failed: ${err?.message || err}`);
    } finally {
      wrapWrapperSaveEl.disabled = false;
      wrapWrapperSaveEl.classList.remove('loading');
    }
  });

  wrapWrapperDeleteEl.addEventListener('click', async () => {
    if (!selectedWrapperId) return;
    if (!window.confirm(`Delete wrapper "${selectedWrapperId}"? Credentials are kept.`)) return;
    const result = await window.electronAPI?.deleteWrapWrapper(selectedWrapperId);
    if (result?.ok) {
      await loadWrapWrappers(undefined, false);
      wrapWrapperModalEl.close();
    } else {
      showWrapperResult('error', (result?.errors || []).join('; ') || 'Delete failed.');
    }
  });

  const showSettingsTab = (tab: string) => {
    for (const button of settingsTabs) {
      button.classList.toggle('tab-active', button.dataset.settingsTab === tab);
    }
    for (const panel of settingsPanels) {
      panel.classList.toggle('hidden', panel.dataset.settingsPanel !== tab);
    }
    badgeEl.classList.toggle('hidden', tab !== 'decision');
    if (tab === 'recording') {
      void loadRecordingSettings();
    }
    if (tab === 'clients') {
      void loadConnectPanel();
    }
    if (tab === 'research') {
      void loadResearchSettings();
    }
    if (tab === 'input') {
      void loadInputSettings();
    }
    if (tab === 'shadow') {
      void loadShadowWalkSettings();
    }
    if (tab === 'wrappers') {
      void loadWrapSettings();
      const activeWrapTab = wrapSubTabs.find((button) => button.classList.contains('tab-active'))?.dataset.wrapTab;
      if (activeWrapTab !== 'credentials') void loadWrapWrappers(undefined, false);
    }
  };
  for (const button of settingsTabs) {
    button.addEventListener('click', () => showSettingsTab(button.dataset.settingsTab || 'decision'));
  }

  // ---- Human input pacing (Settings → INPUT) ------------------------------------------------
  const inputForm = document.getElementById('settings-input-form') as HTMLFormElement | null;
  const inputMouse = document.getElementById('input-mouse-speed') as HTMLInputElement | null;
  const inputTyping = document.getElementById('input-typing-speed') as HTMLInputElement | null;
  const inputDwell = document.getElementById('input-click-dwell') as HTMLInputElement | null;
  const inputMouseValue = document.getElementById('input-mouse-value') as HTMLElement | null;
  const inputTypingValue = document.getElementById('input-typing-value') as HTMLElement | null;
  const inputDwellValue = document.getElementById('input-dwell-value') as HTMLElement | null;
  const inputReset = document.getElementById('settings-input-reset') as HTMLButtonElement | null;
  const inputResult = document.getElementById('settings-input-result') as HTMLElement | null;

  function showInputResult(kind: 'success' | 'error' | 'info', text: string) {
    if (!inputResult) return;
    inputResult.className = `alert alert-${kind} alert-sm font-mono text-xs`;
    inputResult.textContent = text;
    inputResult.classList.remove('hidden');
  }

  function syncInputLabels() {
    if (inputMouse && inputMouseValue) inputMouseValue.textContent = inputMouse.value;
    if (inputTyping && inputTypingValue) inputTypingValue.textContent = inputTyping.value;
    if (inputDwell && inputDwellValue) inputDwellValue.textContent = inputDwell.value;
  }

  function applyInputProfile(profile: { mouseSpeedPxPerSec: number; typingWpm: number; clickDwellMs: number }) {
    if (inputMouse) inputMouse.value = String(profile.mouseSpeedPxPerSec);
    if (inputTyping) inputTyping.value = String(profile.typingWpm);
    if (inputDwell) inputDwell.value = String(profile.clickDwellMs);
    syncInputLabels();
  }

  async function loadInputSettings() {
    try {
      const profile = await window.electronAPI?.getInputProfile();
      if (profile) applyInputProfile(profile);
    } catch (err: any) {
      showInputResult('error', `Could not read the input profile: ${err?.message || err}`);
    }
  }

  for (const slider of [inputMouse, inputTyping, inputDwell]) {
    slider?.addEventListener('input', syncInputLabels);
  }

  inputForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const result = await window.electronAPI?.saveInputProfile({
        mouseSpeedPxPerSec: Number(inputMouse?.value) || undefined,
        typingWpm: Number(inputTyping?.value) || undefined,
        clickDwellMs: inputDwell ? Number(inputDwell.value) : undefined,
      });
      if (result?.ok) {
        applyInputProfile(result.profile);
        showInputResult('success', 'Applied — the next click and keystroke use the new pacing.');
      } else {
        showInputResult('error', (result?.errors || []).join('; ') || 'Save failed.');
      }
    } catch (err: any) {
      showInputResult('error', `Save failed: ${err?.message || err}`);
    }
  });

  inputReset?.addEventListener('click', () => {
    // Defaults mirror DEFAULT_INPUT_PROFILE in src/main/telemetry/input-profile.ts.
    applyInputProfile({ mouseSpeedPxPerSec: 1400, typingWpm: 220, clickDwellMs: 55 });
    showInputResult('info', 'Defaults restored in the form — press SAVE to apply.');
  });

  const showResult = (kind: 'success' | 'error' | 'info', text: string) => {
    resultEl.className = `alert alert-${kind} alert-sm font-mono text-xs`;
    resultEl.textContent = text;
  };

  const showStatus = (status: any, stored: any) => {
    if (status?.configured) {
      badgeEl.className = 'badge badge-success font-mono text-xs whitespace-nowrap';
      badgeEl.textContent = `${status.protocol} · ${status.model}`;
    } else {
      badgeEl.className = 'badge badge-ghost font-mono text-xs whitespace-nowrap';
      badgeEl.textContent = 'off';
    }
    protocolEl.value = stored?.protocol || '';
    modelEl.value = stored?.model || '';
    urlEl.value = stored?.url || '';
    keyEl.value = stored?.key || '';
    revisionEl.value = stored?.revision || '';
    deviceEl.value = stored?.device || '';
  };

  settingsBtn.addEventListener('click', async () => {
    window.electronAPI?.setViewportVisibility(false);
    resultEl.className = 'alert alert-ghost alert-sm font-mono text-xs hidden';
    try {
      const { stored, status } = await window.electronAPI!.getDecisionSettings();
      showStatus(status, stored);
    } catch (err: any) {
      showStatus(null, null);
      showResult('error', `Could not read settings: ${err?.message || err}`);
    }
    settingsModal.showModal();
    const activeTab = settingsTabs.find((button) => button.classList.contains('tab-active'))?.dataset.settingsTab;
    if (activeTab === 'recording') void loadRecordingSettings();
    if (activeTab === 'clients') void loadConnectPanel();
    if (activeTab === 'research') void loadResearchSettings();
    if (activeTab === 'shadow') void loadShadowWalkSettings();
  });

  settingsModal.addEventListener('close', () => {
    if (wrapWrapperModalEl.open) wrapWrapperModalEl.close();
    window.electronAPI?.setViewportVisibility(true);
  });

  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    const protocol = protocolEl.value;
    const payload = protocol
      ? {
          protocol,
          model: modelEl.value.trim() || undefined,
          url: urlEl.value.trim() || undefined,
          key: keyEl.value.trim() || undefined,
          revision: revisionEl.value.trim() || undefined,
          device: deviceEl.value.trim() || undefined,
        }
      : null;
    try {
      const saved = await window.electronAPI!.saveDecisionSettings(payload);
      showStatus(saved?.status, payload);
      setDecisionTabVisible(Boolean(saved?.status?.configured), saved?.status);
      showResult(
        'success',
        saved?.ok
          ? saved.status?.configured
            ? `Saved. decide is now available via ${saved.status.protocol} (${saved.status.model}).`
            : 'Saved. No backend is configured, so decide stays hidden.'
          : 'Saved to disk, but the configuration could not be applied.'
      );
    } catch (err: any) {
      showResult('error', `Save failed: ${err?.message || err}`);
    }
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.classList.add('loading');
    showResult('info', 'Testing…');
    try {
      const result = await window.electronAPI!.testDecisionModel();
      if (result?.ok) {
        const answer = result.answers?.reachable;
        showResult(
          'success',
          `${result.protocol} · ${result.model} · ${result.latencyMs}ms — answered ${JSON.stringify(answer ?? result.answers)}`
        );
      } else {
        showResult('error', `${result?.error?.code || 'ERROR'} — ${result?.error?.message || 'no answer'}${result?.error?.hint ? ` (${result.error.hint})` : ''}`);
      }
    } catch (err: any) {
      showResult('error', `Test failed: ${err?.message || err}`);
    } finally {
      testBtn.disabled = false;
      testBtn.classList.remove('loading');
    }
  });

  closeBtn.addEventListener('click', () => settingsModal.close());
}

// ---- MCP client snippets (Settings → MCP Clients) ------------------------------------------
type ConnectRuntime = 'bundled' | 'node';
type ConnectServer = 'kuang' | 'wrap';

interface ConnectInfo {
  platform: string;
  version: string;
  bridgeUrl: string;
  bridgePort: number;
  serverPath: string;
  serverExists: boolean;
  wrapServerPath: string;
  wrapServerExists: boolean;
  wrapTokenFile: string;
  runtimePath: string;
  packaged: boolean;
  homedir: string;
}

interface ConnectClient {
  id: string;
  label: string;
  file: (info: ConnectInfo) => string;
  snippet: (info: ConnectInfo, runtime: ConnectRuntime, server: ConnectServer) => string;
  note?: string;
}

const connectClientEl = document.getElementById('connect-client') as HTMLSelectElement | null;
const connectServerEl = document.getElementById('connect-server') as HTMLSelectElement | null;
const connectRuntimeEl = document.getElementById('connect-runtime') as HTMLSelectElement | null;
const connectClientNameEl = document.getElementById('connect-client-name') as HTMLElement | null;
const connectFileEl = document.getElementById('connect-file') as HTMLElement | null;
const connectSnippetEl = document.getElementById('connect-snippet') as HTMLElement | null;
const connectNoteEl = document.getElementById('connect-note') as HTMLElement | null;
const connectCopyEl = document.getElementById('connect-copy') as HTMLButtonElement | null;

let connectInfo: ConnectInfo | null = null;

const serverName = (server: ConnectServer) => (server === 'wrap' ? 'kuang-wrap' : 'kuang');

function runtimeParts(info: ConnectInfo, runtime: ConnectRuntime, server: ConnectServer) {
  const env: Record<string, string> = {};
  if (runtime === 'bundled') env.ELECTRON_RUN_AS_NODE = '1';
  if (info.bridgePort !== 4111) env.KUANG_BRIDGE_URL = info.bridgeUrl;
  if (server === 'wrap') env.KUANG_WRAP_TOKEN_FILE = info.wrapTokenFile;
  const serverPath = server === 'wrap' ? info.wrapServerPath : info.serverPath;
  return runtime === 'bundled'
    ? { command: info.runtimePath, args: [serverPath], env }
    : { command: 'node', args: [serverPath], env };
}

const withEnv = (entry: Record<string, any>, env: Record<string, string>) =>
  Object.keys(env).length ? { ...entry, env } : entry;

const claudeStyle = (info: ConnectInfo, runtime: ConnectRuntime, server: ConnectServer) => {
  const { command, args, env } = runtimeParts(info, runtime, server);
  return JSON.stringify({ mcpServers: { [serverName(server)]: withEnv({ command, args }, env) } }, null, 2);
};

const quote = (value: string) => `"${value}"`;

/** Join a home-relative config path with the host separator (display only). */
const hpath = (info: ConnectInfo, ...parts: string[]) =>
  [info.homedir, ...parts].join(info.platform === 'win32' ? '\\' : '/');

const CONNECT_CLIENTS: ConnectClient[] = [
  {
    id: 'opencode',
    label: 'OpenCode',
    file: (info) => `${hpath(info, '.config', 'opencode', 'opencode.json')} (global) · opencode.json (project)`,
    snippet: (info, runtime, server) => {
      const { command, args, env } = runtimeParts(info, runtime, server);
      const entry: Record<string, any> = { type: 'local', command: [command, ...args], enabled: true };
      if (Object.keys(env).length) entry.environment = env;
      return JSON.stringify(
        { $schema: 'https://opencode.ai/config.json', mcp: { [serverName(server)]: entry } },
        null,
        2
      );
    },
    note: 'Restart OpenCode after saving. Tools appear under the server name shown in the snippet.',
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    file: (info) =>
      info.platform === 'win32'
        ? `${info.homedir}\\AppData\\Roaming\\Claude\\claude_desktop_config.json`
        : info.platform === 'darwin'
          ? `${info.homedir}/Library/Application Support/Claude/claude_desktop_config.json`
          : `${info.homedir}/.config/Claude/claude_desktop_config.json`,
    snippet: claudeStyle,
    note: 'Quit Claude Desktop completely (tray icon too) and reopen it after saving.',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    file: () => 'Run once in a terminal · or commit .mcp.json to the project',
    snippet: (info, runtime, server) => {
      const { command, args, env } = runtimeParts(info, runtime, server);
      const parts = ['claude', 'mcp', 'add', serverName(server)];
      for (const [key, value] of Object.entries(env)) parts.push('--env', `${key}=${value}`);
      parts.push('--', quote(command), ...args.map(quote));
      return parts.join(' ');
    },
    note: 'Use `claude mcp list` to verify. A project .mcp.json with the Claude Desktop shape also works.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    file: (info) => `${hpath(info, '.cursor', 'mcp.json')} (global) · .cursor/mcp.json (project)`,
    snippet: claudeStyle,
    note: 'Cursor → Settings → MCP → refresh after saving.',
  },
  {
    id: 'vscode',
    label: 'VS Code (Copilot)',
    file: () => '.vscode/mcp.json in the workspace',
    snippet: (info, runtime, server) => {
      const { command, args, env } = runtimeParts(info, runtime, server);
      return JSON.stringify(
        { servers: { [serverName(server)]: withEnv({ type: 'stdio', command, args }, env) } },
        null,
        2
      );
    },
    note: 'Needs an agent-mode request; run “MCP: List Servers” to start the server.',
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    file: (info) => hpath(info, '.codeium', 'windsurf', 'mcp_config.json'),
    snippet: claudeStyle,
    note: 'Cascade → MCP → refresh after saving.',
  },
  {
    id: 'antigravity',
    label: 'Google Antigravity',
    file: (info) =>
      `${hpath(info, '.gemini', 'config', 'mcp_config.json')} (global) · .agents/mcp_config.json (workspace)`,
    snippet: claudeStyle,
    note: 'Antigravity rejects a `type` field — this snippet uses only command/args/env.',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    file: (info) => hpath(info, '.gemini', 'settings.json'),
    snippet: claudeStyle,
    note: 'Merge into the existing settings.json rather than replacing it.',
  },
  {
    id: 'atomic-chat',
    label: 'Atomic Chat',
    file: () => 'Settings → MCP Servers → Add MCP Server → JSON editor',
    snippet: claudeStyle,
    note: 'Paste this into Atomic Chat’s JSON editor, or enter the same command/args in the add-server form.',
  },
  {
    id: 'zed',
    label: 'Zed',
    file: (info) => hpath(info, '.config', 'zed', 'settings.json'),
    snippet: (info, runtime, server) => {
      const { command, args, env } = runtimeParts(info, runtime, server);
      return JSON.stringify(
        {
          context_servers: {
            [serverName(server)]: { source: 'custom', command: { path: command, args, env } },
          },
        },
        null,
        2
      );
    },
    note: 'Zed calls them context servers; they appear in the agent panel.',
  },
  {
    id: 'generic',
    label: 'Generic (mcpServers)',
    file: () => 'Any client that accepts command / args / env over stdio',
    snippet: claudeStyle,
    note: 'The standard `mcpServers` wrapper used by most desktop clients.',
  },
];

function populateConnectClients() {
  if (!connectClientEl) return;
  connectClientEl.replaceChildren();
  for (const client of CONNECT_CLIENTS) {
    const option = document.createElement('option');
    option.value = client.id;
    option.textContent = client.label;
    connectClientEl.append(option);
  }
}

function renderConnect() {
  if (!connectInfo || !connectClientEl || !connectSnippetEl) return;
  const client = CONNECT_CLIENTS.find((item) => item.id === connectClientEl.value) || CONNECT_CLIENTS[0];
  const runtime = (connectRuntimeEl?.value === 'node' ? 'node' : 'bundled') as ConnectRuntime;
  const server = (connectServerEl?.value === 'wrap' ? 'wrap' : 'kuang') as ConnectServer;

  if (connectClientNameEl) connectClientNameEl.textContent = client.label;
  if (connectFileEl) connectFileEl.textContent = client.file(connectInfo);
  connectSnippetEl.textContent = client.snippet(connectInfo, runtime, server);

  const notes: string[] = [];
  if (client.note) notes.push(client.note);
  if (server === 'wrap') {
    notes.push('Kuang Wrap exposes only `wrap_*` tools; the Cyberdeck must be running so the bridge can reach the wrapper store.');
  }
  notes.push(
    runtime === 'bundled'
      ? 'Runs on this app’s bundled runtime (ELECTRON_RUN_AS_NODE=1), so Node does not need to be installed.'
      : 'Runs with `node` from PATH — Node 20 or newer is required.'
  );
  notes.push(
    connectInfo.bridgePort === 4111
      ? 'The Cyberdeck must already be running; the bridge listens on the default port 4111.'
      : `KUANG_BRIDGE_URL=${connectInfo.bridgeUrl} is included because this instance uses port ${connectInfo.bridgePort}.`
  );
  const serverPath = server === 'wrap' ? connectInfo.wrapServerPath : connectInfo.serverPath;
  const serverExists = server === 'wrap' ? connectInfo.wrapServerExists : connectInfo.serverExists;
  if (!serverExists) notes.push(`⚠ MCP server not found at ${serverPath} — run npm run build:mcp.`);
  if (connectNoteEl) connectNoteEl.textContent = notes.join(' ');
}

async function loadConnectPanel() {
  if (!connectClientEl) return;
  if (!connectClientEl.options.length) populateConnectClients();
  try {
    if (!connectInfo) connectInfo = await window.electronAPI!.getConnectInfo();
    renderConnect();
  } catch (err: any) {
    if (connectSnippetEl) connectSnippetEl.textContent = `Could not read connection info: ${err?.message || err}`;
  }
}

connectClientEl?.addEventListener('change', renderConnect);
connectServerEl?.addEventListener('change', renderConnect);
connectRuntimeEl?.addEventListener('change', renderConnect);
connectCopyEl?.addEventListener('click', async () => {
  const text = connectSnippetEl?.textContent || '';
  if (!text) return;
  await window.electronAPI?.copyToClipboard(text);
  connectCopyEl.textContent = 'COPIED';
  window.setTimeout(() => (connectCopyEl.textContent = 'COPY'), 1500);
});
populateConnectClients();

// ---- Auto-update banner (packaged builds only; the main process disables it elsewhere) ------
const updateBanner = document.getElementById('update-banner') as HTMLElement | null;
const updateText = document.getElementById('update-text') as HTMLElement | null;
const updateAction = document.getElementById('update-action') as HTMLButtonElement | null;

function renderUpdateState(state: any) {
  if (!updateBanner || !updateText || !updateAction) return;
  const show = (text: string, withAction = false) => {
    updateText.textContent = text;
    updateBanner.classList.remove('hidden');
    updateBanner.classList.add('flex');
    updateAction.classList.toggle('hidden', !withAction);
  };
  const hide = () => {
    updateBanner.classList.add('hidden');
    updateBanner.classList.remove('flex');
  };

  switch (state?.status) {
    case 'available':
      show(`Update ${state.version ? `v${state.version}` : ''} found — downloading…`);
      break;
    case 'downloading':
      show(`Downloading update${state.percent ? ` ${state.percent}%` : ''}…`);
      break;
    case 'ready':
      show(`Update ${state.version ? `v${state.version}` : ''} ready`, true);
      break;
    default:
      // idle / checking / disabled / error stay quiet — there is nothing for the human to do.
      hide();
  }
}

updateAction?.addEventListener('click', async () => {
  updateAction.disabled = true;
  updateAction.textContent = 'RESTARTING…';
  await window.electronAPI?.installUpdate();
});

window.electronAPI?.onUpdateStatus(renderUpdateState);
window.electronAPI?.getUpdateStatus().then(renderUpdateState).catch(() => {});

// About Modal & Viewport Visibility Management
const aboutBtn = document.getElementById('about-btn') as HTMLButtonElement | null;
const aboutModal = document.getElementById('about_modal') as HTMLDialogElement | null;

if (aboutBtn && aboutModal) {
  aboutBtn.addEventListener('click', () => {
    window.electronAPI?.setViewportVisibility(false);
    aboutModal.showModal();
  });

  aboutModal.addEventListener('close', () => {
    window.electronAPI?.setViewportVisibility(true);
  });
}

// Cortex Modal & Bookmark Management
const cortexBtn = document.getElementById('cortex-btn') as HTMLButtonElement | null;
const cortexModal = document.getElementById('cortex-modal') as HTMLDialogElement | null;
const bookmarkToggleBtn = document.getElementById('bookmark-toggle-btn') as HTMLButtonElement | null;
const bookmarkStarIcon = document.getElementById('bookmark-star-icon') as HTMLElement | null;

const tabCortexRecall = document.getElementById('tab-cortex-recall') as HTMLButtonElement | null;
const tabCortexBookmarks = document.getElementById('tab-cortex-bookmarks') as HTMLButtonElement | null;
const panelCortexRecall = document.getElementById('panel-cortex-recall') as HTMLElement | null;
const panelCortexBookmarks = document.getElementById('panel-cortex-bookmarks') as HTMLElement | null;

const cortexSearchInput = document.getElementById('cortex-search-input') as HTMLInputElement | null;
const cortexSearchBtn = document.getElementById('cortex-search-btn') as HTMLButtonElement | null;
const cortexClearHistoryBtn = document.getElementById('cortex-clear-history-btn') as HTMLButtonElement | null;
const cortexResultsContainer = document.getElementById('cortex-results-container') as HTMLElement | null;

const bkmkInputUrl = document.getElementById('bkmk-input-url') as HTMLInputElement | null;
const bkmkInputTitle = document.getElementById('bkmk-input-title') as HTMLInputElement | null;
const bkmkInputNotes = document.getElementById('bkmk-input-notes') as HTMLInputElement | null;
const bkmkInputTags = document.getElementById('bkmk-input-tags') as HTMLInputElement | null;
const bkmkSaveBtn = document.getElementById('bkmk-save-btn') as HTMLButtonElement | null;
const cortexBookmarksContainer = document.getElementById('cortex-bookmarks-container') as HTMLElement | null;

let activeUrl = 'about:blank';
let activeTitle = '';

// Check bookmark state for current page
async function checkCurrentBookmarkState(url: string) {
  if (!window.electronAPI || !bookmarkStarIcon || !url || url === 'about:blank') {
    if (bookmarkStarIcon) {
      bookmarkStarIcon.textContent = '☆';
      bookmarkStarIcon.className = 'text-sm text-base-content/40';
    }
    return;
  }
  try {
    const isSaved = await window.electronAPI.isBookmarked(url);
    if (isSaved) {
      bookmarkStarIcon.textContent = '★';
      bookmarkStarIcon.className = 'text-sm text-warning font-bold';
    } else {
      bookmarkStarIcon.textContent = '☆';
      bookmarkStarIcon.className = 'text-sm text-base-content/60';
    }
  } catch {
    // Ignore error
  }
}

if (bookmarkToggleBtn) {
  bookmarkToggleBtn.addEventListener('click', async () => {
    if (!window.electronAPI || !activeUrl || activeUrl === 'about:blank') return;
    const isSaved = await window.electronAPI.isBookmarked(activeUrl);
    if (isSaved) {
      await window.electronAPI.deleteBookmark(activeUrl);
      appendLog({ id: String(Date.now()), time: new Date().toLocaleTimeString(), level: 'info', message: `Bookmark removed: ${activeUrl}` });
    } else {
      await window.electronAPI.addBookmark({ url: activeUrl, title: activeTitle });
      appendLog({ id: String(Date.now()), time: new Date().toLocaleTimeString(), level: 'info', message: `Page bookmarked: ${activeTitle || activeUrl}` });
    }
    checkCurrentBookmarkState(activeUrl);
  });
}

// Cortex Modal Viewport Management
if (cortexBtn && cortexModal) {
  cortexBtn.addEventListener('click', () => {
    window.electronAPI?.setViewportVisibility(false);
    if (bkmkInputUrl) bkmkInputUrl.value = activeUrl !== 'about:blank' ? activeUrl : '';
    if (bkmkInputTitle) bkmkInputTitle.value = activeTitle;
    loadHistoryList();
    cortexModal.showModal();
  });

  cortexModal.addEventListener('close', () => {
    window.electronAPI?.setViewportVisibility(true);
    checkCurrentBookmarkState(activeUrl);
  });
}

// Cortex Tabs
if (tabCortexRecall && tabCortexBookmarks && panelCortexRecall && panelCortexBookmarks) {
  tabCortexRecall.addEventListener('click', () => {
    tabCortexRecall.classList.add('tab-active');
    tabCortexBookmarks.classList.remove('tab-active');
    panelCortexRecall.classList.remove('hidden');
    panelCortexBookmarks.classList.add('hidden');
    loadHistoryList();
  });

  tabCortexBookmarks.addEventListener('click', () => {
    tabCortexBookmarks.classList.add('tab-active');
    tabCortexRecall.classList.remove('tab-active');
    panelCortexBookmarks.classList.remove('hidden');
    panelCortexRecall.classList.add('hidden');
    loadBookmarksList();
  });
}

// Load and render history list
async function loadHistoryList() {
  if (!window.electronAPI || !cortexResultsContainer) return;
  try {
    const history = await window.electronAPI.getHistory({ limit: 15 });
    if (!history || history.length === 0) {
      cortexResultsContainer.innerHTML = `
        <div class="text-center py-8 text-xs font-mono text-base-content/50">
          No browsing history recorded yet. Browse the web to populate LanceDB.
        </div>`;
      return;
    }

    cortexResultsContainer.innerHTML = '';
    history.forEach((item: any) => {
      const card = document.createElement('div');
      card.className = 'bg-base-100 p-3 rounded-lg border border-base-200 hover:border-secondary/50 transition-colors flex items-center justify-between gap-3';
      card.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="badge badge-neutral badge-xs font-mono">${item.domain}</span>
            <span class="text-[10px] font-mono text-base-content/40">${new Date(item.visitedAt).toLocaleTimeString()}</span>
          </div>
          <div class="font-mono text-xs font-bold text-base-content truncate">${item.title || item.url}</div>
          <div class="text-[11px] font-mono text-base-content/60 truncate">${item.url}</div>
        </div>
        <button class="btn btn-xs btn-outline btn-secondary font-mono flex-shrink-0 launch-btn">
          ENGAGE
        </button>
      `;
      card.querySelector('.launch-btn')?.addEventListener('click', () => {
        cortexModal?.close();
        window.electronAPI?.navigate(item.url);
      });
      cortexResultsContainer.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

// Perform Recall Search
async function performRecall() {
  const query = cortexSearchInput?.value.trim();
  if (!query) {
    loadHistoryList();
    return;
  }
  if (!window.electronAPI || !cortexResultsContainer) return;

  cortexResultsContainer.innerHTML = `
    <div class="text-center py-8 font-mono text-xs text-secondary flex items-center justify-center gap-2">
      <span class="loading loading-spinner loading-xs"></span>
      Querying LanceDB Cortex Vector & FTS Index...
    </div>`;

  try {
    const results = await window.electronAPI.recallMemory(query, { limit: 8 });
    if (!results || results.length === 0) {
      cortexResultsContainer.innerHTML = `
        <div class="text-center py-8 text-xs font-mono text-base-content/50">
          No matching memory traces found for: "${query}"
        </div>`;
      return;
    }

    cortexResultsContainer.innerHTML = '';
    results.forEach((res: any) => {
      const card = document.createElement('div');
      card.className = 'bg-base-100 p-3 rounded-lg border border-base-200 hover:border-secondary/60 transition-colors space-y-2';
      const scorePercent = res.score ? Math.round(res.score * 100) : 85;

      card.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="badge badge-secondary badge-xs font-mono">${res.domain}</span>
            <span class="badge badge-neutral badge-xs font-mono">${scorePercent}% MATCH</span>
            <div class="font-mono text-xs font-bold text-base-content truncate">${res.title}</div>
          </div>
          <button class="btn btn-xs btn-primary font-mono flex-shrink-0 launch-btn">ENGAGE</button>
        </div>
        <div class="bg-base-200/60 p-2 rounded text-[11px] font-mono text-base-content/80 line-clamp-3 leading-relaxed whitespace-pre-wrap">
          ${res.snippet}
        </div>
        <div class="text-[10px] font-mono text-base-content/40 truncate">${res.url}</div>
      `;
      card.querySelector('.launch-btn')?.addEventListener('click', () => {
        cortexModal?.close();
        window.electronAPI?.navigate(res.url);
      });
      cortexResultsContainer.appendChild(card);
    });
  } catch (err) {
    cortexResultsContainer.innerHTML = `<div class="alert alert-error text-xs font-mono">Recall failed: ${err}</div>`;
  }
}

if (cortexSearchBtn) {
  cortexSearchBtn.addEventListener('click', performRecall);
}
if (cortexSearchInput) {
  cortexSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performRecall();
  });
}
if (cortexClearHistoryBtn) {
  cortexClearHistoryBtn.addEventListener('click', async () => {
    if (confirm('Clear all browsing history and indexed page chunks from LanceDB?')) {
      await window.electronAPI?.clearHistory('all');
      loadHistoryList();
    }
  });
}

// Load and render bookmarks list
async function loadBookmarksList() {
  if (!window.electronAPI || !cortexBookmarksContainer) return;
  try {
    const bookmarks = await window.electronAPI.listBookmarks();
    if (!bookmarks || bookmarks.length === 0) {
      cortexBookmarksContainer.innerHTML = `
        <div class="text-center py-8 text-xs font-mono text-base-content/50">
          No saved bookmarks yet. Save a bookmark using the form above or the address bar star.
        </div>`;
      return;
    }

    cortexBookmarksContainer.innerHTML = '';
    bookmarks.forEach((b: any) => {
      const card = document.createElement('div');
      card.className = 'bg-base-100 p-3 rounded-lg border border-base-200 hover:border-warning/50 transition-colors flex items-center justify-between gap-3';
      const tagsHtml = (b.tags || []).map((t: string) => `<span class="badge badge-warning badge-xs font-mono">#${t}</span>`).join(' ');

      card.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 mb-1 flex-wrap">
            <span class="text-warning text-xs">⭐</span>
            <div class="font-mono text-xs font-bold text-base-content truncate">${b.title}</div>
            ${tagsHtml}
          </div>
          ${b.notes ? `<div class="text-[11px] font-mono text-base-content/70 italic mb-1 truncate">${b.notes}</div>` : ''}
          <div class="text-[10px] font-mono text-base-content/40 truncate">${b.url}</div>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <button class="btn btn-xs btn-outline btn-warning font-mono launch-btn">ENGAGE</button>
          <button class="btn btn-xs btn-ghost btn-square text-error hover:bg-error/10 delete-btn" title="Delete bookmark">✕</button>
        </div>
      `;
      card.querySelector('.launch-btn')?.addEventListener('click', () => {
        cortexModal?.close();
        window.electronAPI?.navigate(b.url);
      });
      card.querySelector('.delete-btn')?.addEventListener('click', async () => {
        await window.electronAPI?.deleteBookmark(b.id || b.url);
        loadBookmarksList();
        checkCurrentBookmarkState(activeUrl);
      });
      cortexBookmarksContainer.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load bookmarks:', err);
  }
}

if (bkmkSaveBtn) {
  bkmkSaveBtn.addEventListener('click', async () => {
    const url = bkmkInputUrl?.value.trim() || activeUrl;
    if (!url || url === 'about:blank') return;
    const title = bkmkInputTitle?.value.trim() || activeTitle;
    const notes = bkmkInputNotes?.value.trim() || '';
    const tags = bkmkInputTags?.value.split(',').map(s => s.trim()).filter(Boolean) || [];

    await window.electronAPI?.addBookmark({ url, title, notes, tags });
    if (bkmkInputNotes) bkmkInputNotes.value = '';
    if (bkmkInputTags) bkmkInputTags.value = '';
    loadBookmarksList();
    checkCurrentBookmarkState(activeUrl);
  });
}
