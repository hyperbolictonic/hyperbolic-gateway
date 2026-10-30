/**
 * Consolidated MCP surface.
 *
 * Each group is one advertised tool with a small action enum. The underlying
 * catalog tools stay registered and callable by name but are hidden from
 * tools/list. This keeps compatibility while shrinking the advertised surface.
 */

export type ToolArgs = Record<string, any>;

export interface ToolGroupAction {
  action: string;
  tool: string;
  description: string;
  map?: (args: ToolArgs) => ToolArgs;
}

export interface ToolGroupDefinition {
  name: string;
  description: string;
  tier: 1 | 2 | 3 | null;
  actions: ToolGroupAction[];
}

const same = (args: ToolArgs): ToolArgs => args;

export const TOOL_GROUPS: ToolGroupDefinition[] = [
  {
    name: 'navigate',
    description: 'Navigate the visible browser: open a URL, move through history, dismiss a consent wall, or scroll.',
    tier: 1,
    actions: [
      { action: 'open', tool: 'navigate_to', description: 'Open a URL.' },
      { action: 'back', tool: 'navigate_history', description: 'Go back.', map: () => ({ direction: 'back' }) },
      { action: 'forward', tool: 'navigate_history', description: 'Go forward.', map: () => ({ direction: 'forward' }) },
      { action: 'reload', tool: 'navigate_history', description: 'Reload.', map: () => ({ direction: 'reload' }) },
      { action: 'consent', tool: 'dismiss_consent', description: 'Dismiss a cookie/GDPR wall.', map: () => ({}) },
      { action: 'scroll', tool: 'scroll_page', description: 'Scroll the viewport.' },
      {
        action: 'recipe',
        tool: 'recipe',
        description: 'Save/list/replay/delete a zero-model navigation path.',
        map: (args) => ({
          action: args.recipe_action || 'list',
          id: args.id,
          url: args.url,
          name: args.name,
          path: args.path,
          steps: args.steps,
          expect_timeout_ms: args.expect_timeout_ms,
        }),
      },
    ],
  },
  {
    name: 'capture',
    description: 'Capture the active page as a viewport/Set-of-Marks screenshot or a rendered post-hydration snapshot.',
    tier: 2,
    actions: [
      { action: 'screenshot', tool: 'take_screenshot', description: 'Viewport or Set-of-Marks image.' },
      { action: 'rendered', tool: 'snapshot_rendered_page', description: 'Rendered AX/Markdown/HTML snapshot.' },
    ],
  },
  {
    name: 'devtools',
    description: 'Read-only deep-browser console: page state, diff, console, network, streams, HAR, JSON payloads, fingerprint and health.',
    tier: null,
    actions: [
      { action: 'state', tool: 'page_state', description: 'Cheap page-state signature.', map: () => ({}) },
      { action: 'diff', tool: 'diff', description: 'Diff against a revision.' },
      { action: 'console', tool: 'get_console_logs', description: 'Recent console logs.' },
      { action: 'fingerprint', tool: 'get_fingerprint_profile', description: 'Current fingerprint profile.', map: () => ({}) },
      { action: 'health', tool: 'bridge_health', description: 'Bridge/app health.', map: () => ({}) },
      { action: 'traffic', tool: 'get_network_traffic', description: 'Captured HTTP traffic.' },
      { action: 'query', tool: 'query_json_data', description: 'Query captured JSON payloads.' },
      { action: 'streams', tool: 'list_realtime_streams', description: 'Active WebSocket/SSE streams.' },
      { action: 'clear', tool: 'clear_capture', description: 'Clear capture buffers.' },
      { action: 'har', tool: 'export_har', description: 'Export captured traffic as HAR.' },
    ],
  },
  {
    name: 'human_in_loop',
    description: 'Human hand-off and desktop controls: request/status/resolve HIL, inspect/resume passive takeover, notify, show/hide or configure the tray.',
    tier: null,
    actions: [
      { action: 'request', tool: 'request_human_intervention', description: 'Ask the human for help.' },
      { action: 'status', tool: 'get_human_intervention_status', description: 'Pending HIL request.', map: () => ({}) },
      { action: 'resolve', tool: 'resolve_human_intervention', description: 'Resolve a HIL request.' },
      { action: 'activity', tool: 'get_human_activity', description: 'Passive takeover status.', map: () => ({}) },
      { action: 'resume', tool: 'resume_agent', description: 'Clear a passive takeover.', map: () => ({}) },
      { action: 'notify', tool: 'send_notification', description: 'Desktop notification.' },
      { action: 'show', tool: 'set_window_visibility', description: 'Show/focus the app.', map: (args) => ({ visible: true, focus: args.focus ?? true }) },
      { action: 'hide', tool: 'set_window_visibility', description: 'Hide to tray.', map: () => ({ visible: false, focus: false }) },
      { action: 'tray', tool: 'configure_system_tray', description: 'Configure close-to-tray.' },
    ],
  },
  {
    name: 'browser_workspace',
    description: 'Stateful browser workspace: tabs, downloads, context profiles, recordings and the script vault.',
    tier: null,
    actions: [
      { action: 'tabs.list', tool: 'list_tabs', description: 'List tabs.', map: () => ({}) },
      { action: 'tabs.new', tool: 'new_tab', description: 'Open a tab.' },
      { action: 'tabs.switch', tool: 'switch_tab', description: 'Switch tab.' },
      { action: 'tabs.close', tool: 'close_tab', description: 'Close tab.' },
      { action: 'downloads.list', tool: 'list_downloads', description: 'List downloads.', map: () => ({}) },
      { action: 'downloads.read', tool: 'read_download', description: 'Read a downloaded document.' },
      { action: 'contexts.save', tool: 'context_save', description: 'Save cookies/storage.' },
      { action: 'contexts.open', tool: 'context_open', description: 'Open a saved context.' },
      { action: 'contexts.list', tool: 'context_list', description: 'List contexts.', map: () => ({}) },
      { action: 'contexts.delete', tool: 'context_delete', description: 'Delete a context.' },
      { action: 'record.start', tool: 'record_start', description: 'Start a timelapse.' },
      { action: 'record.stop', tool: 'record_stop', description: 'Stop and save a timelapse.', map: () => ({}) },
      { action: 'record.list', tool: 'list_recordings', description: 'List recordings.' },
      { action: 'scripts.save', tool: 'save_script', description: 'Save a script.' },
      { action: 'scripts.run', tool: 'run_script', description: 'Run a saved script.' },
      { action: 'scripts.list', tool: 'list_scripts', description: 'List/search scripts.' },
      { action: 'scripts.delete', tool: 'delete_script', description: 'Delete a script.' },
    ],
  },
  {
    name: 'shadow_iframes',
    description: 'Shadow DOM and iframe access: list frame controls and walk into closed shadow roots with trusted Tab steps.',
    tier: null,
    actions: [
      { action: 'frames', tool: 'frames', description: 'List iframes and their controls.' },
      { action: 'focus_walk', tool: 'focus_walk', description: 'Tab into a closed shadow root.' },
    ],
  },
  {
    name: 'research',
    description: 'Read, search and crawl: URL-to-Markdown, multi-engine search, LLM surfaces, BFS crawl and cited topic research.',
    tier: null,
    actions: [
      { action: 'read', tool: 'read_url', description: 'Read a URL as Markdown.' },
      { action: 'search', tool: 'search_web', description: 'Multi-engine web search.' },
      { action: 'surface', tool: 'llm_surface', description: 'Check for an LLM-friendly surface.' },
      { action: 'fetch', tool: 'llm_fetch', description: 'Fetch the advertised surface.' },
      { action: 'crawl', tool: 'deep_crawl', description: 'Breadth-first crawl.' },
      { action: 'topic', tool: 'research_topic', description: 'Search, gather and cite sources.' },
      { action: 'prerender', tool: 'prerender_links', description: 'Pre-render candidate links.' },
    ],
  },
  {
    name: 'memory',
    description: 'Local Cortex memory: recall, browsing history and bookmarks.',
    tier: null,
    actions: [
      { action: 'recall', tool: 'recall_memory', description: 'Hybrid semantic recall.' },
      { action: 'history', tool: 'browsing_history', description: 'Chronological history.' },
      { action: 'history_clear', tool: 'browsing_history_clear', description: 'Prune history.' },
      { action: 'bookmark_add', tool: 'add_bookmark', description: 'Save a bookmark.' },
      { action: 'bookmark_list', tool: 'list_bookmarks', description: 'List/search bookmarks.' },
      { action: 'bookmark_delete', tool: 'delete_bookmark', description: 'Delete a bookmark.' },
    ],
  },
];

export const META_TOOL_NAMES = new Set(TOOL_GROUPS.map((group) => group.name));
export const CONSOLIDATED_GROUPED_TOOLS = new Set(
  TOOL_GROUPS.flatMap((group) => group.actions.map((action) => action.tool)),
);
/** `collect_all` is folded into `extract`; old callers can still use it by name. */
export const CONSOLIDATED_HIDDEN_TOOLS = new Set([
  ...CONSOLIDATED_GROUPED_TOOLS,
  'collect_all',
  'expect',
  'press_key',
  'fill_form',
  'recipe',
]);

export function groupAction(group: ToolGroupDefinition, action: string): ToolGroupAction | undefined {
  return group.actions.find((entry) => entry.action === action);
}
