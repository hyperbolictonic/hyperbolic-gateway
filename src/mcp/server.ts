import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { BrowserChassis } from '../main/browser-chassis.js';
import { formatMark } from './format-mark.js';
import { APP_VERSION } from '../shared/version.js';

export function createMcpServer(chassis: BrowserChassis) {
  const server = new McpServer({
    name: 'kuang-grade-mark-eleven',
    version: APP_VERSION,
  });

  // Tool 1: navigate_to (primary semantic navigation tool)
  server.tool(
    'navigate_to',
    'Navigates the real, visible Chromium browser window to a destination URL. Automatically dismisses GDPR/cookie consent overlays by default.',
    {
      url: z.string().describe('The destination URL (e.g. "https://news.ycombinator.com" or "https://wikipedia.org")'),
      auto_dismiss_consent: z.boolean().optional().default(true).describe('Whether to automatically detect and dismiss cookie/GDPR consent overlays (default: true)'),
    },
    async ({ url, auto_dismiss_consent }) => {
      try {
        const result = await chassis.navigateTo(url, auto_dismiss_consent);
        return { content: [{ type: 'text', text: result }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Navigation failed: ${error?.message || error}` }] };
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
        const result = await chassis.navigateTo(url);
        return { content: [{ type: 'text', text: result }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Navigation failed: ${error?.message || error}` }] };
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
        const coords = x !== undefined && y !== undefined ? { x, y } : undefined;
        const result = await chassis.clickElement(selector, coords);
        return { content: [{ type: 'text', text: result }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Click failed: ${error?.message || error}` }] };
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
        const result = await chassis.typeText(text, selector);
        return { content: [{ type: 'text', text: result }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Typing failed: ${error?.message || error}` }] };
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
        const result = await chassis.pressKey(key);
        return { content: [{ type: 'text', text: result }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Key press failed: ${error?.message || error}` }] };
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
        const result = await chassis.scrollPage(direction, amount);
        return { content: [{ type: 'text', text: result }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Scroll failed: ${error?.message || error}` }] };
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
        const { base64Image, filePath, width, height } = await chassis.takeScreenshot();
        const rawBase64 = base64Image.replace(/^data:image\/png;base64,/, '');

        return {
          content: [
            {
              type: 'text',
              text: `Captured viewport screenshot (${width}x${height}px)${filePath ? `, saved to ${filePath}` : ''}.`,
            },
            {
              type: 'image',
              data: rawBase64,
              mimeType: 'image/png',
            },
          ],
        };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Screenshot failed: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 7: get_page_markdown (primary semantic content harvester)
  server.tool(
    'get_page_markdown',
    'Extracts the active web page content downsampled into clean, token-efficient Markdown with YAML front-matter metadata (title, URL, timestamp, estimated token count). Strips ads, scripts, and clutter.',
    {},
    async () => {
      try {
        const construct = await chassis.harvestMarkdown();
        return { content: [{ type: 'text', text: construct.content }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to extract markdown: ${error?.message || error}` }] };
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
        const construct = await chassis.harvestMarkdown();
        return { content: [{ type: 'text', text: construct.content }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to extract markdown: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 8: evaluate_javascript
  server.tool(
    'evaluate_javascript',
    'Executes custom JavaScript expression inside the active web page context and returns the JSON-serializable result.',
    {
      script: z.string().describe('JavaScript code to evaluate in page context (e.g. "document.title", "window.location.href", "Array.from(document.querySelectorAll(\'h2\')).map(e => e.textContent)")'),
    },
    async ({ script }) => {
      try {
        const result = await chassis.evaluateJavaScript(script);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `JavaScript evaluation failed: ${error?.message || error}` }] };
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
        const info = chassis.getPageInfo();
        return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to get page info: ${error?.message || error}` }] };
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
        let result = '';
        if (action === 'back') result = await chassis.goBack();
        else if (action === 'forward') result = await chassis.goForward();
        else if (action === 'reload') result = await chassis.reload();
        return { content: [{ type: 'text', text: result }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `History navigation failed: ${error?.message || error}` }] };
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
        const logs = chassis.getTargetConsoleLogs(limit);
        return { content: [{ type: 'text', text: JSON.stringify(logs, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to retrieve console logs: ${error?.message || error}` }] };
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
        const profile = chassis.getFingerprintProfile();
        return { content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to get fingerprint profile: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 13: dismiss_consent (Shield Breaker)
  server.tool(
    'dismiss_consent',
    'Autonomously scans the active web page for cookie consent banners, GDPR dialogs, or blocking overlays (OneTrust, Cookiebot, Google, etc.) and physically clicks Accept/Dismiss using the Bézier cursor.',
    {},
    async () => {
      try {
        const result = await chassis.dismissConsent();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to dismiss consent banner: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 14: fill_form (Single-Turn Batch Form Filler)
  server.tool(
    'fill_form',
    'Fills multiple form fields (inputs, textareas, dropdown selects, checkboxes, radios) in a single turn with human-like typing cadence and micro-pauses. Optionally submits the form.',
    {
      fields: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).describe('Map of CSS selectors to their values. e.g. {"#name": "Dade", "input[name=\'email\']": "dade@gibson.net", "#agree": true}'),
      submit_selector: z.string().optional().describe('Optional CSS selector of the submit button to click after all fields are filled.'),
    },
    async ({ fields, submit_selector }) => {
      try {
        const result = await chassis.fillForm(fields as Record<string, string | boolean | number>, submit_selector);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Form fill failed: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 15: list_downloads
  server.tool(
    'list_downloads',
    'Returns a structured list of all files downloaded by the browser session into the workspace data/downloads folder, including size, status, and timestamps.',
    {},
    async () => {
      try {
        const downloads = chassis.getDownloads();
        return { content: [{ type: 'text', text: JSON.stringify(downloads, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to list downloads: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 16: read_download
  server.tool(
    'read_download',
    'Reads and parses a downloaded file (PDF, CSV, JSON, text) into a token-efficient markdown representation for LLM analysis.',
    {
      filename_or_id: z.string().describe('The filename or unique download ID of the file to inspect.'),
    },
    async ({ filename_or_id }) => {
      try {
        const doc = await chassis.readDownloadedDocument(filename_or_id);
        return { content: [{ type: 'text', text: `Document: ${doc.filename} (${doc.estimatedTokens} tokens)\n\n${doc.content}` }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to read download: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 17: save_session
  server.tool(
    'save_session',
    'Saves the current session cookies and local storage state into a persistent named JSON vault snapshot.',
    {
      name: z.string().optional().describe('Optional custom snapshot identifier. If omitted, uses current domain hostname.'),
    },
    async ({ name }) => {
      try {
        const res = await chassis.saveSession(name);
        return { content: [{ type: 'text', text: `Saved session "${res.name}" with ${res.cookiesCount} cookies to ${res.filePath}` }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to save session: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 18: restore_session
  server.tool(
    'restore_session',
    'Restores cookies and local storage state from a named vault snapshot into the active browser session.',
    {
      name: z.string().describe('The snapshot name or domain identifier to restore.'),
    },
    async ({ name }) => {
      try {
        const res = await chassis.restoreSession(name);
        return { content: [{ type: 'text', text: `Restored session "${res.name}": successfully rehydrated ${res.cookiesRestored} cookies.` }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to restore session: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 19: list_sessions
  server.tool(
    'list_sessions',
    'Returns a structured list of all saved session snapshots in the vault with metadata and cookie counts.',
    {},
    async () => {
      try {
        const sessions = chassis.listSessions();
        return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to list sessions: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 20: get_network_traffic
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
        const traffic = chassis.getNetworkTraffic({
          urlPattern: url_pattern,
          method,
          resourceType: resource_type,
          limit,
        });
        return { content: [{ type: 'text', text: JSON.stringify(traffic, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to get network traffic: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 21: get_api_payload
  server.tool(
    'get_api_payload',
    'Retrieves the full decoded JSON or text response body for a specific network request ID captured by the interceptor.',
    {
      request_id: z.string().describe('The unique requestId from get_network_traffic to inspect.'),
    },
    async ({ request_id }) => {
      try {
        const payload = chassis.getApiPayload(request_id);
        const bodyText = typeof payload.data === 'object'
          ? JSON.stringify(payload.data, null, 2)
          : String(payload.data);
        return {
          content: [
            {
              type: 'text',
              text: `API Response [${payload.status || 'OK'}] ${payload.url} (${payload.mimeType || 'unknown'}):\n\n${bodyText}`,
            },
          ],
        };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to get API payload: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 22: clear_network_traffic
  server.tool(
    'clear_network_traffic',
    'Clears the in-memory Chrome DevTools Protocol network request and payload buffer.',
    {},
    async () => {
      try {
        chassis.clearNetworkTraffic();
        return { content: [{ type: 'text', text: 'Network traffic buffer cleared.' }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to clear traffic: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 22b: query_json_data
  server.tool(
    'query_json_data',
    'Token-efficient JSON navigator. Inspects schemas, extracts nested dot/bracket paths (e.g. "items[0..3].price"), searches keys, or runs filters without dumping massive multi-megabyte payloads into the LLM context.',
    {
      source: z.enum(['network_payload', 'stream_messages', 'download_file', 'inline_json']).default('network_payload').describe('Data source'),
      source_id: z.string().optional().describe('Target request ID, stream ID, or download filename'),
      path: z.string().optional().describe('JSONPath / dot-notation query, e.g. "itineraries[0..3].pricing", "items[?price < 300]"'),
      view: z.enum(['value', 'schema', 'keys', 'summary']).optional().default('value').describe('Inspection mode: "schema", "keys", "summary", or "value"'),
      limit: z.coerce.number().optional().default(25).describe('Max array items to return (default: 25)'),
      filter_predicate: z.string().optional().describe('Filter expression, e.g. "price < 300", "usesCookies == true"'),
      json_string: z.string().optional().describe('Inline JSON string (when source is "inline_json")'),
    },
    async (args) => {
      try {
        const result = chassis.queryJsonData({
          source: (args.source || 'network_payload') as any,
          sourceId: args.source_id,
          path: args.path,
          view: args.view as any,
          limit: args.limit !== undefined ? Number(args.limit) : 25,
          filterPredicate: args.filter_predicate,
          jsonString: args.json_string,
        });
        const header = `### JSON Navigator Query [${result.path || '$'}] (view: ${result.view}${result.matchCount !== undefined ? `, total: ${result.matchCount}` : ''})\n`;
        const body = typeof result.data === 'string' ? result.data : `\`\`\`json\n${JSON.stringify(result.data, null, 2)}\n\`\`\``;
        return { content: [{ type: 'text', text: `${header}${body}` }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `JSON Navigator error: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 22c: snapshot_rendered_page
  server.tool(
    'snapshot_rendered_page',
    'Captures a post-hydration, rendered point-in-time snapshot of dynamic, JavaScript-heavy pages (React, Next.js, Vue). Freezes live state, pierces Shadow DOM, and extracts ultra-token-efficient Accessibility (AX) Trees, rendered Markdown, or unrendered source HTML.',
    {
      format: z.enum(['ax_tree', 'markdown', 'html', 'unrendered_html']).optional().default('ax_tree').describe('Snapshot format: "ax_tree" (recommended: semantic roles, labels, and states with zero cosmetic div noise), "markdown" (computed DOM markdown with live values), "html" (rendered static HTML), or "unrendered_html" (raw pre-mutation HTML source)'),
      wait_until_idle_ms: z.coerce.number().optional().default(400).describe('Time in ms to wait for pending network microtasks and React state updates to settle (default: 400)'),
      pierce_shadow_dom: z.coerce.boolean().optional().default(true).describe('Whether to traverse and unwrap encapsulated Shadow Roots (#shadow-root)'),
      save_to_disk: z.coerce.boolean().optional().default(false).describe('Whether to persist snapshot to data/snapshots/ for offline re-inspection via query_json_data'),
      force_rerender: z.coerce.boolean().optional().default(false).describe('Whether to force reflow and dispatch resize events to trigger re-renders before snapshotting'),
    },
    async (args) => {
      try {
        const res = await chassis.snapshotRenderedPage({
          format: args.format,
          waitUntilIdleMs: args.wait_until_idle_ms,
          pierceShadowDom: args.pierce_shadow_dom,
          saveToDisk: args.save_to_disk,
          forceRerender: args.force_rerender,
        });
        const stats = res.stats || {};
        const fileNotice = res.filePath ? ` (Saved to: ${res.filePath})` : '';
        const header = `### Rendered Page Snapshot [${res.format?.toUpperCase()}] — "${res.title}" (${stats.estimatedTokens || 0} est tokens, ${stats.byteLength || 0} bytes)${fileNotice}\nURL: ${res.url}\n\n`;
        return { content: [{ type: 'text', text: `${header}${res.content}` }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to snapshot rendered page: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 22d: prerender_links
  server.tool(
    'prerender_links',
    'Speculative Pre-rendering Engine. Pre-executes, hydrates, and caches candidate links in background views so subsequent navigation is 0ms instantaneous. Automatically distills and indexes content into LanceDB Cortex memory.',
    {
      urls: z.array(z.string()).optional().describe('Specific candidate URLs to prerender. If omitted, uses selector or page link heuristics'),
      selector: z.string().optional().describe('CSS selector to pick candidate links from the active page (e.g. "a.search-result", ".docs-nav a")'),
      max_pages: z.coerce.number().optional().default(3).describe('Maximum candidate pages to prerender in background pool (max: 3)'),
      harvest_to_cortex: z.coerce.boolean().optional().default(true).describe('Whether to automatically distill and index pre-rendered pages into LanceDB Cortex memory for instant recall_memory'),
      wait_until_idle_ms: z.coerce.number().optional().default(500).describe('Hydration wait time per candidate view'),
    },
    async (args) => {
      try {
        const res = await chassis.prerenderLinks({
          urls: args.urls,
          selector: args.selector,
          maxPages: args.max_pages,
          harvestToCortex: args.harvest_to_cortex,
          waitUntilIdleMs: args.wait_until_idle_ms,
        });
        const list = Array.isArray(res.prerendered) ? res.prerendered : [];
        if (list.length === 0) {
          return { content: [{ type: 'text', text: 'No candidate links were pre-rendered.' }] };
        }
        const lines = list.map((u: string) => `- [0ms READY] ${u}`);
        return {
          content: [
            {
              type: 'text',
              text: `### Speculative Pre-rendered Pool (${list.length} pages warm & indexed to Cortex)\nSubsequent navigate_to() calls targeting these URLs will load with 0ms perceived latency.\n\n${lines.join('\n')}`,
            },
          ],
        };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to prerender links: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 23: take_annotated_screenshot
  server.tool(
    'take_annotated_screenshot',
    'Captures an annotated screenshot tagged with high-contrast, numbered neon badges over all visible interactive elements, returning the image and marks lookup table for 100% click precision.',
    {},
    async () => {
      try {
        const res = await chassis.takeAnnotatedScreenshot();
        const base64Data = res.screenshot.base64Image.replace(/^data:image\/png;base64,/, '');
        const marksTable = res.marks.map((m) => formatMark(m)).join('\n');
        const filePath = res.screenshot.filePath;
        return {
          content: [
            {
              type: 'text',
              text: `Interactive Elements (${res.marks.length} detected)${filePath ? ` (screenshot saved to ${filePath})` : ''}:\n\n${marksTable}\n\nUse click_mark(id) or type_mark(id, text) to interact.`,
            },
            {
              type: 'image',
              data: base64Data,
              mimeType: 'image/png',
            },
          ],
        };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Annotated screenshot failed: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 23b/23c: lightweight Set-of-Marks variants
  const registerMarksVariant = (name: string, description: string, opts: { economy?: boolean; textOnly?: boolean }) => {
    server.tool(name, description, {}, async () => {
      try {
        const res = await chassis.takeAnnotatedScreenshot(opts);
        const marksTable = res.marks.map((m) => formatMark(m)).join('\n');
        const filePath = res.screenshot.filePath;
        const content: any[] = [
          {
            type: 'text',
            text: `Interactive Elements (${res.marks.length} detected)${filePath ? ` (screenshot saved to ${filePath})` : ''}:\n\n${marksTable}\n\nUse click_mark(id) or type_mark(id, text) to interact.`,
          },
        ];
        if (res.screenshot.base64Image) {
          content.push({
            type: 'image',
            data: res.screenshot.base64Image.replace(/^data:image\/[a-z]+;base64,/, ''),
            mimeType: res.screenshot.mimeType,
          });
        }
        return { content };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `${name} failed: ${error?.message || error}` }] };
      }
    });
  };
  registerMarksVariant(
    'take_economy_screenshot',
    'Lightweight Set-of-Marks screenshot: 640px-wide JPEG plus the numbered element table. Much cheaper than take_annotated_screenshot.',
    { economy: true }
  );
  registerMarksVariant(
    'list_marks',
    'Text-only Set-of-Marks: numbered interactive element table with NO image. Cheapest page scan; click_mark/type_mark work afterwards.',
    { textOnly: true }
  );

  // Tool 24: click_mark
  server.tool(
    'click_mark',
    'Drives the humanized Bézier ghost cursor to the element corresponding to a numbered visual mark ID and clicks it.',
    {
      mark_id: z.number().describe('The numbered visual badge ID (e.g. 1, 2, 3...) to click.'),
    },
    async ({ mark_id }) => {
      try {
        const result = await chassis.clickMark(mark_id);
        return { content: [{ type: 'text', text: result }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Click mark failed: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 25: type_mark
  server.tool(
    'type_mark',
    'Clicks the element corresponding to a numbered visual mark ID to focus it, then types text with realistic human typing cadence.',
    {
      mark_id: z.number().describe('The numbered visual badge ID to focus and type into.'),
      text: z.string().describe('The text string to type into the marked element.'),
    },
    async ({ mark_id, text }) => {
      try {
        const result = await chassis.typeMark(mark_id, text);
        return { content: [{ type: 'text', text: result }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Type mark failed: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 26: save_script
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
        const script = await chassis.saveScript({ name, code, description, domain, tags });
        return { content: [{ type: 'text', text: `Saved and indexed script "${script.name}" in Cortex Vault.` }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to save script: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 27: recall_script
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
        const scripts = await chassis.recallScripts(query, { domain, tag, limit });
        return { content: [{ type: 'text', text: JSON.stringify(scripts, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to recall scripts: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 28: run_script
  server.tool(
    'run_script',
    'Executes a saved JavaScript macro from the vault inside the active browser tab, passing optional runtime arguments.',
    {
      name: z.string().describe('The name of the script in the vault to execute.'),
      args: z.record(z.string(), z.any()).optional().describe('Optional arguments object passed directly into the script.'),
    },
    async ({ name, args }) => {
      try {
        const execution = await chassis.runScript(name, args);
        const resultText = typeof execution.result === 'object'
          ? JSON.stringify(execution.result, null, 2)
          : String(execution.result);
        return {
          content: [
            {
              type: 'text',
              text: `Executed script "${execution.name}" in ${execution.executionDurationMs}ms:\n\n${resultText}`,
            },
          ],
        };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to run script: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 29: list_scripts
  server.tool(
    'list_scripts',
    'Returns all registered scripts in the vault with metadata, domains, and tags.',
    {},
    async () => {
      try {
        const scripts = await chassis.listScripts();
        return { content: [{ type: 'text', text: JSON.stringify(scripts, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to list scripts: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 30: delete_script
  server.tool(
    'delete_script',
    'Deletes a saved script from the persistent vault and LanceDB vector index.',
    {
      name: z.string().describe('Name of the script to delete.'),
    },
    async ({ name }) => {
      try {
        const deleted = await chassis.deleteScript(name);
        return { content: [{ type: 'text', text: deleted ? `Deleted script "${name}".` : `Script "${name}" not found.` }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to delete script: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 31: list_realtime_streams
  server.tool(
    'list_realtime_streams',
    'Returns all active and recent WebSockets (wss://) and Server-Sent Events (SSE / text/event-stream) connections intercepted via Chrome DevTools Protocol.',
    {
      type: z.enum(['websocket', 'sse']).optional().describe('Filter by stream protocol ("websocket" or "sse").'),
      active_only: z.boolean().optional().describe('Filter for currently open streams only (default: false).'),
    },
    async ({ type, active_only }) => {
      try {
        const streams = chassis.getRealtimeStreams({ type, activeOnly: active_only });
        return { content: [{ type: 'text', text: JSON.stringify(streams, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to list streams: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 32: get_stream_messages
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
        const messages = chassis.getStreamMessages({ streamId: stream_id, type, direction, limit });
        return { content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to get stream messages: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 33: clear_stream_messages
  server.tool(
    'clear_stream_messages',
    'Clears the in-memory WebSocket and SSE stream message frame buffer.',
    {
      stream_id: z.string().optional().describe('Optional streamId to clear specifically. If omitted, clears all stream messages.'),
    },
    async ({ stream_id }) => {
      try {
        chassis.clearStreamMessages(stream_id);
        return { content: [{ type: 'text', text: 'Stream message buffer cleared.' }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to clear stream messages: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 34: request_human_intervention
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
        const result = await chassis.requestHumanIntervention(reason, {
          timeoutSeconds: timeout_seconds,
          bringToFront: bring_to_front,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Human intervention error: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 35: resolve_human_intervention
  server.tool(
    'resolve_human_intervention',
    'Resolves an active human intervention request, unpausing the agent.',
    {
      id: z.string().optional().describe('Specific intervention ID (resolves current active request if omitted).'),
      notes: z.string().optional().describe('Optional confirmation notes or summary of action taken.'),
    },
    async ({ id, notes }) => {
      try {
        const resolved = chassis.resolveHumanIntervention(id, notes);
        return {
          content: [
            {
              type: 'text',
              text: resolved
                ? `Intervention resolved successfully: ${notes || 'User confirmed.'}`
                : 'No pending intervention request matching that ID was found.',
            },
          ],
        };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to resolve intervention: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 36: get_human_intervention_status
  server.tool(
    'get_human_intervention_status',
    'Inspects the current human intervention state and request history.',
    {},
    async () => {
      try {
        const active = chassis.getActiveHumanIntervention();
        const history = chassis.getHumanInterventionHistory();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ active_request: active, history_count: history.length, recent_history: history.slice(-5) }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to get intervention status: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 37: send_notification
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
        const sent = chassis.sendNotification(title, message, urgency, sound);
        return { content: [{ type: 'text', text: JSON.stringify({ success: sent, title, message }) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to send notification: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 38: set_window_visibility
  server.tool(
    'set_window_visibility',
    'Controls the cyberdeck desktop window visibility (e.g. minimize to system tray to stay out of the user\'s way, or restore to screen).',
    {
      visible: z.boolean().describe('true to restore and focus window; false to minimize/hide to the system tray.'),
    },
    async ({ visible }) => {
      try {
        chassis.setWindowVisibility(visible);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, visible: chassis.isWindowVisible(), state: visible ? 'WINDOW_RESTORED' : 'MINIMIZED_TO_TRAY' }),
            },
          ],
        };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to set window visibility: ${error?.message || error}` }] };
      }
    }
  );

  // Tool 39: configure_system_tray
  server.tool(
    'configure_system_tray',
    'Inspects or configures system tray behavior (such as enabling/disabling close-to-tray).',
    {
      close_to_tray: z.boolean().optional().describe('If specified, enables (true) or disables (false) minimize-to-tray when user clicks the window close button.'),
    },
    async ({ close_to_tray }) => {
      try {
        if (typeof close_to_tray === 'boolean') {
          chassis.setCloseToTray(close_to_tray);
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                close_to_tray: chassis.isCloseToTray(),
                is_window_visible: chassis.isWindowVisible(),
              }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text', text: `Failed to configure tray: ${error?.message || error}` }] };
      }
    }
  );

  return {
    startStdio: async () => {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      chassis.addLog('info', 'MCP Stdio Transport connected. Tools loaded with clean semantic schemas.');
    },
  };
}
