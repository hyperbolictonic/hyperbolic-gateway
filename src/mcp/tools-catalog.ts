import { z } from 'zod';
import { formatMark } from './format-mark.js';

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
      url: z.string().describe('The destination URL (e.g. "https://news.ycombinator.com" or "https://www.skyscanner.net")'),
      auto_dismiss_consent: z.boolean().optional().default(true).describe('Whether to automatically detect and dismiss cookie/GDPR consent overlays (default: true)'),
    },
    endpoint: '/navigate',
    payload: (args) => {
      let targetUrl = args?.url || args?.destination || args?.target || args?.link || args?.href || args?.address || '';
      if (typeof targetUrl === 'string' && targetUrl) {
        if (!/^https?:\/\//i.test(targetUrl) && !/^about:/i.test(targetUrl) && !/^mark-eleven:/i.test(targetUrl)) {
          targetUrl = 'https://' + targetUrl;
        }
      }
      if (!targetUrl) {
        throw new Error('Missing destination URL. Please provide { "url": "https://..." }');
      }
      return { url: targetUrl, autoDismissConsent: args?.auto_dismiss_consent ?? true };
    },
    format: (data) => data.result || 'Navigation complete',
  },
  {
    name: 'go_to_url',
    description: 'Alias for navigate_to. Navigates the browser window to a destination URL.',
    parameters: {
      url: z.string().describe('The destination URL (e.g. "https://www.skyscanner.net")'),
    },
    endpoint: '/navigate',
    payload: (args) => {
      let targetUrl = args?.url || args?.destination || args?.target || args?.link || args?.href || args?.address || '';
      if (typeof targetUrl === 'string' && targetUrl) {
        if (!/^https?:\/\//i.test(targetUrl) && !/^about:/i.test(targetUrl) && !/^mark-eleven:/i.test(targetUrl)) {
          targetUrl = 'https://' + targetUrl;
        }
      }
      if (!targetUrl) {
        throw new Error('Missing destination URL. Please provide { "url": "https://..." }');
      }
      return { url: targetUrl };
    },
    format: (data) => data.result || 'Navigation complete',
  },

  // 2. Interaction
  {
    name: 'click_element',
    description: 'Clicks an element on the active web page using a CSS selector or direct viewport coordinates (x, y). Simulates realistic human pointer movement and switch actuation.',
    parameters: {
      selector: z.string().optional().describe('CSS selector of the element to click (e.g. "button.submit", "a[href*=\'login\']", "#search-input")'),
      x: z.coerce.number().optional().describe('Direct X coordinate on the viewport in pixels'),
      y: z.coerce.number().optional().describe('Direct Y coordinate on the viewport in pixels'),
    },
    endpoint: '/click',
    payload: (args) => {
      const selector = args?.selector || args?.element || args?.target || args?.css || args?.query;
      const x = args?.x !== undefined ? Number(args.x) : undefined;
      const y = args?.y !== undefined ? Number(args.y) : undefined;
      if (!selector && (x === undefined || y === undefined)) {
        throw new Error('Missing click target. Please provide either a "selector" (CSS selector) or ("x", "y") viewport coordinates.');
      }
      return { selector, x, y };
    },
    format: (data) => data.result || 'Click executed',
  },
  {
    name: 'type_text',
    description: 'Types text into an input element or active element with realistic human Gaussian typing cadence (60-240ms per keystroke).',
    parameters: {
      text: z.string().describe('The text string to type (e.g. "London")'),
      selector: z.string().optional().describe('Optional CSS selector of the input element'),
    },
    endpoint: '/type',
    payload: (args) => {
      const text = args?.text !== undefined ? String(args.text) : (args?.value !== undefined ? String(args.value) : (args?.content !== undefined ? String(args.content) : (args?.input !== undefined ? String(args.input) : '')));
      const selector = args?.selector || args?.element || args?.target || args?.css;
      return { text, selector };
    },
    format: (data) => data.result || 'Text typed successfully',
  },
  {
    name: 'press_key',
    description: 'Dispatches a single hardware keyboard event (Enter, Tab, Escape, Backspace, ArrowDown, etc.).',
    parameters: {
      key: z.string().describe('The key name to press (e.g. "Enter", "Tab", "Escape", "Backspace")'),
    },
    endpoint: '/press-key',
    payload: (args) => {
      const key = args?.key || args?.key_name || args?.button || 'Enter';
      return { key };
    },
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
    payload: (args) => ({ direction: args?.direction || 'down', amount: args?.amount !== undefined ? Number(args.amount) : 400 }),
    format: (data) => data.result || 'Scrolled successfully',
  },

  // 3. Visual & Inspection
  {
    name: 'take_screenshot',
    description: 'Captures a full viewport image of the active tab. Saves to data/screenshots/ and returns local file path and native MCP image content.',
    parameters: {},
    endpoint: '/screenshot',
    method: 'GET',
    format: (data) => data.screenshot?.filePath ? `Screenshot saved to ${data.screenshot.filePath} (${data.screenshot.width || ''}x${data.screenshot.height || ''}px)` : 'Screenshot captured',
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
      script: z.string().describe('JavaScript code to evaluate in the page context (e.g. "document.title" or "1+1")'),
    },
    endpoint: '/evaluate',
    payload: (args) => {
      const script = args?.script || args?.code || args?.js || args?.expression || args?.javascript || '';
      if (!script) {
        throw new Error('Missing script to evaluate. Please provide { "script": "..." }');
      }
      return { script };
    },
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
    format: (data) => {
      const logs = Array.isArray(data.logs) ? data.logs : [];
      if (logs.length === 0) return 'No console logs captured.';
      const lines = logs.map((l: any) => {
        const time = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '';
        const level = (l.level || 'info').toUpperCase().padEnd(5);
        return `[${time}] ${level} ${l.message || ''}`;
      });
      return `### Console Logs (${logs.length})\n${lines.join('\n')}`;
    },
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
      url: z.string().optional().describe('Initial URL to load (e.g. "https://news.ycombinator.com")'),
    },
    endpoint: '/tabs/new',
    payload: (args) => {
      let targetUrl = args?.url || args?.destination || args?.target || args?.link || args?.href || args?.address || '';
      if (typeof targetUrl === 'string' && targetUrl) {
        if (!/^https?:\/\//i.test(targetUrl) && !/^about:/i.test(targetUrl) && !/^mark-eleven:/i.test(targetUrl)) {
          targetUrl = 'https://' + targetUrl;
        }
      }
      return { url: targetUrl };
    },
    format: (data) => `Tab opened: ${data.tab?.id || data.tabId} (${data.tab?.url || data.url || 'about:blank'})`,
  },
  {
    name: 'switch_tab',
    description: 'Switches focus to an existing browser tab by its unique tab ID.',
    parameters: {
      tab_id: z.coerce.string().describe('ID of the tab to switch to (e.g. "tab_1" or "1")'),
    },
    endpoint: '/tabs/switch',
    payload: (args) => {
      let rawId = args?.tab_id ?? args?.tabId ?? args?.tab ?? args?.id;
      if (rawId === undefined || rawId === null || rawId === '') {
        throw new Error('Missing tab_id. Please provide { "tab_id": "tab_1" } or call list_tabs() first.');
      }
      const tabId = typeof rawId === 'number' ? `tab_${rawId}` : String(rawId).startsWith('tab_') ? String(rawId) : !isNaN(Number(rawId)) ? `tab_${rawId}` : String(rawId);
      return { tabId };
    },
    format: (data, args) => data.message || `Switched to tab: ${args?.tab_id || data.tabId}`,
  },
  {
    name: 'close_tab',
    description: 'Closes a browser tab by its tab ID (or active tab if omitted).',
    parameters: {
      tab_id: z.coerce.string().optional().describe('ID of tab to close (optional, closes active tab if omitted)'),
    },
    endpoint: '/tabs/close',
    payload: (args) => {
      let rawId = args?.tab_id ?? args?.tabId ?? args?.tab ?? args?.id;
      const tabId = rawId !== undefined && rawId !== null && rawId !== ''
        ? (typeof rawId === 'number' ? `tab_${rawId}` : String(rawId).startsWith('tab_') ? String(rawId) : !isNaN(Number(rawId)) ? `tab_${rawId}` : String(rawId))
        : undefined;
      return { tabId };
    },
    format: (data, args) => data.message || `Closed tab: ${args?.tab_id || data.tabId || 'active'}`,
  },
  {
    name: 'list_tabs',
    description: 'Returns an array of all currently open tabs with their IDs, URLs, and page titles.',
    parameters: {},
    endpoint: '/tabs',
    method: 'GET',
    format: (data) => {
      const tabs = Array.isArray(data.tabs) ? data.tabs : [];
      if (tabs.length === 0) return 'No open tabs';
      return tabs.map((t: any) => `${t.isActive ? '* ' : '- '}[${t.id}] ${t.isLoading ? '(loading) ' : ''}"${t.title || 'Untitled'}" - ${t.url}`).join('\n');
    },
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
    format: (data) => {
      const hist = Array.isArray(data.history) ? data.history : [];
      if (hist.length === 0) return 'No browsing history entries found.';
      const lines = hist.map((h: any) => {
        const time = h.visitedAt ? new Date(h.visitedAt).toLocaleDateString() : '';
        return `- [${time}] "${h.title || 'Untitled'}" - ${h.url}`;
      });
      return `### Browsing History (${hist.length})\n${lines.join('\n')}`;
    },
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
    format: (data) => {
      const bm = Array.isArray(data.bookmarks) ? data.bookmarks : [];
      if (bm.length === 0) return 'No bookmarks found.';
      const lines = bm.map((b: any) => {
        const tags = Array.isArray(b.tags) && b.tags.length > 0 ? ` [${b.tags.join(', ')}]` : '';
        return `- [${b.id || 'bm'}] "${b.title || 'Untitled'}" - ${b.url}${tags}`;
      });
      return `### Saved Bookmarks (${bm.length})\n${lines.join('\n')}`;
    },
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
    format: (data) => {
      const dls = Array.isArray(data.downloads) ? data.downloads : [];
      if (dls.length === 0) return 'No downloaded files found in data/downloads/.';
      const lines = dls.map((d: any) => {
        const sizeKb = d.size ? `${Math.round(d.size / 1024)}KB` : 'unknown size';
        const status = d.state || d.status || 'completed';
        return `- ${d.filename || d.name} (${sizeKb}, ${status}) - path: ${d.path || d.filename}`;
      });
      return `### Downloaded Files (${dls.length})\n${lines.join('\n')}`;
    },
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
    format: (data) => {
      const sess = Array.isArray(data.sessions) ? data.sessions : [];
      if (sess.length === 0) return 'No saved sessions found in vault.';
      const lines = sess.map((s: any) => {
        const cookies = s.cookieCount !== undefined ? `${s.cookieCount} cookies` : '';
        const savedAt = s.savedAt ? new Date(s.savedAt).toLocaleDateString() : '';
        return `- "${s.name || s.id}" (${[cookies, savedAt].filter(Boolean).join(', ')})`;
      });
      return `### Vault Sessions (${sess.length})\n${lines.join('\n')}`;
    },
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
    format: (data) => {
      const list = Array.isArray(data.traffic) ? data.traffic : [];
      if (list.length === 0) return 'No matching network requests captured.';
      const lines = list.map((r: any) => {
        const status = r.status ? String(r.status) : 'pending';
        const dur = r.responseDurationMs !== undefined ? `${r.responseDurationMs}ms` : '';
        const bodyTag = r.hasBody ? ' [HAS_BODY]' : '';
        return `[${r.requestId}] ${status} ${r.method} ${r.url.slice(0, 80)}${r.url.length > 80 ? '...' : ''} (${r.resourceType}${dur ? `, ${dur}` : ''})${bodyTag}`;
      });
      return `### Captured Network Requests (${list.length})\nUse query_json_data({ source: "network_payload", source_id: "<requestId>" }) to inspect JSON bodies.\n\n${lines.join('\n')}`;
    },
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
  {
    name: 'query_json_data',
    description: 'Token-efficient JSON navigator. Inspects schemas, extracts nested dot/bracket paths (e.g. "items[0..3].price"), searches keys, or runs filters without dumping massive multi-megabyte payloads into the LLM context.',
    parameters: {
      source: z.enum(['network_payload', 'stream_messages', 'download_file', 'inline_json']).default('network_payload').describe('Data source: "network_payload" (from get_network_traffic), "stream_messages" (from list_realtime_streams), "download_file" (from data/downloads/), or "inline_json"'),
      source_id: z.string().optional().describe('Target request ID, stream ID, or download filename'),
      path: z.string().optional().describe('JSONPath / dot-notation query, e.g. "itineraries[0..3].pricing", "users[*].email", "items[?price < 300]"'),
      view: z.enum(['value', 'schema', 'keys', 'summary']).optional().default('value').describe('Inspection mode: "schema" (types and array lengths without data), "keys" (object keys list), "summary" (high-level structure sample), or "value" (extracted target slice)'),
      limit: z.coerce.number().optional().default(25).describe('Max array items to return (default: 25)'),
      filter_predicate: z.string().optional().describe('Filter expression for array elements, e.g. "price < 300", "usesCookies == true". Tip: Apply to object arrays (e.g. path="vendors") rather than leaf string projections (e.g. "vendors.name")'),
      json_string: z.string().optional().describe('Inline JSON string (when source is "inline_json")'),
    },
    endpoint: '/json/query',
    payload: (args) => ({
      source: args?.source || 'network_payload',
      sourceId: args?.source_id ?? args?.sourceId ?? args?.requestId ?? args?.request_id ?? args?.streamId ?? args?.stream_id ?? args?.filename,
      path: args?.path ?? args?.query,
      view: args?.view ?? args?.mode ?? 'value',
      limit: args?.limit !== undefined ? Number(args.limit) : 25,
      filterPredicate: args?.filter_predicate ?? args?.filterPredicate ?? args?.filter,
      jsonString: args?.json_string ?? args?.jsonString ?? args?.json,
    }),
    format: (data) => {
      const header = `### JSON Navigator Query [${data.path || '$'}] (view: ${data.view}${data.matchCount !== undefined ? `, total: ${data.matchCount}` : ''})\n`;
      if (typeof data.data === 'string') return `${header}${data.data}`;
      return `${header}\`\`\`json\n${JSON.stringify(data.data, null, 2)}\n\`\`\``;
    },
  },
  {
    name: 'snapshot_rendered_page',
    description: 'Captures a post-hydration, rendered point-in-time snapshot of dynamic, JavaScript-heavy pages (React, Next.js, Vue). Freezes live state, pierces Shadow DOM, and extracts ultra-token-efficient Accessibility (AX) Trees or rendered Markdown.',
    parameters: {
      format: z.enum(['ax_tree', 'markdown', 'html', 'unrendered_html']).optional().default('ax_tree').describe('Snapshot format: "ax_tree" (recommended: semantic roles, labels, and states with zero cosmetic div noise), "markdown" (computed DOM markdown with live values), "html" (rendered static HTML), or "unrendered_html" (raw pre-mutation HTML source)'),
      wait_until_idle_ms: z.coerce.number().optional().default(400).describe('Time in ms to wait for pending network microtasks and React state updates to settle (default: 400)'),
      pierce_shadow_dom: z.coerce.boolean().optional().default(true).describe('Whether to traverse and unwrap encapsulated Shadow Roots (#shadow-root)'),
      save_to_disk: z.coerce.boolean().optional().default(false).describe('Whether to persist snapshot to data/snapshots/ for offline re-inspection via query_json_data'),
      force_rerender: z.coerce.boolean().optional().default(false).describe('Whether to force reflow and dispatch resize events to trigger re-renders before snapshotting'),
    },
    endpoint: '/snapshot/rendered',
    payload: (args) => ({
      format: args?.format || 'ax_tree',
      waitUntilIdleMs: args?.wait_until_idle_ms !== undefined ? Number(args.wait_until_idle_ms) : 400,
      pierceShadowDom: args?.pierce_shadow_dom !== undefined ? Boolean(args.pierce_shadow_dom) : true,
      saveToDisk: args?.save_to_disk !== undefined ? Boolean(args.save_to_disk) : false,
      forceRerender: args?.force_rerender !== undefined ? Boolean(args.force_rerender) : false,
    }),
    format: (data) => {
      const stats = data.stats || {};
      const fileNotice = data.filePath ? ` (Saved to: ${data.filePath})` : '';
      const header = `### Rendered Page Snapshot [${data.format?.toUpperCase()}] — "${data.title}" (${stats.estimatedTokens || 0} est tokens, ${stats.byteLength || 0} bytes)${fileNotice}\nURL: ${data.url}\n\n`;
      return `${header}${data.content || 'Snapshot empty'}`;
    },
  },
  {
    name: 'prerender_links',
    description: 'Speculative Pre-rendering Engine. Pre-executes, hydrates, and caches candidate links in background views so subsequent navigation is 0ms instantaneous. Automatically distills and indexes content into LanceDB Cortex memory.',
    parameters: {
      urls: z.array(z.string()).optional().describe('Specific candidate URLs to prerender. If omitted, uses selector or page link heuristics'),
      selector: z.string().optional().describe('CSS selector to pick candidate links from the active page (e.g. "a.search-result", ".docs-nav a")'),
      max_pages: z.coerce.number().optional().default(3).describe('Maximum candidate pages to prerender in background pool (max: 3)'),
      harvest_to_cortex: z.coerce.boolean().optional().default(true).describe('Whether to automatically distill and index pre-rendered pages into LanceDB Cortex memory for instant recall_memory'),
      wait_until_idle_ms: z.coerce.number().optional().default(500).describe('Hydration wait time per candidate view'),
    },
    endpoint: '/prerender/links',
    payload: (args) => ({
      urls: args?.urls,
      selector: args?.selector,
      maxPages: args?.max_pages !== undefined ? Number(args.max_pages) : 3,
      harvestToCortex: args?.harvest_to_cortex !== undefined ? Boolean(args.harvest_to_cortex) : true,
      waitUntilIdleMs: args?.wait_until_idle_ms !== undefined ? Number(args.wait_until_idle_ms) : 500,
    }),
    format: (data) => {
      const list = Array.isArray(data.prerendered) ? data.prerendered : [];
      if (list.length === 0) return 'No candidate links were pre-rendered.';
      const lines = list.map((u: string) => `- [0ms READY] ${u}`);
      return `### Speculative Pre-rendered Pool (${list.length} pages warm & indexed to Cortex)\nSubsequent navigate_to() calls targeting these URLs will load with 0ms perceived latency.\n\n${lines.join('\n')}`;
    },
  },

  // 10. Set-of-Marks (SoM) Grounding
  {
    name: 'take_annotated_screenshot',
    description: 'Visual Grounding with Set-of-Marks. Renders high-contrast numbered badges over interactable elements, takes a screenshot, saves to data/screenshots/, and returns both native image and mark mapping.',
    parameters: {},
    endpoint: '/marks/screenshot',
    method: 'GET',
    format: (data) => (Array.isArray(data.marks) ? data.marks.map((m: any) => formatMark(m)).join('\n') : JSON.stringify(data)),
  },
  {
    name: 'take_economy_screenshot',
    description: 'Lightweight Set-of-Marks screenshot: downscaled to 640px wide JPEG (~10-20x smaller than take_annotated_screenshot) plus the same mark mapping. Use for vision models when token/bandwidth cost matters.',
    parameters: {},
    endpoint: '/marks/screenshot?economy=1',
    method: 'GET',
    format: (data) => (Array.isArray(data.marks) ? data.marks.map((m: any) => formatMark(m)).join('\n') : JSON.stringify(data)),
  },
  {
    name: 'list_marks',
    description: 'Text-only Set-of-Marks: returns the numbered interactive element table with NO image. Use for text-only models or the cheapest possible page scan; click_mark / type_mark work afterwards.',
    parameters: {},
    endpoint: '/marks/screenshot?text_only=1',
    method: 'GET',
    format: (data) => (Array.isArray(data.marks) ? data.marks.map((m: any) => formatMark(m)).join('\n') : JSON.stringify(data)),
  },
  {
    name: 'click_mark',
    description: 'Clicks an annotated element using its Set-of-Marks badge index from take_annotated_screenshot.',
    parameters: {
      mark_id: z.coerce.number().describe('The numeric ID of the mark badge to click (e.g. 1)'),
    },
    endpoint: '/marks/click',
    payload: (args) => {
      const raw = args?.mark_id ?? args?.markId ?? args?.mark ?? args?.id ?? args?.badge ?? args?.index ?? args?.num ?? args?.number;
      if (raw === undefined || raw === null || isNaN(Number(raw))) {
        throw new Error('Missing mark_id. Please provide { "mark_id": 1 } from take_annotated_screenshot().');
      }
      return { markId: Number(raw) };
    },
    format: (data, args) => `Clicked mark #${args?.mark_id ?? args?.markId ?? args?.mark ?? args?.id ?? args?.badge ?? args?.index ?? args?.num ?? args?.number}`,
  },
  {
    name: 'type_mark',
    description: 'Types text into an annotated input element using its Set-of-Marks badge index.',
    parameters: {
      mark_id: z.coerce.number().describe('The numeric ID of the mark badge to type into (e.g. 1)'),
      text: z.string().describe('The text string to type into the marked element (e.g. "London")'),
      clear_first: z.coerce.boolean().optional().default(false).describe('Whether to clear existing text before typing'),
    },
    endpoint: '/marks/type',
    payload: (args) => {
      const rawId = args?.mark_id ?? args?.markId ?? args?.mark ?? args?.id ?? args?.badge ?? args?.index ?? args?.num ?? args?.number;
      if (rawId === undefined || rawId === null || isNaN(Number(rawId))) {
        throw new Error('Missing mark_id. Please provide { "mark_id": 1, "text": "..." }');
      }
      const text = String(args?.text ?? args?.value ?? args?.content ?? args?.input ?? '');
      const clearFirst = Boolean(args?.clear_first ?? args?.clearFirst ?? false);
      return { markId: Number(rawId), text, clearFirst };
    },
    format: (data, args) => `Typed into mark #${args?.mark_id ?? args?.markId ?? args?.mark ?? args?.id ?? args?.badge ?? args?.index ?? args?.num ?? args?.number}`,
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
    format: (data) => {
      const scripts = Array.isArray(data.scripts) ? data.scripts : [];
      if (scripts.length === 0) return 'No matching scripts found in vault.';
      const lines = scripts.map((s: any) => `- "${s.name}" (score: ${s.score ? s.score.toFixed(2) : 'n/a'}): ${s.description || 'No description'}`);
      return `### Recalled Scripts (${scripts.length})\n${lines.join('\n')}`;
    },
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
    format: (data) => {
      const scripts = Array.isArray(data.scripts) ? data.scripts : [];
      if (scripts.length === 0) return 'No scripts saved in vault.';
      const lines = scripts.map((s: any) => `- "${s.name}": ${s.description || 'No description'}`);
      return `### Script Vault (${scripts.length})\n${lines.join('\n')}`;
    },
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
    format: (data) => {
      const list = Array.isArray(data.streams) ? data.streams : [];
      if (list.length === 0) return 'No realtime streams (WebSocket/SSE) captured.';
      const lines = list.map((s: any) => {
        const state = s.closed ? 'closed' : 'OPEN';
        return `[${s.streamId}] ${s.type.toUpperCase()} ${state} ${s.url} (msgs: ${s.messageCount || 0})`;
      });
      return `### Realtime Streams (${list.length})\nUse query_json_data({ source: "stream_messages", source_id: "<streamId>" }) to inspect stream data.\n\n${lines.join('\n')}`;
    },
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
    format: (data) => {
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      if (msgs.length === 0) return 'No stream messages captured.';
      const lines = msgs.map((m: any) => {
        const dir = (m.direction || 'msg').toUpperCase();
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
        const preview = typeof m.data === 'string' ? m.data.slice(0, 100) : JSON.stringify(m.data || m.jsonData || '').slice(0, 100);
        return `[${time}] ${dir} (stream: ${m.streamId || 'n/a'}): ${preview}`;
      });
      return `### Realtime Messages (${msgs.length})\n${lines.join('\n')}`;
    },
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
      visible: z.coerce.boolean().optional().describe('true to restore and focus window; false to minimize/hide to system tray'),
    },
    endpoint: '/window/visibility',
    payload: (args) => ({ visible: args?.visible !== undefined ? Boolean(args.visible) : true }),
    format: (data, args) => JSON.stringify({ success: true, visible: data.visible, state: (args?.visible ?? true) ? 'WINDOW_RESTORED' : 'MINIMIZED_TO_TRAY' }),
  },
  {
    name: 'configure_system_tray',
    description: 'Inspects or configures system tray behavior (such as enabling/disabling close-to-tray).',
    parameters: {
      close_to_tray: z.boolean().optional().describe('If specified, enables (true) or disables (false) minimize-to-tray when closing window'),
    },
    endpoint: '/window/tray',
    payload: (args) => ({ closeToTray: args?.close_to_tray }),
    format: (data) => JSON.stringify({ close_to_tray: data.closeToTray }, null, 2),
  },

  // 14. Human-In-The-Loop (HIL) Intervention & Desktop Notifications
  {
    name: 'request_human_intervention',
    description: 'Halts the agent and requests human assistance when credentials, 2FA, OTP, CAPTCHA, or manual approval are needed. Restores window, flashes taskbar, triggers desktop notification, and injects interactive banner.',
    parameters: {
      reason: z.string().describe('Clear explanation of what human action is needed (e.g. "Please solve the CAPTCHA")'),
      timeout_seconds: z.number().optional().describe('Max seconds to wait (default: 180)'),
      bring_to_front: z.boolean().optional().default(true).describe('Whether to unhide/restore window from tray (default: true)'),
    },
    endpoint: '/hil/request',
    payload: (args) => {
      const reason = args?.reason || args?.message || args?.prompt || 'Human assistance requested by AI agent.';
      const timeoutSeconds = args?.timeout_seconds !== undefined ? Number(args.timeout_seconds) : undefined;
      const bringToFront = args?.bring_to_front ?? true;
      return { reason, timeoutSeconds, bringToFront };
    },
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
    payload: (args) => ({ id: args?.id, notes: args?.notes }),
    format: (data, args) => (data.resolved ? `Intervention resolved: ${args?.notes || 'User confirmed.'}` : 'No pending intervention request found.'),
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
      message: z.string().describe('Notification body message'),
      title: z.string().optional().default('Kuang Grade Mark Eleven').describe('Notification title'),
      urgency: z.enum(['normal', 'critical', 'low']).optional().default('normal').describe('Urgency level (default: normal)'),
      sound: z.boolean().optional().default(true).describe('Whether to play notification alert sound (default: true)'),
    },
    endpoint: '/notify',
    payload: (args) => {
      const title = args?.title || 'Kuang Grade Mark Eleven';
      const message = args?.message || args?.text || args?.body || 'Agent notification';
      return { title, message, urgency: args?.urgency, sound: args?.sound };
    },
    format: (data, args) => JSON.stringify({ success: data.sent, title: args?.title || 'Kuang Grade Mark Eleven', message: args?.message || 'Notification sent' }),
  },
];
