import { z } from 'zod';

export interface ToolCatalogItem {
  name: string;
  description: string;
  parameters: Record<string, z.ZodTypeAny>;
  endpoint: string;
  method?: 'GET' | 'POST';
  payload?: (args: any) => any;
  format?: (data: any, args: any) => string;
}

export const TOOLS_CATALOG: ToolCatalogItem[] = [
  // 1. Navigation
  {
    name: 'navigate_to',
    description: 'Navigates the real, visible Chromium browser window to a destination URL. Automatically dismisses GDPR/cookie consent overlays by default.',
    parameters: {
      url: z.string().describe('The destination URL (e.g. "https://news.ycombinator.com" or "https://reddit.com")'),
      auto_dismiss_consent: z.boolean().optional().default(true).describe('Whether to automatically detect and dismiss cookie/GDPR consent overlays (default: true)'),
    },
    endpoint: '/navigate',
    payload: (args) => ({ url: args.url, autoDismissConsent: args.auto_dismiss_consent }),
    format: (data) => data.result || 'Navigation complete',
  },
  {
    name: 'go_to_url',
    description: 'Alias for navigate_to. Navigates the browser window to a destination URL.',
    parameters: {
      url: z.string().describe('The destination URL'),
    },
    endpoint: '/navigate',
    payload: (args) => ({ url: args.url }),
    format: (data) => data.result || 'Navigation complete',
  },

  // 2. Interaction
  {
    name: 'click_element',
    description: 'Clicks an element on the active web page using a CSS selector or direct viewport coordinates (x, y). Simulates realistic human pointer movement and switch actuation.',
    parameters: {
      selector: z.string().optional().describe('CSS selector of the element to click'),
      x: z.coerce.number().optional().describe('Direct X coordinate on the viewport in pixels'),
      y: z.coerce.number().optional().describe('Direct Y coordinate on the viewport in pixels'),
    },
    endpoint: '/click',
    payload: (args) => ({
      selector: args.selector || args.element || args.target || args.css,
      x: args.x !== undefined ? Number(args.x) : undefined,
      y: args.y !== undefined ? Number(args.y) : undefined,
    }),
    format: (data) => data.result || 'Click executed',
  },
  {
    name: 'type_text',
    description: 'Types text into an input element or active element with realistic human Gaussian typing cadence (60-240ms per keystroke).',
    parameters: {
      text: z.string().describe('The text string to type'),
      selector: z.string().optional().describe('Optional CSS selector of the input element'),
    },
    endpoint: '/type',
    payload: (args) => ({ text: args.text, selector: args.selector }),
    format: (data) => data.result || 'Text typed successfully',
  },
  {
    name: 'press_key',
    description: 'Dispatches a single hardware keyboard event (Enter, Tab, Escape, Backspace, ArrowDown, etc.).',
    parameters: {
      key: z.string().describe('The key name to press (e.g. "Enter", "Tab", "Escape", "Backspace")'),
    },
    endpoint: '/press-key',
    payload: (args) => ({ key: args.key }),
    format: (data) => data.result || 'Key pressed',
  },
  {
    name: 'scroll_page',
    description: 'Simulates organic inertial wheel scrolling in the active viewport.',
    parameters: {
      direction: z.enum(['up', 'down', 'top', 'bottom']).optional().default('down').describe('Scroll direction (default: "down")'),
      amount: z.number().optional().default(400).describe('Scroll amount in pixels (default: 400)'),
    },
    endpoint: '/scroll',
    payload: (args) => ({ direction: args.direction, amount: args.amount }),
    format: (data) => data.result || 'Scrolled successfully',
  },

  // 3. Visual & Inspection
  {
    name: 'take_screenshot',
    description: 'Captures a full viewport image of the active tab. Saves to data/screenshots/ and returns the local file path.',
    parameters: {},
    endpoint: '/screenshot',
    method: 'GET',
    format: (data) => data.screenshot?.filePath || JSON.stringify(data, null, 2),
  },
  {
    name: 'get_page_markdown',
    description: 'Extracts the active page DOM converted to token-efficient Markdown with YAML frontmatter envelope (title, URL, timestamps). Saves 90%+ context window tokens.',
    parameters: {},
    endpoint: '/markdown',
    method: 'GET',
    format: (data) => { const md = data.construct?.markdown || JSON.stringify(data, null, 2); return md.length > 25000 ? md.slice(0, 25000) + "\n\n... [Output truncated to 25000 chars]" : md; },
  },
  {
    name: 'harvest_markdown',
    description: 'Alias for get_page_markdown. Extracts clean markdown from the active tab.',
    parameters: {},
    endpoint: '/markdown',
    method: 'GET',
    format: (data) => { const md = data.construct?.markdown || JSON.stringify(data, null, 2); return md.length > 25000 ? md.slice(0, 25000) + "\n\n... [Output truncated to 25000 chars]" : md; },
  },
  {
    name: 'evaluate_javascript',
    description: 'Executes a JavaScript expression or script in the isolated context of the active web page and returns the serialized result.',
    parameters: {
      script: z.string().describe('JavaScript code to evaluate in the page context'),
    },
    endpoint: '/evaluate',
    payload: (args) => ({ script: args.script }),
    format: (data) => JSON.stringify(data.result, null, 2),
  },
  {
    name: 'get_page_info',
    description: 'Returns the current URL, page title, navigation status, tab count, and active tab ID of the browser window.',
    parameters: {},
    endpoint: '/page-info',
    method: 'GET',
    format: (data) => JSON.stringify(data.info, null, 2),
  },
  {
    name: 'navigate_history',
    description: 'Navigates back or forward in the browser history.',
    parameters: {
      direction: z.enum(['back', 'forward']).describe('Navigation direction: "back" or "forward"'),
    },
    endpoint: '/history/navigate',
    payload: (args) => ({ direction: args.direction }),
    format: (data, args) => data.result || `Navigated ${args.direction}`,
  },
  {
    name: 'get_console_logs',
    description: 'Returns the recent console logs (log, warn, error, info) emitted by the active web page.',
    parameters: {
      limit: z.number().optional().default(50).describe('Max entries to return (default: 50)'),
    },
    endpoint: '/console/logs',
    payload: (args) => ({ limit: args.limit }),
    format: (data) => JSON.stringify(data.logs, null, 2),
  },
  {
    name: 'get_fingerprint_profile',
    description: 'Inspects the active hardware spoofing profile (User-Agent, Platform, Screen, WebGL, Audio).',
    parameters: {},
    endpoint: '/fingerprint',
    method: 'GET',
    format: (data) => JSON.stringify(data.profile, null, 2),
  },

  // 4. Tab Management
  {
    name: 'new_tab',
    description: 'Opens a new isolated browser tab in the Cyberdeck window and navigates to the given URL (default: about:blank).',
    parameters: {
      url: z.string().optional().describe('Initial URL to load'),
    },
    endpoint: '/tabs/new',
    payload: (args) => ({ url: args.url }),
    format: (data) => `Tab opened: ${data.tabId} (${data.url || 'about:blank'})`,
  },
  {
    name: 'switch_tab',
    description: 'Switches focus to an existing browser tab by its unique tab ID.',
    parameters: {
      tab_id: z.string().describe('ID of the tab to switch to (e.g. "tab_1")'),
    },
    endpoint: '/tabs/switch',
    payload: (args) => ({ tabId: args.tab_id }),
    format: (data) => `Switched to tab: ${data.tabId}`,
  },
  {
    name: 'close_tab',
    description: 'Closes a browser tab by its tab ID (or active tab if omitted).',
    parameters: {
      tab_id: z.string().optional().describe('ID of tab to close (optional)'),
    },
    endpoint: '/tabs/close',
    payload: (args) => ({ tabId: args.tab_id }),
    format: (data) => `Closed tab: ${data.tabId}`,
  },
  {
    name: 'list_tabs',
    description: 'Returns an array of all currently open tabs with their IDs, URLs, and page titles.',
    parameters: {},
    endpoint: '/tabs',
    method: 'GET',
    format: (data) => JSON.stringify(data.tabs, null, 2),
  },

  // 5. Memory & Cortex (LanceDB)
  {
    name: 'recall_memory',
    description: 'Performs semantic vector and full-text hybrid search across all previously visited and harvested web pages in the persistent Cortex.',
    parameters: {
      query: z.string().describe('Natural language query to search page history memory'),
      limit: z.number().optional().default(5).describe('Max results (default: 5)'),
      domain: z.string().optional().describe('Filter by domain (e.g. "wikipedia.org")'),
    },
    endpoint: '/memory/recall',
    payload: (args) => ({ query: args.query, limit: args.limit, domain: args.domain }),
    format: (data) => JSON.stringify(data.results, null, 2),
  },
  {
    name: 'get_history',
    description: 'Retrieves chronological browsing history from the Cortex store.',
    parameters: {
      limit: z.number().optional().default(20).describe('Max history entries (default: 20)'),
      domain: z.string().optional().describe('Filter by domain'),
    },
    endpoint: '/history/list',
    payload: (args) => ({ limit: args.limit, domain: args.domain }),
    format: (data) => JSON.stringify(data.history, null, 2),
  },
  {
    name: 'clear_history',
    description: 'Clears the chronological browsing history table in the Cortex database.',
    parameters: {},
    endpoint: '/history/clear',
    format: (data) => data.message || 'History cleared',
  },
  {
    name: 'add_bookmark',
    description: 'Saves a bookmark into the persistent Cortex library with custom tags and research notes.',
    parameters: {
      url: z.string().describe('Bookmark target URL'),
      title: z.string().describe('Descriptive title'),
      notes: z.string().optional().describe('Research notes or key takeaways'),
      tags: z.array(z.string()).optional().describe('Array of semantic categorization tags'),
    },
    endpoint: '/bookmarks/add',
    payload: (args) => ({ url: args.url, title: args.title, notes: args.notes, tags: args.tags }),
    format: (data, args) => `Bookmark saved: ${data.id || args.url}`,
  },
  {
    name: 'list_bookmarks',
    description: 'Retrieves saved bookmarks with optional semantic search query or tag filtering.',
    parameters: {
      query: z.string().optional().describe('Search query across bookmark titles and notes'),
      tag: z.string().optional().describe('Filter by exact tag'),
      limit: z.number().optional().default(20).describe('Max bookmarks to return'),
    },
    endpoint: '/bookmarks/list',
    payload: (args) => ({ query: args.query, tag: args.tag, limit: args.limit }),
    format: (data) => JSON.stringify(data.bookmarks, null, 2),
  },
  {
    name: 'delete_bookmark',
    description: 'Removes a bookmark by URL or ID from the persistent database.',
    parameters: {
      url_or_id: z.string().describe('The bookmark ID or exact URL to remove'),
    },
    endpoint: '/bookmarks/delete',
    payload: (args) => ({ urlOrId: args.url_or_id }),
    format: (data, args) => (data.deleted ? `Bookmark deleted: ${args.url_or_id}` : `Bookmark not found: ${args.url_or_id}`),
  },

  // 6. Shield & Forms
  {
    name: 'dismiss_consent',
    description: 'Autonomously scans active web page for cookie consent banners, GDPR dialogs, or blocking overlays and clicks Accept/Dismiss.',
    parameters: {},
    endpoint: '/shield/dismiss',
    format: (data) => JSON.stringify(data.result, null, 2),
  },
  {
    name: 'fill_form',
    description: 'Fills multiple form fields (inputs, textareas, dropdowns, checkboxes, radios) in a single turn with human-like typing cadence.',
    parameters: {
      fields: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).describe('Map of CSS selectors to values'),
      submit_selector: z.string().optional().describe('Optional CSS selector of submit button'),
    },
    endpoint: '/form/fill',
    payload: (args) => ({ fields: args.fields, submitSelector: args.submit_selector }),
    format: (data) => JSON.stringify(data.result, null, 2),
  },

  // 7. Downloads
  {
    name: 'list_downloads',
    description: 'Returns a list of all files downloaded into data/downloads/, including size and status.',
    parameters: {},
    endpoint: '/downloads',
    method: 'GET',
    format: (data) => JSON.stringify(data.downloads, null, 2),
  },
  {
    name: 'read_download',
    description: 'Reads parsed markdown text from a downloaded document file (PDF, CSV, JSON, TXT).',
    parameters: {
      filename: z.string().describe('Filename in data/downloads/ to read'),
    },
    endpoint: '/downloads/read',
    payload: (args) => ({ filename: args.filename }),
    format: (data) => data.content || JSON.stringify(data, null, 2),
  },

  // 8. Sessions & Cookies
  {
    name: 'save_session',
    description: 'Snapshots the current active browser session (cookies, localStorage, sessionStorage) into the persistent vault.',
    parameters: {
      name: z.string().describe('Unique name for the session snapshot (e.g. "github-auth")'),
    },
    endpoint: '/sessions/save',
    payload: (args) => ({ name: args.name }),
    format: (data, args) => `Session "${args.name}" saved successfully`,
  },
  {
    name: 'restore_session',
    description: 'Restores a previously saved session snapshot into the active browser partition.',
    parameters: {
      name: z.string().describe('Name of the session snapshot to restore'),
    },
    endpoint: '/sessions/restore',
    payload: (args) => ({ name: args.name }),
    format: (data, args) => `Session "${args.name}" restored successfully`,
  },
  {
    name: 'list_sessions',
    description: 'Returns all saved session profiles in the vault.',
    parameters: {},
    endpoint: '/sessions/list',
    method: 'GET',
    format: (data) => JSON.stringify(data.sessions, null, 2),
  },

  // 9. Network & API Interception
  {
    name: 'get_network_traffic',
    description: 'Inspects captured HTTP network requests and responses made by the active browser tab.',
    parameters: {
      url_pattern: z.string().optional().describe('URL substring or regex filter'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().describe('Filter by HTTP method'),
      resource_type: z.enum(['xhr', 'fetch', 'document', 'script', 'stylesheet', 'image', 'other']).optional().describe('Filter by resource type'),
      limit: z.number().optional().default(50).describe('Max records to return'),
    },
    endpoint: '/network/traffic',
    payload: (args) => ({
      urlPattern: args.url_pattern,
      method: args.method,
      resourceType: args.resource_type,
      limit: args.limit,
    }),
    format: (data) => JSON.stringify(data.traffic, null, 2),
  },
  {
    name: 'get_api_payload',
    description: 'Retrieves the complete JSON body of a specific API response captured during network interception.',
    parameters: {
      request_id: z.string().describe('ID of captured request'),
    },
    endpoint: '/network/payload',
    payload: (args) => ({ requestId: args.request_id }),
    format: (data) => JSON.stringify(data.payload, null, 2),
  },
  {
    name: 'clear_network_traffic',
    description: 'Clears the in-memory network traffic ring buffer.',
    parameters: {},
    endpoint: '/network/clear',
    format: (data) => data.message || 'Network traffic cleared',
  },

  // 10. Set-of-Marks (SoM) Grounding
  {
    name: 'take_annotated_screenshot',
    description: 'Visual Grounding with Set-of-Marks. Renders high-contrast numbered badges over interactable elements, takes a screenshot, and returns mark mapping.',
    parameters: {},
    endpoint: '/marks/screenshot',
    method: 'GET',
    format: (data) => JSON.stringify(data.marks, null, 2),
  },
  {
    name: 'click_mark',
    description: 'Clicks an annotated element using its Set-of-Marks badge index from take_annotated_screenshot.',
    parameters: {
      mark_id: z.coerce.number().describe('The numeric ID of the mark badge to click'),
    },
    endpoint: '/marks/click',
    payload: (args) => ({ markId: Number(args.mark_id ?? args.markId ?? args.mark ?? args.id) }),
    format: (data, args) => `Clicked mark #${args.mark_id}`,
  },
  {
    name: 'type_mark',
    description: 'Types text into an annotated input element using its Set-of-Marks badge index.',
    parameters: {
      mark_id: z.coerce.number().describe('The numeric ID of the mark badge to type into'),
      text: z.coerce.string().describe('Text to type'),
      clear_first: z.coerce.boolean().optional().default(false).describe('Whether to clear existing text before typing'),
    },
    endpoint: '/marks/type',
    payload: (args) => ({
      markId: Number(args.mark_id ?? args.markId ?? args.mark ?? args.id),
      text: String(args.text ?? args.value ?? ''),
      clearFirst: args.clear_first ?? args.clearFirst ?? false,
    }),
    format: (data, args) => `Typed into mark #${args.mark_id}`,
  },

  // 11. Script Vault & Macro Engine
  {
    name: 'save_script',
    description: 'Saves a reusable browser JavaScript automation script into the persistent vault and Cortex vector index.',
    parameters: {
      name: z.string().describe('Unique name of the script'),
      description: z.string().describe('Natural language description of what the script does'),
      code: z.string().describe('Executable JavaScript code string'),
      parameters: z.record(z.string(), z.string()).optional().describe('Map of parameter names to descriptions'),
    },
    endpoint: '/scripts/save',
    payload: (args) => ({ name: args.name, description: args.description, code: args.code, parameters: args.parameters }),
    format: (data, args) => `Script "${args.name}" vaulted successfully`,
  },
  {
    name: 'recall_script',
    description: 'Semantically searches the Script Vault using natural language to find reusable automation scripts.',
    parameters: {
      query: z.string().describe('Natural language query of desired automation task'),
      limit: z.number().optional().default(3).describe('Max scripts to return'),
    },
    endpoint: '/scripts/recall',
    payload: (args) => ({ query: args.query, limit: args.limit }),
    format: (data) => JSON.stringify(data.scripts, null, 2),
  },
  {
    name: 'run_script',
    description: 'Executes a saved script from the Script Vault inside the active tab context with dynamic arguments.',
    parameters: {
      name: z.string().describe('Name of the script to execute'),
      args: z.record(z.string(), z.any()).optional().describe('Key-value arguments passed into script execution context'),
    },
    endpoint: '/scripts/run',
    payload: (args) => ({ name: args.name, args: args.args }),
    format: (data) => JSON.stringify(data.result, null, 2),
  },
  {
    name: 'list_scripts',
    description: 'Returns all saved automation scripts in the Script Vault.',
    parameters: {},
    endpoint: '/scripts/list',
    method: 'GET',
    format: (data) => JSON.stringify(data.scripts, null, 2),
  },
  {
    name: 'delete_script',
    description: 'Deletes a saved script from the persistent vault and LanceDB vector index.',
    parameters: {
      name: z.string().describe('Name of script to delete'),
    },
    endpoint: '/scripts/delete',
    payload: (args) => ({ name: args.name }),
    format: (data, args) => (data.deleted ? `Deleted script "${args.name}"` : `Script "${args.name}" not found`),
  },

  // 12. WebSocket & SSE Streams
  {
    name: 'list_realtime_streams',
    description: 'Returns all active and recent WebSockets (wss://) and Server-Sent Events (SSE) connections.',
    parameters: {
      type: z.enum(['websocket', 'sse']).optional().describe('Filter by protocol'),
      active_only: z.boolean().optional().describe('Filter for open streams only (default: false)'),
    },
    endpoint: '/streams/list',
    payload: (args) => ({ type: args.type, activeOnly: args.active_only }),
    format: (data) => JSON.stringify(data.streams, null, 2),
  },
  {
    name: 'get_stream_messages',
    description: 'Inspects captured incoming and outgoing real-time messages / frames from WebSockets or SSE.',
    parameters: {
      stream_id: z.string().optional().describe('Filter by specific streamId'),
      type: z.enum(['websocket', 'sse']).optional().describe('Filter by protocol'),
      direction: z.enum(['sent', 'received']).optional().describe('Filter by direction'),
      limit: z.number().optional().default(50).describe('Max frames to return'),
    },
    endpoint: '/streams/messages',
    payload: (args) => ({ streamId: args.stream_id, type: args.type, direction: args.direction, limit: args.limit }),
    format: (data) => JSON.stringify(data.messages, null, 2),
  },
  {
    name: 'clear_stream_messages',
    description: 'Clears the in-memory WebSocket and SSE message frame buffer.',
    parameters: {
      stream_id: z.string().optional().describe('Optional specific streamId to clear'),
    },
    endpoint: '/streams/clear',
    payload: (args) => ({ streamId: args.stream_id }),
    format: (data) => data.message || 'Stream messages cleared',
  },

  // 13. System Tray & Window Visibility
  {
    name: 'set_window_visibility',
    description: 'Controls the cyberdeck desktop window visibility (e.g. minimize to system tray to stay out of the user\'s way, or restore to screen).',
    parameters: {
      visible: z.boolean().describe('true to restore and focus window; false to minimize/hide to system tray'),
    },
    endpoint: '/window/visibility',
    payload: (args) => ({ visible: args.visible }),
    format: (data, args) => JSON.stringify({ success: true, visible: data.visible, state: args.visible ? 'WINDOW_RESTORED' : 'MINIMIZED_TO_TRAY' }),
  },
  {
    name: 'configure_system_tray',
    description: 'Inspects or configures system tray behavior (such as enabling/disabling close-to-tray).',
    parameters: {
      close_to_tray: z.boolean().optional().describe('If specified, enables (true) or disables (false) minimize-to-tray when closing window'),
    },
    endpoint: '/window/tray',
    payload: (args) => ({ closeToTray: args.close_to_tray }),
    format: (data) => JSON.stringify({ close_to_tray: data.closeToTray }, null, 2),
  },

  // 14. Human-In-The-Loop (HIL) Intervention & Desktop Notifications
  {
    name: 'request_human_intervention',
    description: 'Halts the agent and requests human assistance when credentials, 2FA, OTP, CAPTCHA, or manual approval are needed. Restores window, flashes taskbar, triggers desktop notification, and injects interactive banner.',
    parameters: {
      reason: z.string().describe('Clear explanation of what human action is needed'),
      timeout_seconds: z.number().optional().describe('Max seconds to wait (default: 180)'),
      bring_to_front: z.boolean().optional().describe('Whether to unhide/restore window from tray (default: true)'),
    },
    endpoint: '/hil/request',
    payload: (args) => ({ reason: args.reason, timeoutSeconds: args.timeout_seconds, bringToFront: args.bring_to_front }),
    format: (data) => JSON.stringify(data.result, null, 2),
  },
  {
    name: 'resolve_human_intervention',
    description: 'Resolves an active human intervention request, unpausing the agent.',
    parameters: {
      id: z.string().optional().describe('Specific intervention ID'),
      notes: z.string().optional().describe('Confirmation notes or summary of action taken'),
    },
    endpoint: '/hil/resolve',
    payload: (args) => ({ id: args.id, notes: args.notes }),
    format: (data, args) => (data.resolved ? `Intervention resolved: ${args.notes || 'User confirmed.'}` : 'No pending intervention request found.'),
  },
  {
    name: 'get_human_intervention_status',
    description: 'Inspects current human intervention state and request history.',
    parameters: {},
    endpoint: '/hil/active',
    method: 'GET',
    format: (data) => JSON.stringify(data, null, 2),
  },
  {
    name: 'send_notification',
    description: 'Dispatches an OS native desktop notification to alert the user without blocking agent execution.',
    parameters: {
      title: z.string().describe('Notification title'),
      message: z.string().describe('Notification body message'),
      urgency: z.enum(['normal', 'critical', 'low']).optional().describe('Urgency level (default: normal)'),
      sound: z.boolean().optional().describe('Whether to play notification alert sound (default: true)'),
    },
    endpoint: '/notify',
    payload: (args) => ({ title: args.title, message: args.message, urgency: args.urgency, sound: args.sound }),
    format: (data, args) => JSON.stringify({ success: data.sent, title: args.title, message: args.message }),
  },
];
