import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BRIDGE_URL = 'http://127.0.0.1:4111';

async function callBridge(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${BRIDGE_URL}${endpoint}`, options);
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    throw new Error(
      `Unable to connect to Cyberdeck at ${BRIDGE_URL}. Ensure the visible browser window is running via 'pnpm run dev'. (${err.message})`
    );
  }
}

const server = new McpServer({
  name: 'kuang-grade-mark-eleven',
  version: '1.0.0',
});

// Tool 1: navigate_to
server.tool(
  'navigate_to',
  'Navigates the real, visible Chromium browser window to a destination URL. Automatically dismisses GDPR/cookie consent overlays by default.',
  {
    url: z.string().describe('The destination URL (e.g. "https://news.ycombinator.com" or "https://reddit.com")'),
    auto_dismiss_consent: z.boolean().optional().default(true).describe('Whether to automatically detect and dismiss cookie/GDPR consent overlays (default: true)'),
  },
  async ({ url, auto_dismiss_consent }) => {
    try {
      const data = await callBridge('/navigate', 'POST', { url, autoDismissConsent: auto_dismiss_consent });
      return { content: [{ type: 'text', text: data.result }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Backward-compatible alias: go_to_url
server.tool(
  'go_to_url',
  'Alias for navigate_to. Navigates the browser window to a destination URL.',
  {
    url: z.string().describe('The destination URL'),
  },
  async ({ url }) => {
    try {
      const data = await callBridge('/navigate', 'POST', { url });
      return { content: [{ type: 'text', text: data.result }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 2: click_element
server.tool(
  'click_element',
  'Clicks an element on the active web page using a CSS selector or direct viewport coordinates (x, y). Simulates realistic human pointer movement and switch actuation.',
  {
    selector: z.string().optional().describe('CSS selector of the element to click (e.g. "button.submit", "a[href*=\'login\']", "#search-input")'),
    x: z.number().optional().describe('Direct X coordinate on the viewport in pixels'),
    y: z.number().optional().describe('Direct Y coordinate on the viewport in pixels'),
  },
  async ({ selector, x, y }) => {
    try {
      const data = await callBridge('/click', 'POST', { selector, x, y });
      return { content: [{ type: 'text', text: data.result }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 3: type_text
server.tool(
  'type_text',
  'Types text into an input field or the currently active element. Simulates natural human keystroke cadence (60-240ms per key) to prevent automated bot detection.',
  {
    text: z.string().describe('The text string to type into the field'),
    selector: z.string().optional().describe('Optional CSS selector of the input field to click and focus before typing'),
  },
  async ({ text, selector }) => {
    try {
      const data = await callBridge('/type', 'POST', { text, selector });
      return { content: [{ type: 'text', text: data.result }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 4: press_key
server.tool(
  'press_key',
  'Sends a specific keyboard key event (e.g. "Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp"). Useful for submitting forms or closing overlays.',
  {
    key: z.string().describe('The key name to press (e.g. "Enter", "Tab", "Escape", "Backspace")'),
  },
  async ({ key }) => {
    try {
      const data = await callBridge('/press-key', 'POST', { key });
      return { content: [{ type: 'text', text: data.result }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 5: scroll_page
server.tool(
  'scroll_page',
  'Scrolls the visible web page up or down using realistic incremental mousewheel inertia.',
  {
    direction: z.enum(['up', 'down']).describe('Direction to scroll'),
    amount: z.number().optional().default(400).describe('Scroll distance in pixels (default: 400)'),
  },
  async ({ direction, amount }) => {
    try {
      const data = await callBridge('/scroll', 'POST', { direction, amount });
      return { content: [{ type: 'text', text: data.result }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 6: take_screenshot
server.tool(
  'take_screenshot',
  'Captures the live high-resolution Chromium viewport as an image payload for multimodal visual inspection and layout verification.',
  {},
  async () => {
    try {
      const data = await callBridge('/screenshot', 'GET');
      const { base64Image, width, height } = data.screenshot;
      const rawBase64 = base64Image.replace(/^data:image\/png;base64,/, '');

      return {
        content: [
          {
            type: 'text',
            text: `Captured viewport screenshot (${width}x${height}px).`,
          },
          {
            type: 'image',
            data: rawBase64,
            mimeType: 'image/png',
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 7: get_page_markdown
server.tool(
  'get_page_markdown',
  'Extracts the active web page content downsampled into clean, token-efficient Markdown with YAML front-matter metadata (title, URL, timestamp, estimated token count). Strips ads, scripts, and clutter.',
  {},
  async () => {
    try {
      const data = await callBridge('/markdown', 'GET');
      return { content: [{ type: 'text', text: data.construct.content }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Backward-compatible alias: harvest_markdown
server.tool(
  'harvest_markdown',
  'Alias for get_page_markdown. Extracts clean, token-efficient Markdown from the active page.',
  {},
  async () => {
    try {
      const data = await callBridge('/markdown', 'GET');
      return { content: [{ type: 'text', text: data.construct.content }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 8: evaluate_javascript
server.tool(
  'evaluate_javascript',
  'Executes custom JavaScript expression inside the active web page context and returns the JSON-serializable result.',
  {
    script: z.string().describe('JavaScript code to evaluate in page context (e.g. "document.title", "window.location.href")'),
  },
  async ({ script }) => {
    try {
      const data = await callBridge('/evaluate', 'POST', { script });
      return { content: [{ type: 'text', text: JSON.stringify(data.result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 9: get_page_info
server.tool(
  'get_page_info',
  'Returns the current page URL, page title, and loading status without extracting full page content.',
  {},
  async () => {
    try {
      const data = await callBridge('/health', 'GET');
      return { content: [{ type: 'text', text: JSON.stringify(data.info, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 10: navigate_history
server.tool(
  'navigate_history',
  'Navigates backward or forward in browser history, or reloads the active page.',
  {
    action: z.enum(['back', 'forward', 'reload']).describe('Navigation action to execute'),
  },
  async ({ action }) => {
    try {
      const data = await callBridge('/history', 'POST', { action });
      return { content: [{ type: 'text', text: data.result }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 11: get_console_logs
server.tool(
  'get_console_logs',
  'Returns recent console log messages, warnings, and errors output by the active web page and scripts.',
  {
    limit: z.number().optional().default(50).describe('Maximum number of recent console logs to return (default: 50)'),
  },
  async ({ limit }) => {
    try {
      const data = await callBridge('/console-logs', 'GET');
      return { content: [{ type: 'text', text: JSON.stringify(data.logs, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 12: get_fingerprint_profile
server.tool(
  'get_fingerprint_profile',
  'Returns the active stealth fingerprint profile spoofing the host machine\'s installed default browser (e.g. Google Chrome, Edge, Brave), including user agent and client hints.',
  {},
  async () => {
    try {
      const data = await callBridge('/fingerprint', 'GET');
      return { content: [{ type: 'text', text: JSON.stringify(data.profile, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 13: new_tab
server.tool(
  'new_tab',
  'Opens a new browsing tab in the Cyberdeck, optionally navigates to a destination URL, and focuses it as the active tab.',
  {
    url: z.string().optional().describe('Optional destination URL for the new tab (e.g. "https://news.ycombinator.com")'),
  },
  async ({ url }) => {
    try {
      const data = await callBridge('/tabs/new', 'POST', { url });
      return { content: [{ type: 'text', text: `Opened new tab [${data.tab.id}]: "${data.tab.title}" (${data.tab.url})` }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 14: switch_tab
server.tool(
  'switch_tab',
  'Switches active browsing focus to the specified tab ID.',
  {
    tab_id: z.string().describe('The ID of the tab to switch to (e.g. "tab_1", "tab_2")'),
  },
  async ({ tab_id }) => {
    try {
      const data = await callBridge('/tabs/switch', 'POST', { tabId: tab_id });
      return { content: [{ type: 'text', text: data.message }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 15: close_tab
server.tool(
  'close_tab',
  'Closes the specified tab (or the currently active tab if omitted) and frees its memory resources.',
  {
    tab_id: z.string().optional().describe('Optional ID of the tab to close. Defaults to the currently active tab.'),
  },
  async ({ tab_id }) => {
    try {
      const data = await callBridge('/tabs/close', 'POST', { tabId: tab_id });
      return { content: [{ type: 'text', text: data.message }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 16: list_tabs
server.tool(
  'list_tabs',
  'Returns a structured list of all open browser tabs in the Cyberdeck, including their IDs, titles, URLs, and active status.',
  {},
  async () => {
    try {
      const data = await callBridge('/tabs', 'GET');
      return { content: [{ type: 'text', text: JSON.stringify(data.tabs, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 17: recall_memory
server.tool(
  'recall_memory',
  'Performs hybrid semantic vector and BM25 full-text search (powered by embedded LanceDB) across all visited web pages and harvested markdown content in the Cyberdeck persistent memory.',
  {
    query: z.string().describe('The search query or concept to recall (e.g. "path of exile 2 monk builds" or "quantum computing algorithms")'),
    limit: z.number().optional().describe('Maximum number of matching chunks to return (default: 5)'),
    domain: z.string().optional().describe('Optional domain filter (e.g. "wikipedia.org", "github.com")'),
  },
  async ({ query, limit, domain }) => {
    try {
      const data = await callBridge('/cortex/recall', 'POST', { query, limit, domain });
      return { content: [{ type: 'text', text: JSON.stringify(data.results, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 18: get_history
server.tool(
  'get_history',
  'Retrieves chronological browsing history of pages visited and indexed by the Cyberdeck in LanceDB.',
  {
    limit: z.number().optional().describe('Maximum number of history records to retrieve (default: 20)'),
    domain: z.string().optional().describe('Optional domain filter (e.g. "google.com")'),
  },
  async ({ limit, domain }) => {
    try {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(limit));
      if (domain) params.set('domain', domain);
      const data = await callBridge(`/cortex/history?${params.toString()}`, 'GET');
      return { content: [{ type: 'text', text: JSON.stringify(data.history, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 19: clear_history
server.tool(
  'clear_history',
  'Clears browsing history from the persistent LanceDB memory.',
  {
    older_than: z.string().optional().describe('Optional ISO date string or "all" (default: "all")'),
  },
  async ({ older_than }) => {
    try {
      const data = await callBridge('/cortex/history/clear', 'POST', { olderThan: older_than || 'all' });
      return { content: [{ type: 'text', text: data.message }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 20: add_bookmark
server.tool(
  'add_bookmark',
  'Saves a webpage (or the active tab if URL is omitted) as a persistent bookmark with tags and notes in LanceDB.',
  {
    url: z.string().optional().describe('The URL to bookmark. If omitted, bookmarks the currently active tab.'),
    title: z.string().optional().describe('Optional custom title for the bookmark.'),
    notes: z.string().optional().describe('Optional research notes or summary of why this resource is useful.'),
    tags: z.array(z.string()).optional().describe('Optional tags for categorization (e.g. ["poe2", "guide", "docs"]).'),
  },
  async ({ url, title, notes, tags }) => {
    try {
      const data = await callBridge('/bookmarks/add', 'POST', { url, title, notes, tags });
      return { content: [{ type: 'text', text: JSON.stringify(data.bookmark, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 21: list_bookmarks
server.tool(
  'list_bookmarks',
  'Retrieves or semantically searches saved bookmarks from the persistent LanceDB database.',
  {
    query: z.string().optional().describe('Optional semantic search query to filter bookmarks.'),
    tag: z.string().optional().describe('Optional tag to filter bookmarks (e.g. "docs").'),
    limit: z.number().optional().describe('Maximum number of bookmarks to return (default: 20).'),
  },
  async ({ query, tag, limit }) => {
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (tag) params.set('tag', tag);
      if (limit) params.set('limit', String(limit));
      const data = await callBridge(`/bookmarks?${params.toString()}`, 'GET');
      return { content: [{ type: 'text', text: JSON.stringify(data.bookmarks, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 22: delete_bookmark
server.tool(
  'delete_bookmark',
  'Removes a bookmark by URL or ID from the persistent database.',
  {
    url_or_id: z.string().describe('The bookmark ID or exact URL to remove.'),
  },
  async ({ url_or_id }) => {
    try {
      const data = await callBridge('/bookmarks/delete', 'POST', { urlOrId: url_or_id });
      return { content: [{ type: 'text', text: data.deleted ? `Bookmark deleted: ${url_or_id}` : `Bookmark not found: ${url_or_id}` }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
// Tool 23: dismiss_consent (Autonomous Shield Breaker)
server.tool(
  'dismiss_consent',
  'Autonomously scans the active web page for cookie consent banners, GDPR dialogs, or blocking overlays (OneTrust, Cookiebot, Google, etc.) and physically clicks Accept/Dismiss using the Bézier cursor.',
  {},
  async () => {
    try {
      const data = await callBridge('/shield/dismiss', 'POST');
      return { content: [{ type: 'text', text: JSON.stringify(data.result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 24: fill_form (Single-Turn Batch Form Filler)
server.tool(
  'fill_form',
  'Fills multiple form fields (inputs, textareas, dropdown selects, checkboxes, radios) in a single turn with human-like typing cadence and micro-pauses. Optionally submits the form.',
  {
    fields: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).describe('Map of CSS selectors to their values. e.g. {"#name": "Dade", "input[name=\'email\']": "dade@gibson.net", "#agree": true}'),
    submit_selector: z.string().optional().describe('Optional CSS selector of the submit button to click after all fields are filled.'),
  },
  async ({ fields, submit_selector }) => {
    try {
      const data = await callBridge('/form/fill', 'POST', { fields, submitSelector: submit_selector });
      return { content: [{ type: 'text', text: JSON.stringify(data.result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
// Tool 25: list_downloads
server.tool(
  'list_downloads',
  'Returns a structured list of all files downloaded by the browser session into the workspace data/downloads folder, including size, status, and timestamps.',
  {},
  async () => {
    try {
      const data = await callBridge('/downloads', 'GET');
      return { content: [{ type: 'text', text: JSON.stringify(data.downloads, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 26: read_download
server.tool(
  'read_download',
  'Reads and parses a downloaded file (PDF, CSV, JSON, text) into a token-efficient markdown representation for LLM analysis.',
  {
    filename_or_id: z.string().describe('The filename or unique download ID of the file to inspect.'),
  },
  async ({ filename_or_id }) => {
    try {
      const data = await callBridge('/downloads/read', 'POST', { filename: filename_or_id });
      return { content: [{ type: 'text', text: `Document: ${data.document.filename} (${data.document.estimatedTokens} tokens)\n\n${data.document.content}` }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 27: save_session
server.tool(
  'save_session',
  'Saves the current session cookies and local storage state into a persistent named JSON vault snapshot.',
  {
    name: z.string().optional().describe('Optional custom snapshot identifier. If omitted, uses current domain hostname.'),
  },
  async ({ name }) => {
    try {
      const data = await callBridge('/session/save', 'POST', { name });
      return { content: [{ type: 'text', text: `Saved session "${data.result.name}" with ${data.result.cookiesCount} cookies to ${data.result.filePath}` }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 28: restore_session
server.tool(
  'restore_session',
  'Restores cookies and local storage state from a named vault snapshot into the active browser session.',
  {
    name: z.string().describe('The snapshot name or domain identifier to restore.'),
  },
  async ({ name }) => {
    try {
      const data = await callBridge('/session/restore', 'POST', { name });
      return { content: [{ type: 'text', text: `Restored session "${data.result.name}": successfully rehydrated ${data.result.cookiesRestored} cookies.` }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 29: list_sessions
server.tool(
  'list_sessions',
  'Returns a structured list of all saved session snapshots in the vault with metadata and cookie counts.',
  {},
  async () => {
    try {
      const data = await callBridge('/session/list', 'GET');
      return { content: [{ type: 'text', text: JSON.stringify(data.sessions, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 30: get_network_traffic
server.tool(
  'get_network_traffic',
  'Inspects live HTTP/XHR/Fetch network traffic intercepted via Chrome DevTools Protocol, returning status, timing, and body previews.',
  {
    url_pattern: z.string().optional().describe('Optional URL pattern filter (e.g. "api", "graphql", "v1").'),
    method: z.string().optional().describe('Optional HTTP method filter ("GET", "POST", etc.).'),
    resource_type: z.string().optional().describe('Optional resource type filter ("XHR", "Fetch", "Document", etc.).'),
    limit: z.number().optional().describe('Maximum number of network events to return (default: 50).'),
  },
  async ({ url_pattern, method, resource_type, limit }) => {
    try {
      const data = await callBridge('/network/traffic', 'POST', {
        urlPattern: url_pattern,
        method,
        resourceType: resource_type,
        limit,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data.traffic, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 31: get_api_payload
server.tool(
  'get_api_payload',
  'Retrieves the full decoded JSON or text response body for a specific network request ID captured by the interceptor.',
  {
    request_id: z.string().describe('The unique requestId from get_network_traffic to inspect.'),
  },
  async ({ request_id }) => {
    try {
      const data = await callBridge('/network/payload', 'POST', { requestId: request_id });
      const bodyText = typeof data.payload.data === 'object'
        ? JSON.stringify(data.payload.data, null, 2)
        : String(data.payload.data);
      return {
        content: [
          {
            type: 'text',
            text: `API Response [${data.payload.status || 'OK'}] ${data.payload.url} (${data.payload.mimeType || 'unknown'}):\n\n${bodyText}`,
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 32: clear_network_traffic
server.tool(
  'clear_network_traffic',
  'Clears the in-memory Chrome DevTools Protocol network request and payload buffer.',
  {},
  async () => {
    try {
      const data = await callBridge('/network/clear', 'POST');
      return { content: [{ type: 'text', text: data.message }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 33: take_annotated_screenshot
server.tool(
  'take_annotated_screenshot',
  'Captures an annotated screenshot tagged with high-contrast, numbered neon badges over all visible interactive elements, returning the image and marks lookup table for 100% click precision.',
  {},
  async () => {
    try {
      const data = await callBridge('/marks/screenshot', 'GET');
      const base64Data = data.screenshot.base64Image.replace(/^data:image\/png;base64,/, '');
      const marksTable = data.marks.map((m) => `[#${m.id}] <${m.tag}${m.type ? ` type="${m.type}"` : ''}> "${m.text}"`).join('\n');
      return {
        content: [
          {
            type: 'image',
            data: base64Data,
            mimeType: 'image/png',
          },
          {
            type: 'text',
            text: `Interactive Elements (${data.marks.length} detected):\n\n${marksTable}\n\nUse click_mark(id) or type_mark(id, text) to interact.`,
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 34: click_mark
server.tool(
  'click_mark',
  'Drives the humanized Bézier ghost cursor to the element corresponding to a numbered visual mark ID and clicks it.',
  {
    mark_id: z.number().describe('The numbered visual badge ID (e.g. 1, 2, 3...) to click.'),
  },
  async ({ mark_id }) => {
    try {
      const data = await callBridge('/marks/click', 'POST', { markId: mark_id });
      return { content: [{ type: 'text', text: data.result }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 35: type_mark
server.tool(
  'type_mark',
  'Clicks the element corresponding to a numbered visual mark ID to focus it, then types text with realistic human typing cadence.',
  {
    mark_id: z.number().describe('The numbered visual badge ID to focus and type into.'),
    text: z.string().describe('The text string to type into the marked element.'),
  },
  async ({ mark_id, text }) => {
    try {
      const data = await callBridge('/marks/type', 'POST', { markId: mark_id, text });
      return { content: [{ type: 'text', text: data.result }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 36: save_script
server.tool(
  'save_script',
  'Saves and embeds a reusable JavaScript macro or scraper into the persistent LanceDB Cortex Script Vault.',
  {
    name: z.string().describe('Unique identifier for the macro (e.g. "extract_flight_cards", "unroll_reddit_comments").'),
    code: z.string().describe('The JavaScript code or function to execute.'),
    description: z.string().optional().describe('Plain English description of what the script does for semantic vector recall.'),
    domain: z.string().optional().describe('Target domain (e.g. "skyscanner.net", "reddit.com", or "*" for universal).'),
    tags: z.array(z.string()).optional().describe('Keywords or category tags.'),
  },
  async ({ name, code, description, domain, tags }) => {
    try {
      const data = await callBridge('/scripts/save', 'POST', { name, code, description, domain, tags });
      return { content: [{ type: 'text', text: `Saved and indexed script "${data.script.name}" in Cortex Vault.` }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 37: recall_script
server.tool(
  'recall_script',
  'Semantically searches the Script Vault using natural language queries to discover reusable DOM scrapers and macros.',
  {
    query: z.string().optional().describe('Natural language search query (e.g. "pull price table", "extract comments").'),
    domain: z.string().optional().describe('Optional domain filter.'),
    tag: z.string().optional().describe('Optional category tag filter.'),
    limit: z.number().optional().describe('Maximum number of matching scripts to return (default: 10).'),
  },
  async ({ query, domain, tag, limit }) => {
    try {
      const data = await callBridge('/scripts/recall', 'POST', { query, domain, tag, limit });
      return { content: [{ type: 'text', text: JSON.stringify(data.scripts, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 38: run_script
server.tool(
  'run_script',
  'Executes a saved JavaScript macro from the vault inside the active browser tab, passing optional runtime arguments.',
  {
    name: z.string().describe('The name of the script in the vault to execute.'),
    args: z.record(z.string(), z.any()).optional().describe('Optional arguments object passed directly into the script.'),
  },
  async ({ name, args }) => {
    try {
      const data = await callBridge('/scripts/run', 'POST', { name, args });
      const resultText = typeof data.execution.result === 'object'
        ? JSON.stringify(data.execution.result, null, 2)
        : String(data.execution.result);
      return {
        content: [
          {
            type: 'text',
            text: `Executed script "${data.execution.name}" in ${data.execution.executionDurationMs}ms:\n\n${resultText}`,
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 39: list_scripts
server.tool(
  'list_scripts',
  'Returns all registered scripts in the vault with metadata, domains, and tags.',
  {},
  async () => {
    try {
      const data = await callBridge('/scripts/list', 'GET');
      return { content: [{ type: 'text', text: JSON.stringify(data.scripts, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 40: delete_script
server.tool(
  'delete_script',
  'Deletes a saved script from the persistent vault and LanceDB vector index.',
  {
    name: z.string().describe('Name of the script to delete.'),
  },
  async ({ name }) => {
    try {
      const data = await callBridge('/scripts/delete', 'POST', { name });
      return { content: [{ type: 'text', text: data.deleted ? `Deleted script "${name}".` : `Script "${name}" not found.` }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 41: list_realtime_streams
server.tool(
  'list_realtime_streams',
  'Returns all active and recent WebSockets (wss://) and Server-Sent Events (SSE / text/event-stream) connections intercepted via Chrome DevTools Protocol.',
  {
    type: z.enum(['websocket', 'sse']).optional().describe('Filter by stream protocol ("websocket" or "sse").'),
    active_only: z.boolean().optional().describe('Filter for currently open streams only (default: false).'),
  },
  async ({ type, active_only }) => {
    try {
      const data = await callBridge('/streams/list', 'POST', { type, activeOnly: active_only });
      return { content: [{ type: 'text', text: JSON.stringify(data.streams, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 42: get_stream_messages
server.tool(
  'get_stream_messages',
  'Inspects captured incoming and outgoing real-time messages / frames from WebSockets or Server-Sent Events (SSE).',
  {
    stream_id: z.string().optional().describe('Filter by specific streamId from list_realtime_streams.'),
    type: z.enum(['websocket', 'sse']).optional().describe('Filter by stream protocol.'),
    direction: z.enum(['sent', 'received']).optional().describe('Filter by frame direction ("sent" or "received").'),
    limit: z.number().optional().describe('Maximum number of frames to return (default: 50).'),
  },
  async ({ stream_id, type, direction, limit }) => {
    try {
      const data = await callBridge('/streams/messages', 'POST', { streamId: stream_id, type, direction, limit });
      return { content: [{ type: 'text', text: JSON.stringify(data.messages, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 43: clear_stream_messages
server.tool(
  'clear_stream_messages',
  'Clears the in-memory WebSocket and SSE stream message frame buffer.',
  {
    stream_id: z.string().optional().describe('Optional streamId to clear specifically. If omitted, clears all stream messages.'),
  },
  async ({ stream_id }) => {
    try {
      const data = await callBridge('/streams/clear', 'POST', { streamId: stream_id });
      return { content: [{ type: 'text', text: data.message }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 44: request_human_intervention
server.tool(
  'request_human_intervention',
  'Halts the agent and requests human-in-the-loop (HIL) assistance when credentials, 2FA, OTP, CAPTCHA, or manual human approval are required. Unhides/restores the cyberdeck window from the tray, flashes the taskbar, triggers an OS native desktop notification, and injects an interactive action banner into the active page. Blocks until the user confirms completion or timeout occurs.',
  {
    reason: z.string().describe('Clear explanation of what human action is needed (e.g. "Please solve the Cloudflare Turnstile challenge and log into your account").'),
    timeout_seconds: z.number().optional().describe('Max seconds to wait for human intervention before timing out (default: 180).'),
    bring_to_front: z.boolean().optional().describe('Whether to unhide and restore the browser window from system tray (default: true).'),
  },
  async ({ reason, timeout_seconds, bring_to_front }) => {
    try {
      const data = await callBridge('/hil/request', 'POST', {
        reason,
        timeoutSeconds: timeout_seconds,
        bringToFront: bring_to_front,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data.result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 45: resolve_human_intervention
server.tool(
  'resolve_human_intervention',
  'Resolves an active human intervention request, unpausing the agent.',
  {
    id: z.string().optional().describe('Specific intervention ID (resolves current active request if omitted).'),
    notes: z.string().optional().describe('Optional confirmation notes or summary of action taken.'),
  },
  async ({ id, notes }) => {
    try {
      const data = await callBridge('/hil/resolve', 'POST', { id, notes });
      return {
        content: [
          {
            type: 'text',
            text: data.resolved
              ? `Intervention resolved successfully: ${notes || 'User confirmed.'}`
              : 'No pending intervention request matching that ID was found.',
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 46: get_human_intervention_status
server.tool(
  'get_human_intervention_status',
  'Inspects the current human intervention state and request history.',
  {},
  async () => {
    try {
      const activeData = await callBridge('/hil/active', 'GET');
      const histData = await callBridge('/hil/history', 'GET');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                active_request: activeData.active,
                history_count: (histData.history || []).length,
                recent_history: (histData.history || []).slice(-5),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 47: send_notification
server.tool(
  'send_notification',
  'Dispatches an OS native desktop notification to alert the user without blocking agent execution (e.g. when a scraping run finishes or an important event occurs).',
  {
    title: z.string().describe('Notification title.'),
    message: z.string().describe('Notification body message.'),
    urgency: z.enum(['normal', 'critical', 'low']).optional().describe('Urgency level (default: normal).'),
    sound: z.boolean().optional().describe('Whether to play notification alert sound (default: true).'),
  },
  async ({ title, message, urgency, sound }) => {
    try {
      const data = await callBridge('/notify', 'POST', { title, message, urgency, sound });
      return { content: [{ type: 'text', text: JSON.stringify({ success: data.sent, title, message }) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 48: set_window_visibility
server.tool(
  'set_window_visibility',
  'Controls the cyberdeck desktop window visibility (e.g. minimize to system tray to stay out of the user\'s way, or restore to screen).',
  {
    visible: z.boolean().describe('true to restore and focus window; false to minimize/hide to the system tray.'),
  },
  async ({ visible }) => {
    try {
      const data = await callBridge('/window/visibility', 'POST', { visible });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, visible: data.visible, state: visible ? 'WINDOW_RESTORED' : 'MINIMIZED_TO_TRAY' }),
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

// Tool 49: configure_system_tray
server.tool(
  'configure_system_tray',
  'Inspects or configures system tray behavior (such as enabling/disabling close-to-tray).',
  {
    close_to_tray: z.boolean().optional().describe('If specified, enables (true) or disables (false) minimize-to-tray when user clicks the window close button.'),
  },
  async ({ close_to_tray }) => {
    try {
      const data = await callBridge('/window/tray', typeof close_to_tray === 'boolean' ? 'POST' : 'GET', { closeToTray: close_to_tray });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ close_to_tray: data.closeToTray }, null, 2),
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }
);

async function start() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

start().catch((err) => {
  console.error('Fatal MCP Server Error:', err);
  process.exit(1);
});
