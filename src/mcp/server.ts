import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { BrowserChassis } from '../main/browser-chassis.js';

export function createMcpServer(chassis: BrowserChassis) {
  const server = new McpServer({
    name: 'kuang-grade-mark-eleven',
    version: '1.0.0',
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
        const { base64Image, width, height } = await chassis.takeScreenshot();
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

  return {
    startStdio: async () => {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      chassis.addLog('info', 'MCP Stdio Transport connected. Tools loaded with clean semantic schemas.');
    },
  };
}
