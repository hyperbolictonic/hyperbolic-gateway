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
  /** Resolves the endpoint per call (one tool fronting two routes). Defaults to `endpoint`. */
  endpointFor?: (args: any) => string;
  /** Every route this tool may call; validated by the contract test. Defaults to `[endpoint]`. */
  endpoints?: string[];
  /**
   * Hidden from `tools/list` (and therefore from agent tool pickers) but still
   * callable by name via `tools/call` for one release. Used for deprecated
   * aliases and renamed tools; see docs/TOOL_CATALOG_REVIEW.md.
   */
  hidden?: boolean;
  /** Canonical tool this deprecated name forwards to (drives the call-time notice). */
  deprecatedInFavorOf?: string;
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
    hidden: true,
    deprecatedInFavorOf: 'navigate_to',
    description: 'Deprecated alias for navigate_to. Navigates the browser window to a destination URL.',
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
    hidden: true,
    deprecatedInFavorOf: 'act',
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
    hidden: true,
    deprecatedInFavorOf: 'act',
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

  {
    name: 'take_screenshot',
    description: 'Captures the active viewport. Two modes. PLAIN (default): fast 768px JPEG (~15ms), saved to data/screenshots/, returns the file path plus native image content. SET-OF-MARKS (marks=true): numbered badges on interactive elements — detail="full" (full-res PNG), detail="economy" (640px JPEG, ~10-20x lighter; best for vision), or detail="markdown" (marks table only, NO image; cheapest). Badge ids feed act(mark_id, action).',
    parameters: {
      marks: z.coerce.boolean().optional().default(false).describe('true = Set-of-Marks (badge interactive elements, return the marks table); false = plain viewport image (default)'),
      detail: z.enum(['full', 'economy', 'markdown']).optional().default('full').describe('Only when marks=true: "full" (PNG), "economy" (640px JPEG), or "markdown" (marks table only, no image)'),
      include_offscreen: z.coerce.boolean().optional().default(false).describe('Only when marks=true: also badge elements outside the viewport (long/virtualized lists)'),
      max_width: z.coerce.number().optional().default(768).describe('Plain mode only: max width in pixels (default 768; pass 0 for full native resolution)'),
      format: z.enum(['jpeg', 'png']).optional().default('jpeg').describe('Plain mode only: image format (default "jpeg")'),
      quality: z.coerce.number().optional().default(70).describe('Plain mode only: JPEG quality 1-100 (default 70)'),
    },
    endpoint: '/screenshot',
    endpoints: ['/screenshot', '/marks/screenshot'],
    method: 'GET',
    endpointFor: (args) => (args?.marks === true ? '/marks/screenshot' : '/screenshot'),
    payload: (args) => {
      if (args?.marks === true) {
        const detail = args?.detail || 'full';
        return {
          queryParams: {
            ...(detail === 'economy' ? { economy: '1' } : {}),
            ...(detail === 'markdown' ? { text_only: '1' } : {}),
            include_offscreen: String(args?.include_offscreen === true),
          },
        };
      }
      const maxWidth = args?.max_width !== undefined ? Number(args.max_width) : 768;
      const format = args?.format || 'jpeg';
      const quality = args?.quality !== undefined ? Number(args.quality) : 70;
      return { queryParams: { max_width: String(maxWidth), format, quality: String(quality) } };
    },
    format: (data) => data.screenshot?.filePath ? `Screenshot saved to ${data.screenshot.filePath} (${data.screenshot.width || ''}x${data.screenshot.height || ''}px, ${data.screenshot.mimeType || 'image/jpeg'})` : 'Screenshot captured',
  },
  {
    name: 'get_page_markdown',
    hidden: true,
    deprecatedInFavorOf: 'observe',
    description: 'Deprecated alias for observe(as:"markdown"). Extracts the active page DOM converted to token-efficient Markdown with YAML frontmatter envelope (title, URL, timestamps). By default includes Set-of-Marks badges ([#1], [#2]...) directly on interactive elements (links, buttons, inputs) so you can call act(id) or act(id, action:"type", text) directly from the text without taking screenshots!',
    parameters: {
      include_marks: z.coerce.boolean().optional().default(true).describe('Whether to annotate interactive elements with [#ID] Set-of-Marks badges (default: true)'),
      include_offscreen: z.coerce.boolean().optional().default(false).describe('Also annotate interactive elements outside the current viewport so their [#ID] badges appear in the markdown (use for long/virtualized result lists; default: false)'),
    },
    endpoint: '/markdown',
    method: 'GET',
    payload: (args) => {
      const includeMarks = args?.include_marks !== false && args?.marks !== false;
      const includeOffscreen = args?.include_offscreen === true;
      return { queryParams: { include_marks: String(includeMarks), include_offscreen: String(includeOffscreen) } };
    },
    format: (data) => { const md = data.construct?.content || data.construct?.markdown || JSON.stringify(data, null, 2); return md.length > 25000 ? md.slice(0, 25000) + "\n\n... [Output truncated to 25000 chars]" : md; },
  },
  {
    name: 'harvest_markdown',
    hidden: true,
    deprecatedInFavorOf: 'observe',
    description: 'Deprecated alias for get_page_markdown. Extracts clean markdown with inline [#ID] marks from the active tab.',
    parameters: {
      include_marks: z.coerce.boolean().optional().default(true).describe('Whether to annotate interactive elements with [#ID] Set-of-Marks badges (default: true)'),
      include_offscreen: z.coerce.boolean().optional().default(false).describe('Also annotate interactive elements outside the current viewport (use for long/virtualized result lists; default: false)'),
    },
    endpoint: '/markdown',
    method: 'GET',
    payload: (args) => {
      const includeMarks = args?.include_marks !== false && args?.marks !== false;
      const includeOffscreen = args?.include_offscreen === true;
      return { queryParams: { include_marks: String(includeMarks), include_offscreen: String(includeOffscreen) } };
    },
    format: (data) => { const md = data.construct?.content || data.construct?.markdown || JSON.stringify(data, null, 2); return md.length > 25000 ? md.slice(0, 25000) + "\n\n... [Output truncated to 25000 chars]" : md; },
  },
  {
    name: 'evaluate_javascript',
    description: 'Executes a JavaScript expression or script in the active page context and returns the serialized result. A powerful tool that can read AND mutate the page — reach for it deliberately: observe/extract cover most reads and act covers clicks and typing, and heavy injected JS is a bot-detection signal.',
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
    hidden: true,
    deprecatedInFavorOf: 'bridge_health',
    description: 'Deprecated alias for bridge_health() + page_state(). Returns the current URL, page title, navigation status, tab count, and active tab ID of the browser window.',
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
    endpoint: '/history',
    payload: (args) => ({ action: args.direction }),
    format: (data, args) => data.result || `Navigated ${args.direction}`,
  },
  {
    name: 'get_console_logs',
    description: 'Returns the recent console logs (log, warn, error, info) emitted by the active web page.',
    parameters: {
      limit: z.number().optional().default(50).describe('Max entries to return (default: 50)'),
    },
    endpoint: '/console/logs',
    method: 'GET',
    payload: (args) => ({ queryParams: { limit: String(args?.limit ?? 50) } }),
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
    endpoint: '/cortex/recall',
    payload: (args) => ({ query: args.query, limit: args.limit, domain: args.domain }),
    format: (data) => JSON.stringify(data.results, null, 2),
  },
  {
    name: 'browsing_history',
    description: 'Retrieves chronological browsing history from the Cortex store.',
    parameters: {
      limit: z.number().optional().default(20).describe('Max history entries (default: 20)'),
      domain: z.string().optional().describe('Filter by domain'),
    },
    endpoint: '/cortex/history',
    method: 'GET',
    payload: (args) => ({
      queryParams: {
        limit: String(args?.limit ?? 20),
        ...(args?.domain ? { domain: args.domain } : {}),
      },
    }),
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
    name: 'browsing_history_clear',
    description: 'Clears the chronological browsing history table in the Cortex database.',
    parameters: {},
    endpoint: '/cortex/history/clear',
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
    description: 'Retrieves saved bookmarks. Pass query to filter by terms found in the title, notes, URL, or tags (matches are ranked by relevance); pass tag for an exact tag match.',
    parameters: {
      query: z.string().optional().describe('Filter terms matched against bookmark title, notes, URL, and tags (every term must appear)'),
      tag: z.string().optional().describe('Filter by exact tag'),
      limit: z.number().optional().default(20).describe('Max bookmarks to return'),
    },
    endpoint: '/bookmarks',
    method: 'GET',
    payload: (args) => ({
      queryParams: {
        ...(args?.query ? { q: args.query } : {}),
        ...(args?.tag ? { tag: args.tag } : {}),
        limit: String(args?.limit ?? 20),
      },
    }),
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
    description: 'Answer a cookie/GDPR consent wall by choosing the least invasive real control (reject/only-necessary before accept, per KUANG_CONSENT_POLICY=essential|accept|reject). Set force_remove=true only as a last resort when no control exists — that hides the overlay without answering it.',
    parameters: {
      policy: z.enum(['essential', 'accept', 'reject']).optional().describe('How to answer the wall: essential/reject prefer the least-invasive control, accept prefers "Accept all" (default: KUANG_CONSENT_POLICY or essential)'),
      force_remove: z.coerce.boolean().optional().describe('Last resort only: hide the overlay without answering it (no control matched)'),
    },
    endpoint: '/shield/dismiss',
    payload: (args) => ({ policy: args?.policy, force_remove: args?.force_remove === true }),
    format: (data) => {
      const r = data?.result ?? data ?? {};
      const head = r.dismissed
        ? `consent answered (${r.intent || 'accept'} via ${r.framework || 'generic'})`
        : r.blocked
          ? 'consent wall detected, no usable control — left for a human'
          : 'no consent wall detected';
      const bits = [head];
      if (r.targetText) bits.push(`control: "${r.targetText}"`);
      if (r.coordinates) bits.push(`at (${r.coordinates.x}, ${r.coordinates.y})`);
      if (r.message) bits.push(r.message);
      return bits.join(' · ');
    },
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

  // 7b. Timelapse recording
  {
    name: 'record_start',
    description:
      'Starts a timelapse recording of the Cyberdeck window itself and returns once the capture stream is live. Frames are captured every few hundred milliseconds and played back faster than real time, so a long browsing/scrolling session becomes a short video. Stop with record_stop, which returns the absolute file path — ready to type into a file-upload field. Use list_recordings to find previous files.',
    parameters: {
      name: z.string().optional().describe('Optional label appended to the filename (e.g. "listing-upload")'),
    },
    endpoint: '/recording/start',
    payload: (args) => ({ name: args?.name }),
    format: (data) =>
      `Recording started: ${data.filename}\nOutput directory: ${data.config?.outputDir}\nCapture every ${data.config?.intervalMs}ms, playback at ${data.config?.fps}fps. Call record_stop to save it.`,
  },
  {
    name: 'record_stop',
    description:
      'Stops the timelapse and saves it as a .webm file. Returns the absolute path, byte size, frames captured and playback speed-up. The path can be typed directly into a file-upload field (or use list_recordings).',
    parameters: {},
    endpoint: '/recording/stop',
    format: (data) => {
      const rec = data.recording || data;
      if (!rec?.path) return JSON.stringify(data, null, 2);
      const mb = (rec.bytes / 1024 / 1024).toFixed(1);
      return `Saved ${rec.path}\n${mb} MB · ${rec.frames} frames · ${rec.videoSeconds}s of video · ${rec.speedup}× speed-up`;
    },
  },
  {
    name: 'list_recordings',
    description:
      'Lists finished timelapse recordings as absolute file paths, newest first. Use the path with a file-upload field (set the file input through the page, or hand it to a human if the field cannot be set programmatically).',
    parameters: {
      limit: z.coerce.number().optional().default(20).describe('Maximum recordings to return'),
    },
    endpoint: '/recording/list',
    method: 'GET',
    endpointFor: (args) => `/recording/list?limit=${Math.max(1, Number(args?.limit) || 20)}`,
    format: (data) => {
      const items = Array.isArray(data.recordings) ? data.recordings : [];
      if (!data.enabled) return 'Recording is disabled — enable it in Settings → Recording.';
      if (items.length === 0) return `No timelapses yet. They are written to ${data.outputDir}.`;
      const lines = items.map((item: any) => `- ${item.filename} (${(item.bytes / 1024 / 1024).toFixed(1)} MB) — ${item.path}`);
      return `### Timelapses (${items.length})\n${lines.join('\n')}`;
    },
  },

  // 8. Sessions & Cookies
  {
    name: 'save_session',
    hidden: true,
    deprecatedInFavorOf: 'context_save',
    description: 'Deprecated alias for context_save. Snapshots the current active browser session (cookies, localStorage, sessionStorage) into the persistent vault.',
    parameters: {
      name: z.string().describe('Unique name for the session snapshot (e.g. "github-auth")'),
    },
    endpoint: '/session/save',
    payload: (args) => ({ name: args.name }),
    format: (data, args) => `Session "${args.name}" saved successfully`,
  },
  {
    name: 'restore_session',
    hidden: true,
    deprecatedInFavorOf: 'context_open',
    description: 'Deprecated alias for context_open. Restores a previously saved session snapshot into the active browser partition.',
    parameters: {
      name: z.string().describe('Name of the session snapshot to restore'),
    },
    endpoint: '/session/restore',
    payload: (args) => ({ name: args.name }),
    format: (data, args) => `Session "${args.name}" restored successfully`,
  },
  {
    name: 'list_sessions',
    hidden: true,
    deprecatedInFavorOf: 'context_list',
    description: 'Deprecated alias for context_list. Returns all saved session profiles in the vault.',
    parameters: {},
    endpoint: '/session/list',
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
      since: z.union([z.literal('last_action'), z.coerce.number()]).optional().describe('Only requests at/after this epoch-ms timestamp, or the literal "last_action" to correlate XHRs with the most recent action (click/type/navigate/act).'),
    },
    endpoint: '/network/traffic',
    payload: (args) => ({
      urlPattern: args.url_pattern,
      method: args.method,
      resourceType: args.resource_type,
      limit: args.limit,
      since: args.since,
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
    hidden: true,
    deprecatedInFavorOf: 'query_json_data',
    description: 'Deprecated alias for query_json_data({ source: "network_payload", source_id }). Retrieves the complete JSON body of a specific API response captured during network interception.',
    parameters: {
      request_id: z.string().describe('ID of captured request'),
    },
    endpoint: '/network/payload',
    payload: (args) => ({ requestId: args.request_id }),
    format: (data) => JSON.stringify(data.payload, null, 2),
  },
  {
    name: 'clear_network_traffic',
    hidden: true,
    deprecatedInFavorOf: 'clear_capture',
    description: 'Deprecated alias for clear_capture({ scope: "network" }). Clears the in-memory network traffic ring buffer.',
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
    hidden: true,
    deprecatedInFavorOf: 'take_screenshot',
    description: 'Deprecated alias for take_screenshot(marks:true, detail:"full"). Visual Grounding with Set-of-Marks. Renders high-contrast numbered badges over interactable elements, takes a screenshot, saves to data/screenshots/, and returns both native image and mark mapping. Set include_offscreen=true to also badge elements below/above the fold (long result lists).',
    parameters: {
      include_offscreen: z.coerce.boolean().optional().default(false).describe('Also badge interactive elements outside the current viewport (default: false)'),
    },
    endpoint: '/marks/screenshot',
    method: 'GET',
    payload: (args) => ({ queryParams: { include_offscreen: String(args?.include_offscreen === true) } }),
    format: (data) => (Array.isArray(data.marks) ? data.marks.map((m: any) => formatMark(m)).join('\n') : JSON.stringify(data)),
  },
  {
    name: 'take_economy_screenshot',
    hidden: true,
    deprecatedInFavorOf: 'take_screenshot',
    description: 'Deprecated alias for take_screenshot(marks:true, detail:"economy"). Lightweight Set-of-Marks screenshot: downscaled to 640px wide JPEG (~10-20x smaller than take_annotated_screenshot) plus the same mark mapping. Use for vision models when token/bandwidth cost matters. Set include_offscreen=true to also badge elements below/above the fold.',
    parameters: {
      include_offscreen: z.coerce.boolean().optional().default(false).describe('Also badge interactive elements outside the current viewport (default: false)'),
    },
    endpoint: '/marks/screenshot',
    method: 'GET',
    payload: (args) => ({ queryParams: { economy: '1', include_offscreen: String(args?.include_offscreen === true) } }),
    format: (data) => (Array.isArray(data.marks) ? data.marks.map((m: any) => formatMark(m)).join('\n') : JSON.stringify(data)),
  },
  {
    name: 'list_marks',
    hidden: true,
    deprecatedInFavorOf: 'observe',
    description: 'Deprecated alias for observe(as:"som"). Text-only Set-of-Marks: returns the numbered interactive element table with NO image. Use for text-only models or the cheapest possible page scan; act(mark_id, action) works afterwards. On long/virtualized result lists set include_offscreen=true so below-the-fold items are numbered too (act scrolls them into view).',
    parameters: {
      include_offscreen: z.coerce.boolean().optional().default(false).describe('Also number interactive elements outside the current viewport so long result lists are fully listed (default: false)'),
    },
    endpoint: '/marks/screenshot',
    method: 'GET',
    payload: (args) => ({ queryParams: { text_only: '1', include_offscreen: String(args?.include_offscreen === true) } }),
    format: (data) => (Array.isArray(data.marks) ? data.marks.map((m: any) => formatMark(m)).join('\n') : JSON.stringify(data)),
  },
  {
    name: 'click_mark',
    hidden: true,
    deprecatedInFavorOf: 'act',
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
    hidden: true,
    deprecatedInFavorOf: 'act',
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
    description: 'Lists or searches saved automation scripts in the Script Vault. Pass query to search by natural-language relevance (ranked); omit it to list everything. Pass tag for an exact tag match.',
    parameters: {
      query: z.string().optional().describe('Natural-language search across script name, description, code, and tags (ranked by relevance)'),
      tag: z.string().optional().describe('Filter by exact tag'),
      limit: z.number().optional().default(100).describe('Max scripts to return'),
    },
    endpoint: '/scripts/list',
    method: 'GET',
    payload: (args) => ({
      queryParams: {
        ...(args?.query ? { q: args.query } : {}),
        ...(args?.tag ? { tag: args.tag } : {}),
        limit: String(args?.limit ?? 100),
      },
    }),
    format: (data) => {
      const scripts = Array.isArray(data.scripts) ? data.scripts : [];
      if (scripts.length === 0) return 'No matching scripts in vault.';
      const lines = scripts.map((s: any) => {
        const score = typeof s.score === 'number' ? ` (score: ${s.score.toFixed(2)})` : '';
        return `- "${s.name}"${score}: ${s.description || 'No description'}`;
      });
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
    hidden: true,
    deprecatedInFavorOf: 'query_json_data',
    description: 'Deprecated alias for query_json_data({ source: "stream_messages" }). Inspects captured incoming and outgoing real-time messages / frames from WebSockets or SSE.',
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
    hidden: true,
    deprecatedInFavorOf: 'clear_capture',
    description: 'Deprecated alias for clear_capture({ scope: "streams" }). Clears the in-memory WebSocket and SSE message frame buffer.',
    parameters: {
      stream_id: z.string().optional().describe('Optional specific streamId to clear'),
    },
    endpoint: '/streams/clear',
    payload: (args) => ({ streamId: args.stream_id }),
    format: (data) => data.message || 'Stream messages cleared',
  },
  {
    name: 'clear_capture',
    description: 'Clears the in-memory capture ring buffers. scope="network" clears captured HTTP traffic (see get_network_traffic), scope="streams" clears WebSocket/SSE message frames (see list_realtime_streams), scope="all" (default) clears both.',
    parameters: {
      scope: z.enum(['network', 'streams', 'all']).optional().default('all').describe('Which capture buffer to clear: "network" (HTTP traffic), "streams" (WebSocket/SSE frames), or "all" (default)'),
    },
    endpoint: '/capture/clear',
    payload: (args) => ({ scope: args?.scope || 'all' }),
    format: (data) => data.message || 'Capture buffers cleared',
  },

  // 13. System Tray & Window Visibility
  {
    name: 'set_window_visibility',
    description: 'Shows/restores or hides the Cyberdeck desktop window. Showing (the default) also brings the window to the foreground and focuses it — use this to make the window visible to a human (HIL); pass focus=false to show without stealing focus. Synthetic agent input is focus-independent, so this is not needed for normal driving.',
    parameters: {
      visible: z.coerce.boolean().optional().describe('true to restore and show the window (default); false to minimize/hide to the system tray'),
      focus: z.coerce.boolean().optional().describe('When showing, whether to bring the window to the foreground and focus it (default: true)'),
    },
    endpoint: '/window/visibility',
    payload: (args) => ({
      visible: args?.visible !== undefined ? Boolean(args.visible) : true,
      ...(args?.focus !== undefined ? { focus: Boolean(args.focus) } : {}),
    }),
    format: (data, args) => JSON.stringify({ success: true, visible: data.visible, focused: data.focused, state: (args?.visible ?? true) ? 'WINDOW_RESTORED' : 'MINIMIZED_TO_TRAY' }),
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
    description: 'PROACTIVELY call this whenever encountering CAPTCHAs, Cloudflare Turnstile, login/2FA prompts, payment checkouts, or unexpected roadblocks. Halts agent execution, triggers audible desktop alerts, unhides and brings window to front, flashes taskbar, and presents an interactive HUD banner for human assistance.',
    parameters: {
      reason: z.string().describe('Clear explanation of what human action is needed (e.g. "Please solve the Cloudflare Turnstile challenge" or "Please enter 2FA code")'),
      timeout_seconds: z.number().optional().describe('Max seconds to wait for human action (default: 180)'),
      bring_to_front: z.boolean().optional().default(true).describe('Whether to unhide/restore window from tray and bring to front (default: true)'),
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
  {
    name: 'send_desktop_notification',
    hidden: true,
    deprecatedInFavorOf: 'send_notification',
    description: 'Deprecated alias for send_notification (same /notify endpoint; defaults urgency=critical). Triggers a native desktop notification to summon the human operator for Human-in-the-Loop (HIL) assistance (e.g. 2FA code, SMS prompt, CAPTCHA override, or manual login).',
    parameters: {
      message: z.string().describe('Specific reason why the user is needed and instructions for what to do in the browser.'),
      title: z.string().optional().default('Kuang Browser: Human Intervention Required').describe('Notification title'),
      urgency: z.enum(['low', 'normal', 'critical']).optional().default('critical').describe('Urgency level of the notification.'),
      sound: z.boolean().optional().default(true).describe('Whether to play notification alert sound (default: true)'),
    },
    endpoint: '/notify',
    payload: (args) => {
      const title = args?.title || 'Kuang Browser: Human Intervention Required';
      const message = args?.message || args?.text || args?.body || 'Human intervention required in Kuang browser';
      return { title, message, urgency: args?.urgency || 'critical', sound: args?.sound ?? true };
    },
    format: (data, args) => JSON.stringify({ success: data.sent, title: args?.title || 'Kuang Browser: Human Intervention Required', message: args?.message || 'Notification sent' }),
  },

  // ---------------------------------------------------------------------------
  // 14. Primitives Layer — one observe / act / wait / extract model.
  // These complement the procedural verbs above; nothing is replaced.
  // ---------------------------------------------------------------------------
  {
    name: 'drive',
    description:
      'OPTIONAL goal-driven UI loop (absent unless a decision model is configured). Repeats observe(as:"components") → decide → act until the goal is reached or a stop condition fires, with one decision call per step instead of an agent turn per step. ' +
      'Text is never generated: pass `values` keyed by field name (or component id); if the next step needs a value you have not supplied, it stops with status "needs_input", names the field, and you call again with the value. ' +
      'Stops on: done · blocked (no deterministic gate matched, so YOU decide) · human_required (age/CAPTCHA; the hand-off is raised) · needs_agent (no acceptable action, or a contradiction the guard rejected) · failed · max_steps. ' +
      'Every step is in `steps` (operation, target, chars typed, warning). Use dry_run to see the first planned step without acting. Prefer this over hand-scripting long forms; use `decide` directly when you want to choose each step yourself.',
    parameters: {
      goal: z.string().describe('What to accomplish, in one sentence (e.g. "search London → Maldives, 1–7 Nov, cheapest")'),
      values: z.record(z.string(), z.string()).optional().describe('Text to type, keyed by field name or component id (case-insensitive, contains-matching)'),
      max_steps: z.coerce.number().min(1).max(25).optional().default(10).describe('Stop after this many actions (default 10)'),
      threshold: z.coerce.number().min(0).max(1).optional().describe('Minimum confidence to accept a decision (default 0.45)'),
      dry_run: z.coerce.boolean().optional().default(false).describe('Plan the first step and return without acting'),
      save_recipe: z.coerce.boolean().optional().default(false).describe('On a successful run, compile the verified steps into a replayable recipe (see the `recipe` tool)'),
      recipe_name: z.string().optional().describe('Name for the saved recipe (defaults to the goal)'),
    },
    endpoint: '/drive',
    payload: (args) => ({
      goal: args?.goal,
      values: args?.values,
      max_steps: args?.max_steps,
      threshold: args?.threshold,
      dry_run: args?.dry_run,
      save_recipe: args?.save_recipe === true,
      recipe_name: args?.recipe_name,
    }),
    format: (data) => {
      if (data.error) return `drive failed: ${data.error}`;
      const lines = (data.steps || []).map((s: any) =>
        `${s.step}. ${s.operation} #${s.target} "${(s.targetName || '').slice(0, 40)}"${s.typedChars ? ` (${s.typedChars} chars)` : ''} ${s.ok ? '✓' : '✗'}${s.urlChanged ? ' → navigated' : ''}${s.warning ? ` ⚠ ${s.warning.slice(0, 80)}` : ''}`
      );
      const head = `drive · ${data.status} · ${(data.steps || []).length} step(s) · ${data.durationMs ?? '?'}ms`;
      const tail = data.field ? `\nNeeds value for: #${data.field.id} "${data.field.name}"` : '';
      return `${head}\n${lines.join('\n')}${lines.length ? '\n' : ''}${data.message || ''}${tail}`;
    },
  },
  {
    name: 'recipe',
    description:
      'Navigation recipes: a page path compiled into descriptor steps and replayed with ZERO model calls. ' +
      'action="save" stores steps that address controls by visible text (works for semantics-free React cards and form fields) with optional expect conditions; action="replay" walks them by id, or by the best match for a url; action="list"; action="delete". ' +
      'Recipes are local (data/recipes.json), scoped to origin + path (a trailing * makes the path a prefix), and are retired after 3 consecutive failed replays — a stale path stops being retried instead of failing forever. ' +
      'A replay stops at the first step whose control cannot be resolved or whose expectation does not hold, and reports the index. Prefer this for repeat visits once a path is known; use drive/decide while it is still being discovered.',
    parameters: {
      action: z.enum(['list', 'save', 'replay', 'delete']).default('list').describe('What to do'),
      id: z.string().optional().describe('Recipe id (replay/delete)'),
      url: z.string().optional().describe('Page URL the recipe belongs to (save), or the page to match (replay/list)'),
      name: z.string().optional().describe('Human name for the recipe'),
      path: z.string().optional().describe('Path pattern instead of the URL pathname (a trailing * matches a prefix)'),
      steps: z.array(z.object({
        action: z.enum(['click', 'type']),
        target: z.string().describe('Visible text, or a form field label / placeholder / name'),
        value: z.string().optional().describe('Value for action="type"'),
        expect: z.array(z.record(z.string(), z.any())).optional().describe('wait_for conditions asserted after the step'),
      })).optional().describe('Steps to store (save)'),
      expect_timeout_ms: z.coerce.number().optional().describe('Per-step expectation timeout during replay (default 8000)'),
    },
    endpoint: '/recipes',
    payload: (args) => ({
      action: args?.action || 'list',
      id: args?.id,
      url: args?.url,
      name: args?.name,
      path: args?.path,
      steps: args?.steps,
      expect_timeout_ms: args?.expect_timeout_ms,
    }),
    format: (data) => {
      if (data.success === false) return `recipe failed: ${data.error || (data.errors || []).join('; ')}`;
      if (data.recipes) {
        if (!data.recipes.length) return 'No recipes saved.';
        return data.recipes
          .map((r: any) => `${r.id} · ${r.name} · ${r.origin}${r.path} · ${r.steps.length} step(s) · ${r.successes}/${r.attempts} ok${r.consecutiveFailures ? ` · ${r.consecutiveFailures} miss` : ''}`)
          .join('\n');
      }
      if (data.result) {
        const lines = (data.result.steps || []).map((s: any) => `${s.index + 1}. ${s.step.action} "${s.step.target}" ${s.ok ? '✓' : '✗'} ${s.ms}ms${s.error ? ` — ${s.error}` : ''}`);
        return `replay · ${data.result.status} · ${data.result.steps.length} step(s) · ${data.result.ms}ms\n${lines.join('\n')}\n${data.result.message}`;
      }
      if (data.recipe) return `saved ${data.recipe.id} · ${data.recipe.name} · ${data.recipe.steps.length} step(s)`;
      return JSON.stringify(data).slice(0, 400);
    },
  },
  {
    name: 'decide',
    description:
      'OPTIONAL decision model (absent unless configured — see docs/DECISION_MODELS.md). Send a state plus typed questions; get typed answers back: choices with probabilities, scores, yes/no — never prose. ' +
      'This is not an LLM: every answer is one of the options you supplied, so it cannot invent a target. Kuang forwards your questions verbatim and returns the answers untouched, and never calls a decision model on its own. ' +
      'Typical loop: observe(as:"components") for the component table (role/name/value/region/actions, ids are mark ids) → decide over it (e.g. one `choice` for the operation, one `choice` per operation over only the components whose actions include it, all in ONE call) → act(mark_id) → check the returned delta/typing verdict. ' +
      'FAN OUT THE HEADS: ask operation + every plausible target head (click_target, type_text_target, select_target) + done in the same call, then execute only the head matching the chosen operation — one round trip per step instead of operation-then-target. Ask only for heads the page offers. ' +
      'Backends: hosted Jev (typesafe protocol, e.g. jev-1.13) or a local ONNX model via open-jev (local-onnx: kev-0.6b by default — experimental, see docs/DECISION_MODELS.md for measured accuracy). Returns NOT_CONFIGURED when no backend is set.',
    parameters: {
      state: z.any().describe('What the model reasons over: a string, JSON (e.g. the components array), or an array of values'),
      questions: z.record(z.string(), z.any()).describe('Typed questions keyed by name. For TypeSafe: {"operation":{"type":"choice","instructions":"…","criteria":{"click":"Click a control","done":"The goal is met"}},"done":{"type":"noul","instructions":"…"}} — choice takes criteria (option→description), NOT options. Local open-jev takes options instead.'),
      model: z.string().optional().describe('Override the configured model for this call (e.g. "jev-1.13", "d1-3b")'),
      guard: z.object({
        threshold: z.coerce.number().min(0).max(1).optional().describe('Reject choices below this confidence (0–1)'),
        operations: z.array(z.string()).optional().describe('Operations that may be accepted (default click/type_text/done/blocked)'),
        components: z.array(z.object({ id: z.union([z.string(), z.coerce.number()]), actions: z.array(z.string()).optional(), name: z.string().optional() })).optional().describe('The components you offered (from observe as=components) — a target not in this list, or one that does not accept the operation, is rejected'),
      }).optional().describe('Validate the answer before trusting it: confidence gate, target membership, affordance match, done/operation contradiction'),
      eliminate: z.object({
        max_attempts: z.coerce.number().min(1).max(5).optional().describe('Total model calls including the first (default 3 when eliminate is set)'),
      }).optional().describe('Drop a rejected option and ask again with the rest; when everything is eliminated the result is accepted:false, fallback:"agent"'),
      include_page_text: z.coerce.boolean().optional().describe('Append the live page text to the state before asking (default: on for guarded calls). Needed for sensitive-gate detection, whose copy lives in the page, not the component table'),
      include_screenshot: z.coerce.boolean().optional().describe('Attach a JPEG of the visible viewport to the state. Hosted Jev only, and NOT through the OpenCode gateway (it does not forward the required TypeSafe header) — with opencode.ai the image is skipped and the result says so. Works against api.typesafe.ai.'),
    },
    endpoint: '/decide',
    payload: (args) => ({
      state: args?.state,
      questions: args?.questions || {},
      model: args?.model,
      guard: args?.guard,
      eliminate: args?.eliminate,
      include_page_text: args?.include_page_text,
      include_screenshot: args?.include_screenshot,
    }),
    format: (data) => {
      if (data.error) return `decide failed: ${data.error}`;
      if (data.accepted === false) {
        const reasons = (data.reasons || []).join('\n');
        return `NO DECISION — the agent decides (${data.attempts} attempt${data.attempts === 1 ? '' : 's'})\n${reasons}`;
      }
      const answers = data.answers || {};
      const lines = Object.entries(answers).map(([key, value]) => {
        if (value && typeof value === 'object') {
          const v: any = value;
          const bits = [`${key}: ${v.choice ?? v.score ?? v.noul ?? '?'}`];
          if (value && 'confidence' in v) bits.push(`confidence=${v.confidence}`);
          if (v.probabilities) bits.push(`p=${JSON.stringify(v.probabilities)}`);
          return bits.join(' · ');
        }
        return `${key}: ${value}`;
      });
      const attempts = data.attempts > 1 ? ` · ${data.attempts} attempts` : '';
      const hint = data.hint ? `\n\n${data.hint}` : '';
      return `${data.protocol || 'decision'}(${data.model || '?'}) ${data.latencyMs ?? '?'}ms${attempts}\n${lines.join('\n')}${hint}`;
    },
  },
  {
    name: 'wait_for',
    description:
      'Declarative readiness gate. Polls until every (require="all") or any (require="any", default) condition holds, then returns. This is the primitive that replaces blind sleeps. Condition types: ' +
      '{"type":"selector","selector":"...","visible":true} · {"type":"gone","selector":"..."} · {"type":"text","text":"..."} (or {"regex":"..."}) · {"type":"url","pattern":"..."} · ' +
      '{"type":"role_name","role":"button","name":"Search"} · {"type":"count","selector":".card","min":5} · {"type":"network_idle","quietMs":800} · ' +
      '{"type":"stable","target":"marks|height|text|nodes","holdMs":400} (waits for lazily-rendered lists to stop growing) · {"type":"revision","version":N}.',
    parameters: {
      conditions: z.array(z.record(z.string(), z.any())).describe('Array of condition objects, e.g. [{"type":"selector","selector":".result"}]'),
      require: z.enum(['any', 'all']).optional().default('any').describe('"all" = every condition must hold; "any" = first one (default)'),
      timeout_ms: z.coerce.number().optional().default(15000).describe('Give up after this many ms (default: 15000)'),
      poll_ms: z.coerce.number().optional().default(120).describe('Poll interval in ms (default: 120 � sites settle in tens of ms, so 250 wastes a quarter second per wait)'),
    },
    endpoint: '/wait-for',
    payload: (args) => ({
      conditions: args?.conditions || (args?.condition ? [args.condition] : []),
      require: args?.require || 'any',
      timeout_ms: args?.timeout_ms,
      poll_ms: args?.poll_ms,
    }),
    format: (data) => {
      const lines = (data.results || []).map((r: any) => `${r.ok ? '✓' : '✗'} ${r.type}${r.evidence ? ` — ${r.evidence}` : ''}`);
      return `${data.ok ? 'READY' : 'TIMED OUT'} after ${data.waitedMs}ms (${data.attempts} polls, require=${data.require})\n${lines.join('\n')}`;
    },
  },
  {
    name: 'observe',
    description:
      'One budgeted observation model with projections. as="markdown" (TIER 1 readable construct with inline [#id] marks) · as="text" (innerText, region-scoped) · as="ax" (accessibility tree) · as="som" (numbered marks table) · as="components" (decision-ready table: role, name, value, state, affordances and region per component). ' +
      'Markdown returns a 25,000-char default view - page it with budget + next_cursor, or pass budget=0 for the whole construct. The front-matter reports reader, extracted_chars and page_chars (how much of the page text the readable region covers) plus shadow_roots, so a genuinely short page can be told apart from a partly-visible one. region accepts a mark id (number) or CSS selector. For structured list/table/app-data extraction use `extract`. ' +
      'When a decision model is configured, as="components" is the intended input to `decide`: observe -> decide -> act(mark_id), instead of hand-scanning the mark list on a busy page.',
    parameters: {
      as: z.enum(['markdown', 'text', 'ax', 'som', 'components']).optional().default('markdown').describe('Projection to return (default: markdown)'),
      region: z.union([z.coerce.number(), z.string()]).optional().describe('Scope to a mark id (number) or CSS selector (string)'),
      budget: z.coerce.number().optional().describe('Max characters to return; page with next_cursor. Omitted = the projection default (markdown 25,000, text/ax everything); 0 = everything'),
      cursor: z.union([z.string(), z.coerce.number()]).optional().describe('next_cursor from a previous observe call'),
      include_offscreen: z.coerce.boolean().optional().default(false).describe('Include below/above-the-fold elements (markdown marks, som, list)'),
      include_frames: z.coerce.boolean().optional().default(false).describe('Merge child-frame controls into som/components (100+ mark ids)'),
      limit: z.coerce.number().optional().describe('Max rows for list/table projections'),
    },
    endpoint: '/observe',
    payload: (args) => ({
      as: args?.as || 'markdown',
      region: args?.region,
      budget: args?.budget,
      cursor: args?.cursor,
      include_offscreen: args?.include_offscreen === true,
      include_frames: args?.include_frames === true,
      limit: args?.limit,
    }),
    format: (data) => {
      const chars = data.text ? data.text.length : 0;
      const facts = [data.truncated ? `chars=${chars} of ${data.total ?? 0}` : `chars=${chars}`];
      if (data.tokens) facts.push(`~${data.tokens} tokens`);
      if (data.shadowRoots) facts.push(`${data.shadowRoots} shadow root${data.shadowRoots === 1 ? '' : 's'}`);
      if (data.truncated) facts.push(`next_cursor=${data.next_cursor}`);
      const head = `observe(as=${data.as})${data.url ? ` · ${data.url}` : ''}`;
      return `${head}\n${facts.join(' · ')}\n\n${data.text || '(no content)'}`;
    },
  },
  {
    name: 'extract',
    description:
      'Structured, read-only extraction (no page JS injection). kind="list" finds the repeating item container and returns deduped rows {text, href, aria, mark}. ' +
      'kind="table" returns {headers, rows, records} from one <table> or ARIA grid; kind="tables" returns EVERY table on the page. ' +
      'kind="schema_org" parses <script type="application/ld+json"> into typed items (flattens @graph; pass `type` to keep just e.g. "Recipe"/"Product"/"FAQPage"/"HowTo"). ' +
      'kind="app_data" returns embedded JSON from __NEXT_DATA__ / JSON-LD / inline state blobs.',
    parameters: {
      kind: z.enum(['list', 'table', 'tables', 'app_data', 'schema_org']).default('list').describe('Extraction kind'),
      ref: z.coerce.number().optional().describe('Scope to a mark id (from list_marks/find)'),
      selector: z.string().optional().describe('Scope to a CSS selector (default: whole page)'),
      type: z.string().optional().describe('schema_org only: filter to one schema.org @type (e.g. "Recipe")'),
      limit: z.coerce.number().optional().default(200).describe('Max rows/sources/items'),
    },
    endpoint: '/extract',
    payload: (args) => ({ kind: args?.kind || 'list', ref: args?.ref, selector: args?.selector, type: args?.type, limit: args?.limit }),
    format: (data) => {
      if (data.error) return `extract failed: ${data.error}`;
      if (data.kind === 'table') {
        const head = (data.headers || []).join(' | ');
        const rows = (data.rows || []).map((r: any[]) => r.join(' | ')).join('\n');
        return `# table (${data.count} rows)\n${head}\n${rows}`;
      }
      if (data.kind === 'tables') {
        const tables = data.tables || [];
        if (!tables.length) return 'No <table>/ARIA grid found on the page.';
        return tables
          .map((t: any) => `# table ${t.index} (${t.count} rows)\n${(t.headers || []).join(' | ')}\n${(t.records || []).map((r: any) => Object.values(r).join(' | ')).join('\n')}`)
          .join('\n\n');
      }
      if (data.kind === 'schema_org') {
        const items = data.items || [];
        const types = (data.types || []).join(', ') || 'n/a';
        if (!items.length) return `No JSON-LD (schema.org) items matched (types present: ${types}).`;
        const lines = items.map((it: any, i: number) => `${i + 1}. **${it.type}**${it.types?.length > 1 ? ` (${it.types.join('+')})` : ''}: ${JSON.stringify(it.data).slice(0, 600)}`);
        return `# schema_org (${data.count}/${data.total} items; types: ${types})\n${lines.join('\n')}`;
      }
      if (data.kind === 'app_data') {
        return `# app_data (${data.count} sources)\n` + (data.sources || []).map((s: any) => `${s.source} (${s.bytes}B, parsed=${s.parsed})`).join('\n');
      }
      const rows = (data.rows || []).map((r: any, i: number) => `${i + 1}. ${r.text}${r.href ? ` -> ${r.href}` : ''}${r.mark ? ` [#${r.mark}]` : ''}`);
      return `# list (${data.count} items${data.container?.sig ? `, container="${data.container.sig}"` : ''})\n${rows.join('\n')}`;
    },
  },
  {
    name: 'llm_surface',
    description:
      'Checks whether a site publishes an LLM-friendly representation — a `/llms.txt` / `/llms-full.txt` index, a `/sitemap.xml`, a page-level Markdown/Text alternate (a declared `<link rel="alternate">`, or a real `<a href="….md">` link on the page), or Markdown content negotiation — so you can read it as text instead of rendering. ' +
      'Returns `recommended`: "llms_txt" | "llms_full" | "markdown" | "text", or **null** when the site advertises none (never "rendered"). Also returns `scope` ("origin" for a site-wide index, "page" for this page) and `next` — the unambiguous next step: `{tool:"llm_fetch", as}` when something is fetchable, else `{tool:"observe", as:"markdown"}`. A null `recommended` is NOT a fetch target: follow `next`, or just call `read_url`. Only well-known paths are probed and results are cached per origin; url defaults to the active tab.',
    parameters: {
      url: z.string().optional().describe('Site or page URL to inspect (default: the active tab)'),
    },
    endpoint: '/llm/surface',
    payload: (args) => ({ url: args?.url }),
    format: (data) => {
      const rec = data.recommended
        ? `**${data.recommended}**${data.scope ? ` (${data.scope} scope)` : ''}`
        : '**none** — render the page';
      const next =
        data.next?.tool === 'llm_fetch' ? `llm_fetch({ as: "${data.next.as}" })` : 'observe({ as: "markdown" })';
      const lines = [
        `### LLM surface — ${data.origin || data.url}`,
        `- recommended: ${rec}`,
        `- next: ${next}`,
        `- llms.txt: ${data.llms_txt?.found ? `${data.llms_txt.url} (${data.llms_txt.bytes}B)` : '—'}`,
        `- llms-full.txt: ${data.llms_full?.found ? `${data.llms_full.url} (${data.llms_full.bytes}B)` : '—'}`,
        `- sitemap.xml: ${data.sitemap?.found ? `${data.sitemap.url} (${data.sitemap.entries ?? 0} urls)` : '—'}`,
        `- markdown alternates: ${data.markdown_alternates?.length ? data.markdown_alternates.map((a: any) => `${a.href}${a.source === 'anchor' ? ' (from a page link)' : ''}`).join(', ') : '—'}`,
        `- accepts markdown (negotiation): ${data.content_negotiation?.accepts_markdown ? 'yes' : 'no'}`,
      ];
      if (!data.recommended) {
        lines.push('', 'No fetchable LLM surface — read it with `read_url` (or `observe({ as: "markdown" })`).');
      }
      if (data.notes?.length) lines.push('', ...data.notes.map((n: string) => `> ${n}`));
      return lines.join('\n');
    },
  },
  {
    name: 'llm_fetch',
    description:
      'Fetches a site-provided Markdown/Text representation that `llm_surface` found — an `/llms.txt` index, a page-level Markdown/Text alternate, or a negotiated Markdown body. ' +
      'GATED: it refuses with NO_LLM_SURFACE unless the site actually advertises a surface, and never fetches arbitrary URLs or guesses paths. The result carries `scope` ("origin"|"page") and `scope_mismatch` — true when you asked for a page but only a site-wide index exists. For the rendered page use `observe({ as: "markdown" })`; for one call that always returns text use `read_url`.',
    parameters: {
      url: z.string().optional().describe('Site or page URL (default: the active tab)'),
      as: z.enum(['llms_txt', 'llms_full', 'markdown', 'text']).optional().describe('Which advertised representation to fetch (default: the probe\'s recommended)'),
    },
    endpoint: '/llm/fetch',
    payload: (args) => ({ url: args?.url, as: args?.as }),
    format: (data) => {
      const warn = data.scope_mismatch ? '\n> Scope mismatch: you asked for a page, but this is the site-wide index.' : '';
      return `### llm_fetch ${data.as} · ${data.url} (${data.contentType || 'unknown'}, ${data.bytes} bytes, ${data.scope} scope, via ${data.via})${warn}\n\n${data.content || ''}`;
    },
  },
  {
    name: 'read_url',
    description:
      'Reads a URL as Markdown in ONE call — the composite front door. Reads the site\'s own LLM-friendly representation when one covers the URL you asked for (a page-level Markdown/Text alternate for a page); otherwise it renders the URL in a DETACHED view (your active tab is never hijacked) and distils it to Markdown. ' +
      'Always returns Markdown text, so you never have to branch on `llm_surface.recommended`. A site-wide `/llms.txt` index is never returned in place of a page — the page is rendered instead, and `reason` says why. Reports `via` ("llm_fetch"|"render"), `scope` ("origin"|"page"), `scope_mismatch` and `reason`. PAGED: pass `max_chars` and follow the machine-readable `next_cursor=<offset>` fact when the result is truncated.',
    parameters: {
      url: z.string().optional().describe('URL to read as Markdown (default: the active tab)'),
      max_chars: z.coerce.number().optional().describe('Maximum characters to return per call (default 20000, cap 50000)'),
      cursor: z.union([z.string(), z.number()]).optional().describe('Character offset to continue from (the previous call\'s next_cursor)'),
      as: z.enum(['llms_txt', 'llms_full', 'markdown', 'text']).optional().describe('Force a specific advertised representation instead of the probe\'s recommendation'),
    },
    endpoint: '/read/url',
    payload: (args) => ({ url: args?.url, max_chars: args?.max_chars, cursor: args?.cursor, as: args?.as }),
    format: (data) => {
      const how = data.via === 'llm_fetch' ? `site-provided ${data.as}` : 'rendered';
      const returned = data.content?.length || 0;
      const facts = [
        `chars=${returned} of ${data.total}`,
        `offset=${data.offset}`,
        `scope=${data.scope}`,
        ...(data.scope_mismatch ? ['scope_mismatch=true'] : []),
        ...(data.truncated ? [`next_cursor=${data.next_cursor}`] : []),
      ];
      const head = [`### read_url · ${how} · ${data.url}`, `- ${facts.join(' · ')}`];
      if (data.title) head.push(`- title: ${data.title}`);
      if (data.reason) head.push(`- rendered because: ${data.reason}`);
      if (data.truncated) {
        head.push(`- continue: read_url({ url: "${data.url}", cursor: ${data.next_cursor} })`);
      }
      return `${head.join('\n')}\n\n${data.content || ''}`;
    },
  },
  {
    name: 'search_web',
    description:
      'Runs a web search and returns ranked results {rank, title, url, snippet}. Each engine loads in a detached view (your active tab is NOT disturbed) and the hub falls back across engines when one returns nothing (bot-check/consent wall). ' +
      'engines: google | duckduckgo | bing | brave | startpage | custom (custom needs url_template containing {query}, e.g. a SearXNG instance). Results are plain URLs to feed navigate_to or collect_all.',
    parameters: {
      query: z.string().describe('Search query'),
      engine: z.enum(['google', 'duckduckgo', 'bing', 'brave', 'startpage', 'custom']).optional().describe('Pin a single engine (default: auto chain google → duckduckgo → brave)'),
      engines: z.array(z.string()).optional().describe('Explicit ordered fallback chain (overrides engine)'),
      url_template: z.string().optional().describe('URL template containing {query} for a custom/SearXNG engine'),
      max_results: z.coerce.number().optional().describe('Max results to return (default: Research settings)'),
    },
    endpoint: '/search/web',
    payload: (args) => ({
      query: args?.query,
      engine: args?.engine,
      engines: args?.engines,
      url_template: args?.url_template,
      max_results: args?.max_results,
    }),
    format: (data) => {
      const results = Array.isArray(data.results) ? data.results : [];
      if (results.length === 0) {
        const tried = (data.attempts || [])
          .map((a: any) => `${a.engine}${a.error ? `(${a.error})` : a.blocked ? '(blocked)' : '(0)'}`)
          .join(', ');
        return `### Search "${data.query}" — no results\nTried: ${tried || 'none'}\n${data.notes || ''}`.trim();
      }
      const lines = results.map((r: any) => `${r.rank}. [${r.title}](${r.url})${r.snippet ? `\n   ${r.snippet}` : ''}`);
      return `### Search "${data.query}" — ${results.length} results (${data.engine})\n${lines.join('\n')}`;
    },
  },
  {
    name: 'deep_crawl',
    description:
      'Breadth-first crawl from a seed URL: follows same-origin links up to max_depth / max_pages, distills every page to Markdown, and indexes it into LanceDB Cortex. ' +
      'Each page takes the cheap path first — content-negotiated Markdown/Text when the site advertises it, otherwise a detached render (your active tab is not disturbed). ' +
      'Use match_patterns (glob "…/docs/*" or /regex/) to scope, and same_origin=false to allow cross-site hops. Returns a per-page summary.',
    parameters: {
      url: z.string().describe('Seed URL (http/https)'),
      max_depth: z.coerce.number().optional().default(2).describe('Link depth from the seed (0 = seed only; max 5)'),
      max_pages: z.coerce.number().optional().describe('Hard page budget (max 25; default: Research settings)'),
      match_patterns: z.array(z.string()).optional().describe('Glob or /regex/ allow-list applied to child URLs (e.g. ["/docs/*", "/builds/*"])'),
      same_origin: z.coerce.boolean().optional().describe('Stay on the seed origin (default true)'),
      prefer_llm: z.coerce.boolean().optional().describe('Try content-negotiated Markdown/Text before rendering (default true)'),
      harvest_to_cortex: z.coerce.boolean().optional().describe('Index each page into LanceDB Cortex (default true)'),
      selector: z.string().optional().describe('Scope link extraction to a CSS selector'),
      delay_ms: z.coerce.number().optional().describe('Politeness delay between pages in ms (default: 300, or Research settings when stealth is on)'),
      concurrency: z.coerce.number().optional().describe('Parallel page fetches (1-4). Keep at 1 for politeness/stealth; higher values raise WAF risk.'),
    },
    endpoint: '/crawl/deep',
    payload: (args) => ({
      url: args?.url,
      start_url: args?.url,
      max_depth: args?.max_depth,
      max_pages: args?.max_pages,
      match_patterns: args?.match_patterns,
      same_origin: args?.same_origin,
      prefer_llm: args?.prefer_llm,
      harvest_to_cortex: args?.harvest_to_cortex,
      selector: args?.selector,
      delay_ms: args?.delay_ms,
      concurrency: args?.concurrency,
    }),
    format: (data) => {
      const pages = Array.isArray(data.pages) ? data.pages : [];
      const head = `### deep_crawl — ${data.startUrl}\n- ${data.pageCount} page(s) · depth ${data.depthReached} · ${data.cortexIndexed} indexed into Cortex${data.truncated ? ' · truncated at budget' : ''}`;
      const rows = pages.map(
        (p: any, i: number) => `${i + 1}. [d${p.depth} · ${p.via}${p.indexed ? '' : ' · unindexed'}] ${p.title} — ${p.url}${p.error ? ` (error: ${p.error})` : ''}`,
      );
      const notes = (data.notes || []).length ? `\n\nNotes:\n- ${(data.notes || []).join('\n- ')}` : '';
      return `${head}\n${rows.join('\n')}${notes}`;
    },
  },
  {
    name: 'research_topic',
    description:
      'Autonomous research mode: searches the web, gathers the top sources (content-negotiated Markdown/Text when advertised, else a detached render), distills each to Markdown, and indexes them into LanceDB Cortex. ' +
      'Returns EXTRACTIVE, CITED evidence — each source highlight is a real paragraph that mentions the query terms — plus the ranked source list. It does NOT write prose: YOU synthesize the answer (and can follow up with recall_memory over the indexed pages).',
    parameters: {
      query: z.string().describe('Research topic / question'),
      max_sources: z.coerce.number().optional().default(5).describe('Distinct sources to gather (max 8)'),
      engine: z.enum(['google', 'duckduckgo', 'bing', 'brave', 'startpage', 'custom']).optional().describe('Pin one search engine (default: auto chain)'),
      engines: z.array(z.string()).optional().describe('Explicit ordered search-engine fallback chain'),
      url_template: z.string().optional().describe('URL template with {query} for a custom/SearXNG engine'),
      excerpt_chars: z.coerce.number().optional().default(1200).describe('Chars of each source kept for highlighting (max 4000)'),
      harvest_to_cortex: z.coerce.boolean().optional().describe('Index each source into LanceDB Cortex (default true)'),
      prefer_llm: z.coerce.boolean().optional().describe('Try content-negotiated Markdown/Text before rendering (default true)'),
    },
    endpoint: '/research/topic',
    payload: (args) => ({
      query: args?.query,
      max_sources: args?.max_sources,
      engine: args?.engine,
      engines: args?.engines,
      url_template: args?.url_template,
      excerpt_chars: args?.excerpt_chars,
      harvest_to_cortex: args?.harvest_to_cortex,
      prefer_llm: args?.prefer_llm,
    }),
    format: (data) => {
      const sources = Array.isArray(data.sources) ? data.sources : [];
      const head = `### Research: "${data.query}"\n- ${data.sourceCount} source(s) · ${data.cortexIndexed} indexed into Cortex${data.engine ? ` · via ${data.engine}` : ''}`;
      const body = sources
        .map((s: any, i: number) => {
          const hls = (s.highlights || []).map((h: string) => `   • ${h}`).join('\n');
          return `${i + 1}. [${s.title}](${s.url}) [${s.via}${s.indexed ? '' : ' · unindexed'}]${s.snippet ? `\n   ${s.snippet}` : ''}${hls ? `\n${hls}` : ''}${s.error ? `\n   (error: ${s.error})` : ''}`;
        })
        .join('\n');
      const notes = (data.notes || []).length ? `\n\nNotes:\n- ${(data.notes || []).join('\n- ')}` : '';
      return `${head}\n${body}${notes}`;
    },
  },
  {
    name: 'collect_all',
    description:
      'Scroll a virtualized/lazy list to the bottom and collect every distinct row (deduped by text+href) in ONE call. The abstraction that replaces a manual scroll-and-harvest sweep. ' +
      'Auto-detects the repeating item container; use selector/ref to scope it and scroll="window" for page-level infinite scroll.',
    parameters: {
      selector: z.string().optional().describe('CSS selector of the list container (default: auto-detect)'),
      ref: z.coerce.number().optional().describe('Mark id of the list container (from find/list_marks)'),
      scroll: z.enum(['container', 'window']).optional().default('container').describe('Scroll the container itself or the whole window'),
      step: z.coerce.number().optional().default(600).describe('Pixels per scroll step'),
      delay_ms: z.coerce.number().optional().default(250).describe('Wait after each scroll for lazy content'),
      max_scrolls: z.coerce.number().optional().default(30).describe('Safety cap on scroll iterations'),
      max: z.coerce.number().optional().default(300).describe('Max rows to collect'),
    },
    endpoint: '/collect',
    payload: (args) => ({
      selector: args?.selector,
      ref: args?.ref,
      scroll: args?.scroll || 'container',
      step: args?.step,
      delay_ms: args?.delay_ms,
      max_scrolls: args?.max_scrolls,
      max: args?.max,
    }),
    format: (data) => {
      if (data.error) return `collect_all failed: ${data.error}`;
      const rows = (data.rows || []).map((r: any, i: number) => `${i + 1}. ${r.text}${r.href ? ` -> ${r.href}` : ''}`);
      return `# collect_all — ${data.count} distinct rows after ${data.scrolls} scrolls\n${rows.join('\n')}`;
    },
  },
  {
    name: 'frames',
    description:
      'Lists the page\'s iframes as first-class content instead of blank boxes: each frame\'s top-level rect, URL, and the controls inside it with coordinates ALREADY offset into the page viewport. ' +
      'Pass screenshots=true to get one image per visible frame, which is how a cross-origin widget, embedded checkout or consent wall becomes something the model can actually look at. ' +
      'Feed the returned control x/y to act(x, y). Marks/find remain main-frame by default, so this is the tool for anything inside an iframe.',
    parameters: {
      include_controls: z.coerce.boolean().optional().default(true).describe('Describe the controls inside each frame (default: true)'),
      screenshots: z.coerce.boolean().optional().default(false).describe('Return one cropped image per visible frame (default: false; opt-in because it costs a capture)'),
      selector: z.string().optional().describe('Restrict the in-frame control scan to this CSS selector'),
      max_frames: z.coerce.number().optional().default(6).describe('Frame budget, breadth-first (default: 6, max: 16)'),
      max_controls: z.coerce.number().optional().default(40).describe('Max controls to describe per frame (default: 40, max: 200)'),
      include_offscreen: z.coerce.boolean().optional().default(false).describe('Also include frames/controls outside the viewport (default: false)'),
      max_side: z.coerce.number().optional().default(1024).describe('Longest side of a frame screenshot in px (default: 1024)'),
    },
    endpoint: '/frames',
    payload: (args) => ({
      include_controls: args?.include_controls,
      screenshots: args?.screenshots === true,
      selector: args?.selector,
      max_frames: args?.max_frames,
      max_controls: args?.max_controls,
      include_offscreen: args?.include_offscreen === true,
      max_side: args?.max_side,
    }),
    format: (data) => {
      const frames = Array.isArray(data.frames) ? data.frames : [];
      const vp = data.viewport || {};
      const lines = [`# frames — ${Math.max(0, frames.length - 1)} child frame(s), viewport ${vp.width || '?'}x${vp.height || '?'}`];
      for (const frame of frames) {
        const where = frame.depth === 0 ? 'main' : frame.rect ? `${frame.rect.width}x${frame.rect.height} @ (${frame.rect.x}, ${frame.rect.y})` : 'no geometry';
        const origin = frame.crossOrigin ? 'cross-origin' : frame.depth === 0 ? 'top document' : 'same-origin';
        lines.push(`[${frame.depth}] ${where} — ${frame.url || '(blank)'}${frame.name ? ` "${frame.name}"` : ''} — ${origin}${frame.error ? ` — ${frame.error}` : ''}`);
        for (const control of frame.controls || []) {
          const name = control.name || control.value || '';
          const actions = (control.actions || []).join('/');
          const flags = [control.occluded ? 'occluded' : '', control.visible ? '' : 'hidden', control.disabled ? 'disabled' : ''].filter(Boolean);
          lines.push(`    <${control.tag}> "${name}" @ (${control.rect.x}, ${control.rect.y})${actions ? ` {${actions}}` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
        }
        if (frame.controlsTotal !== undefined && frame.controlsTotal > (frame.controls || []).length) {
          lines.push(`    … ${frame.controlsTotal - (frame.controls || []).length} more control(s) not shown`);
        }
      }
      for (const note of data.notes || []) lines.push(`note: ${note}`);
      if (Array.isArray(data.images) && data.images.length) lines.push(`${data.images.length} frame image(s) attached.`);
      return lines.join('\n');
    },
  },
  {
    name: 'find',
    description:
      'Semantic element search. Returns Set-of-Marks refs (mark ids) for the light/open DOM, and with sealed:true also returns controls inside closed shadow roots as coordinates (no mark id) — feed those to act(x, y). Filter by role, accessible/text name, regex, tag or CSS selector.',
    parameters: {
      role: z.string().optional().describe('ARIA role or implied role (e.g. "button", "link", "combobox")'),
      name: z.string().optional().describe('Accessible-name substring (case-insensitive)'),
      contains: z.string().optional().describe('Text/value substring'),
      regex: z.string().optional().describe('Regex over text/value'),
      tag: z.string().optional().describe('Element tag, e.g. "A" or "BUTTON"'),
      selector: z.string().optional().describe('CSS selector the element must match (light/open DOM only)'),
      limit: z.coerce.number().optional().default(25).describe('Max refs to return'),
      include_offscreen: z.coerce.boolean().optional().default(true).describe('Also search below/above the fold (default: true)'),
      sealed: z.coerce.boolean().optional().default(false).describe('Also search inside closed shadow roots (opt-in; cached and rate-limited)'),
      include_frames: z.coerce.boolean().optional().default(false).describe('Also search child frames; returns 100+ mark ids usable with act(mark_id)'),
      refresh: z.coerce.boolean().optional().default(false).describe('Force a fresh sealed scan instead of the short identity cache'),
    },
    endpoint: '/find',
    payload: (args) => ({
      role: args?.role,
      name: args?.name,
      contains: args?.contains,
      regex: args?.regex,
      tag: args?.tag,
      selector: args?.selector,
      limit: args?.limit,
      include_offscreen: args?.include_offscreen,
      sealed: args?.sealed,
      include_frames: args?.include_frames,
      refresh: args?.refresh,
    }),
    format: (data) => {
      const rows = (data.marks || []).map((m: any) => formatMark(m));
      const sealedRows = (data.sealed || []).map((c: any) => {
        const cx = Math.round(c.rect.x + c.rect.width / 2);
        const cy = Math.round(c.rect.y + c.rect.height / 2);
        const flags = [c.inViewport === false ? 'offscreen' : '', c.disabled ? 'disabled' : ''].filter(Boolean);
        const token = c.token ? ` token=${c.token}` : '';
        return `[sealed] <${c.role}> "${c.name}" @ (${cx}, ${cy})${flags.length ? ` {${flags.join(', ')}}` : ''}${token}`;
      });
      const sealedNote = data.sealedTotal !== undefined
        ? `\nsealed: ${(data.sealed || []).length} of ${data.sealedTotal}${data.sealedCached ? ' (cached)' : ''}`
        : '';
      return `# find — ${data.count} of ${data.total} match(es)${sealedNote}\n${rows.concat(sealedRows).join('\n')}`;
    },
  },
  {
    name: 'expect',
    description: 'Immediate assertion (no polling) over the same condition vocabulary as wait_for. Returns pass/fail plus per-condition evidence, so an agent can self-check before proceeding instead of guessing.',
    parameters: {
      conditions: z.array(z.record(z.string(), z.any())).describe('Conditions to assert immediately, e.g. [{"type":"text","text":"GBP"},{"type":"url","pattern":"/flights"}]'),
    },
    endpoint: '/expect',
    payload: (args) => ({ conditions: args?.conditions || (args?.condition ? [args.condition] : []) }),
    format: (data) => {
      const lines = (data.results || []).map((r: any) => `${r.ok ? '✓' : '✗'} ${r.type}${r.evidence ? ` — ${r.evidence}` : ''}`);
      return `${data.ok ? 'PASS' : 'FAIL'} (${data.results.filter((r: any) => r.ok).length}/${data.results.length} conditions)\n${lines.join('\n')}`;
    },
  },
  {
    name: 'focus_walk',
    description:
      'Enter a closed shadow root like a keyboard user: focus the host, then send trusted Tab (or Shift+Tab) steps and read the accessibility tree to confirm which inner control actually has focus. Stops when focus leaves the host, the step budget is spent, or focus is lost. Use act(action:"press", text:"Enter") to activate the landed control.',
    parameters: {
      selector: z.string().optional().describe('Light-DOM host selector to start from'),
      x: z.coerce.number().optional().describe('Viewport x of the host (when there is no stable selector)'),
      y: z.coerce.number().optional().describe('Viewport y of the host'),
      direction: z.enum(['forward', 'backward']).optional().default('forward').describe('Tab or Shift+Tab'),
      max_steps: z.coerce.number().optional().default(8).describe('Maximum key presses (1-12)'),
      restore: z.coerce.boolean().optional().default(true).describe('Return focus to the host if the walk fails'),
    },
    endpoint: '/focus_walk',
    payload: (args) => ({
      selector: args?.selector,
      x: args?.x,
      y: args?.y,
      direction: args?.direction,
      max_steps: args?.max_steps,
      restore: args?.restore,
    }),
    format: (data) => {
      const steps = Array.isArray(data.steps) ? data.steps : [];
      const rows = steps.map((s: any) => {
        const label = s.index === 0 ? 'initial' : `#${s.index}`;
        const cx = Math.round(s.rect.x + s.rect.width / 2);
        const cy = Math.round(s.rect.y + s.rect.height / 2);
        return `${label} <${s.role}> "${s.name}" @ (${cx}, ${cy})`;
      });
      const median = data.medianStepGapMs !== undefined ? ` median=${data.medianStepGapMs}ms` : '';
      return `focus_walk — landed=${data.landed} reason=${data.reason} steps=${steps.length}${median}\n${rows.join('\n')}`;
    },
  },
  {
    name: 'act',
    description:
      'Click, focus, hover, type into, or press on one page target. Address the target by: mark_id (preferred - a Set-of-Marks badge, resilient to layout shifts), a CSS selector, x/y viewport coordinates, or target_text for controls with no semantics (React cards: a div with a handler three levels up, no role/href/onclick). ' +
      'Selectors resolve through open shadow roots and, for a custom-element host, to the control a mouse would actually hit — so `#email` or `my-text-input` reaches the real <input>, not the host wrapper. ' +
      'Returns a before/after delta; pass await_conditions to do "act then wait" in one round trip, and dry_run=true to resolve the target without acting. secret=true redacts typed text from logs. For action="type", pass clear_first=true on a pre-filled field so the value is REPLACED (select-all + delete) rather than appended to. action="press" needs no target. ' +
      'Typing is VERIFIED: the control\'s value is read before and after, and if nothing changed the result is ok:false with error.code "TYPE_NO_EFFECT", a `typing` evidence object (key counts, value lengths — never the text) and a hint that distinguishes "input never arrived" (focus/window) from "the control rejects synthetic input" (one-time-code/OTP → request_human_intervention). ' +
      'NOT for navigation (use navigate_to) or scrolling (use scroll_page). ' +
      'HUMAN_IN_PROGRESS means a person just used the browser: synthetic input is paused for a short quiet window. Do not retry in a loop — poll /human/status, wait for idle, then re-observe. ' +
      'Choosing the target is a separate job: when a decision model is configured AND two or more controls plausibly match, prefer observe(as:"components") -> decide -> act(mark_id); when exactly one control matches, find/act is faster and deterministic.',
    parameters: {
      mark_id: z.coerce.number().optional().describe('Target Set-of-Marks badge id from observe/find/take_screenshot (preferred)'),
      selector: z.coerce.string().optional().describe('CSS selector of the target, when you have no mark id (e.g. "button.submit", "#search-input")'),
      x: z.coerce.number().optional().describe('Viewport X for coordinate targeting (pair with y)'),
      y: z.coerce.number().optional().describe('Viewport Y for coordinate targeting (pair with x)'),
      target_text: z.string().optional().describe('Anchor by visible text when the control has no semantics (React card divs, handler-only elements). Resolves the deepest visible element containing the text; refuses when more than one match is ambiguous'),
      sealed_token: z.string().optional().describe('Opaque token from find(sealed:true); scrolls/re-measures the sealed control before acting'),
      action: z.enum(['click', 'focus', 'hover', 'type', 'press']).default('click').describe('Action to perform (default: "click")'),
      text: z.string().optional().describe('Text for action="type"; key name for action="press" (e.g. "Enter")'),
      secret: z.coerce.boolean().optional().default(false).describe('Redact typed text from logs'),
      clear_first: z.coerce.boolean().optional().default(false).describe('For action="type": clear the field first (select-all + delete) so an existing value is REPLACED, not appended to — use it on pre-filled inputs and comboboxes'),
      await_conditions: z.array(z.record(z.string(), z.any())).optional().describe('wait_for conditions evaluated right after the action'),
      timeout_ms: z.coerce.number().optional().default(15000).describe('Timeout for await_conditions'),
      dry_run: z.coerce.boolean().optional().default(false).describe('Resolve the target but do not act'),
    },
    endpoint: '/act',
    payload: (args) => ({
      mark_id: args?.mark_id,
      selector: args?.selector,
      target_text: args?.target_text,
      sealed_token: args?.sealed_token,
      x: args?.x,
      y: args?.y,
      action: args?.action || 'click',
      text: args?.text !== undefined ? String(args.text) : undefined,
      secret: args?.secret === true,
      clear_first: args?.clear_first === true,
      await: args?.await_conditions,
      timeout_ms: args?.timeout_ms,
      dry_run: args?.dry_run === true,
    }),
    format: (data, args) => {
      const t = data.target || {};
      const where =
        t.id !== undefined
          ? `[#${t.id}] <${t.tag}> "${t.text}"`
          : t.selector
            ? `${t.tag ? `<${t.tag}> ` : ''}${t.selector}${t.text ? ` "${t.text}"` : ''}`
            : t.center
              ? `(${t.center.x}, ${t.center.y})`
              : '(nothing)';
      if (data.dryRun) return `DRY RUN — would ${data.action} ${where}${data.wouldType ? ` typing "${data.wouldType}"` : ''}`;
      if (data.action === 'press') return `press "${args?.text || 'Enter'}"`;
      const d = data.delta || {};
      const parts = [
        `${data.action} ${where}`,
        d.urlChanged ? `url: ${d.beforeUrl} -> ${d.afterUrl}` : 'url unchanged',
        `revision ${d.revisionBefore}->${d.revisionAfter}`,
        `marks ${d.marksBefore}->${d.marksAfter}`,
      ];
      if (data.awaited) parts.push(`await: ${data.awaited.ok ? 'READY' : 'TIMED OUT'} in ${data.awaited.waitedMs}ms${data.awaited.hint ? ` [${data.awaited.hint}]` : ''}`);
      return parts.join(' · ');
    },
  },
  {
    name: 'page_state',
    description: 'Cheap monotonic state signature (revision, url, title, mark count, DOM node count, scroll height, text length/hash). Use with diff() to detect change without re-reading the page.',
    parameters: {},
    endpoint: '/page-state',
    method: 'POST',
    format: (data) => JSON.stringify(data.state, null, 2),
  },
  {
    name: 'diff',
    description: 'Field-by-field diff between the current page state and a previously observed revision (from page_state/observe/act). Shows exactly what changed: url, title, marks, nodeCount, height, scrollY, textLen, textHash.',
    parameters: {
      since: z.coerce.number().optional().describe('Revision to diff against (default: earliest recorded state)'),
    },
    endpoint: '/diff',
    payload: (args) => ({ since: args?.since }),
    format: (data) => {
      if (!data.changed) return `No change since revision ${data.from?.revision} (revision ${data.to?.revision}).`;
      const lines = Object.entries(data.changes || {}).map(([k, v]: any) => `${k}: ${JSON.stringify(v.from)} -> ${JSON.stringify(v.to)}`);
      return `Changed ${data.from?.revision} -> ${data.to?.revision}\n${lines.join('\n')}`;
    },
  },
  {
    name: 'bridge_health',
    description: 'Bridge + app liveness and capability discovery: version, page revision, negotiated primitives capabilities, active tab/url, window focused/visible state, the active synthetic-input transport (cdp|native), and the timestamp of the last mutating action.',
    parameters: {},
    endpoint: '/health',
    method: 'GET',
    format: (data) => JSON.stringify({ status: data.status, version: data.version, revision: data.revision, capabilities: data.capabilities, url: data.info?.url, title: data.info?.title, window: data.window, input: data.input, lastActionAt: data.lastActionAt }, null, 2),
  },
  {
    name: 'export_har',
    description: 'Exports captured network traffic as a HAR 1.2 log (request/response headers + body previews). Set save=true to write data/har/har_<ts>.har and get the path; otherwise the HAR JSON is returned.',
    parameters: {
      pattern: z.string().optional().describe('URL substring filter'),
      limit: z.coerce.number().optional().default(250).describe('Max entries'),
      save: z.coerce.boolean().optional().default(false).describe('Write the HAR to data/har/ and return the path instead of the JSON'),
    },
    endpoint: '/network/har',
    payload: (args) => ({ pattern: args?.pattern, limit: args?.limit, save: args?.save === true }),
    format: (data) => (data.filePath ? `HAR written to ${data.filePath} (${data.entries} entries)` : JSON.stringify(data.har)),
  },
  {
    name: 'context_save',
    description: 'Saves the current browsing context (cookies + storage) under a name — the profile abstraction for authenticated sessions.',
    parameters: { name: z.string().optional().describe('Context name (auto-generated if omitted)') },
    endpoint: '/context/save',
    payload: (args) => ({ name: args?.name }),
    format: (data) => JSON.stringify(data.result),
  },
  {
    name: 'context_open',
    description: 'Restores (switches to) a named browsing context/profile, reloading its cookies and storage.',
    parameters: { name: z.string().describe('Context name to restore') },
    endpoint: '/context/open',
    payload: (args) => ({ name: args?.name }),
    format: (data) => JSON.stringify(data.result),
  },
  {
    name: 'context_list',
    description: 'Lists saved browsing contexts (cookie/storage profiles).',
    parameters: {},
    endpoint: '/context/list',
    method: 'GET',
    format: (data) => JSON.stringify(data.contexts, null, 2),
  },
  {
    name: 'context_delete',
    description: 'Deletes a saved browsing context/profile.',
    parameters: { name: z.string().describe('Context name to delete') },
    endpoint: '/context/delete',
    payload: (args) => ({ name: args?.name }),
    format: (data) => JSON.stringify({ deleted: data.deleted }),
  },
];

/**
 * Renamed tools: the canonical name is visible, the old name stays callable by
 * name (hidden from `tools/list`) for one release. Each legacy entry is cloned
 * from its canonical entry so the two can never drift out of sync.
 * Decision: docs/TOOL_CATALOG_REVIEW.md §6.
 */
const LEGACY_ALIASES: Array<[legacy: string, canonical: string]> = [
  ['get_history', 'browsing_history'],
  ['clear_history', 'browsing_history_clear'],
  ['recall_script', 'list_scripts'],
  ['focus_window', 'set_window_visibility'],
];

for (const [legacy, canonical] of LEGACY_ALIASES) {
  const target = TOOLS_CATALOG.find((t) => t.name === canonical);
  if (target) {
    TOOLS_CATALOG.push({ ...target, name: legacy, hidden: true, deprecatedInFavorOf: canonical });
  }
}

/**
 * Discoverability tiers (docs/TOOL_CATALOG_REVIEW.md §3, Phase 4).
 *
 * Only tools that have a preferred alternative are tiered — a tool that is the only
 * way to do its job is left unprefixed (no false "tier" noise). `bridge-server.ts`
 * renders the label as a description prefix so the guidance travels with every entry
 * in `tools/list`, for any agent framework.
 */
export const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: 'TIER 1 · prefer',
  2: 'TIER 2 · fallback',
  3: 'TIER 3 · use deliberately',
};

export const TOOL_TIERS: Record<string, 1 | 2 | 3> = {
  // TIER 1 — first choice for the job.
  observe: 1,
  act: 1,
  wait_for: 1,
  expect: 1,
  find: 1,
  extract: 1,
  collect_all: 1,
  page_state: 1,
  diff: 1,
  // TIER 2 — fallbacks when the preferred path cannot do it.
  take_screenshot: 2,
  snapshot_rendered_page: 2,
  press_key: 2,
  // TIER 3 — a powerful tool, not a last resort: reach for it deliberately
  // (prefer the primitives when they fit; injected JS is a bot-detection signal).
  evaluate_javascript: 3,
};
