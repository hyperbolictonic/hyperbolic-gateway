import http from 'node:http';
import type { BrowserChassis } from './browser-chassis.js';

export function startHttpBridge(chassis: BrowserChassis, port: number = 4111) {
  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Helper to read JSON body
    const readBody = (): Promise<any> =>
      new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({});
          }
        });
      });

    // Helper to send JSON
    const sendJson = (data: any, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    };

    try {
      if (req.method === 'GET' && pathname === '/health') {
        const info = chassis.getPageInfo();
        sendJson({ status: 'ok', info });
        return;
      }

      if (req.method === 'POST' && pathname === '/navigate') {
        const body = await readBody();
        const result = await chassis.navigateTo(body.url);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/click') {
        const body = await readBody();
        const coords = body.x !== undefined && body.y !== undefined ? { x: body.x, y: body.y } : undefined;
        const result = await chassis.clickElement(body.selector, coords);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/type') {
        const body = await readBody();
        const result = await chassis.typeText(body.text, body.selector);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/press-key') {
        const body = await readBody();
        const result = await chassis.pressKey(body.key);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/scroll') {
        const body = await readBody();
        const result = await chassis.scrollPage(body.direction || 'down', body.amount || 400);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'GET' && pathname === '/markdown') {
        const construct = await chassis.harvestMarkdown();
        sendJson({ success: true, construct });
        return;
      }

      if (req.method === 'GET' && pathname === '/screenshot') {
        const screenshot = await chassis.takeScreenshot();
        sendJson({ success: true, screenshot });
        return;
      }

      if (req.method === 'POST' && pathname === '/evaluate') {
        const body = await readBody();
        const result = await chassis.evaluateJavaScript(body.script);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'GET' && pathname === '/console-logs') {
        const logs = chassis.getTargetConsoleLogs(50);
        sendJson({ success: true, logs });
        return;
      }

      if (req.method === 'GET' && pathname === '/fingerprint') {
        const profile = chassis.getFingerprintProfile();
        sendJson({ success: true, profile });
        return;
      }

      if (req.method === 'POST' && pathname === '/history') {
        const body = await readBody();
        let result = '';
        if (body.action === 'back') result = await chassis.goBack();
        else if (body.action === 'forward') result = await chassis.goForward();
        else if (body.action === 'reload') result = await chassis.reload();
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'GET' && pathname === '/tabs') {
        const tabs = chassis.getTabsSummary();
        sendJson({ success: true, tabs });
        return;
      }

      if (req.method === 'POST' && pathname === '/tabs/new') {
        const body = await readBody();
        const tab = chassis.createTab(body.url);
        sendJson({ success: true, tab });
        return;
      }

      if (req.method === 'POST' && pathname === '/tabs/switch') {
        const body = await readBody();
        chassis.switchTab(body.tabId);
        sendJson({ success: true, message: `Switched to tab ${body.tabId}` });
        return;
      }

      if (req.method === 'POST' && pathname === '/tabs/close') {
        const body = await readBody();
        chassis.closeTab(body.tabId);
        sendJson({ success: true, message: `Closed tab ${body.tabId || 'active'}` });
        return;
      }

      // Cortex LanceDB Semantic Memory Endpoints
      if (req.method === 'POST' && pathname === '/cortex/recall') {
        const body = await readBody();
        const cortex = chassis.getCortex();
        const results = await cortex.recall(body.query, { limit: body.limit, domain: body.domain });
        sendJson({ success: true, results });
        return;
      }

      if (req.method === 'GET' && pathname === '/cortex/history') {
        const cortex = chassis.getCortex();
        const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;
        const domain = url.searchParams.get('domain') || undefined;
        const history = await cortex.getHistory({ limit, domain });
        sendJson({ success: true, history });
        return;
      }

      if (req.method === 'POST' && pathname === '/cortex/history/clear') {
        const body = await readBody();
        const cortex = chassis.getCortex();
        await cortex.clearHistory(body.olderThan);
        sendJson({ success: true, message: 'History cleared' });
        return;
      }

      // Bookmarks Endpoints
      if (req.method === 'GET' && pathname === '/bookmarks') {
        const cortex = chassis.getCortex();
        const query = url.searchParams.get('q') || undefined;
        const tag = url.searchParams.get('tag') || undefined;
        const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;
        const bookmarks = await cortex.listBookmarks({ query, tag, limit });
        sendJson({ success: true, bookmarks });
        return;
      }

      if (req.method === 'POST' && pathname === '/bookmarks/add') {
        const body = await readBody();
        const cortex = chassis.getCortex();
        const activeUrl = chassis.getTabsSummary().find(t => t.isActive)?.url || 'about:blank';
        const bookmark = await cortex.addBookmark({
          url: body.url || activeUrl,
          title: body.title,
          notes: body.notes,
          tags: body.tags
        });
        sendJson({ success: true, bookmark });
        return;
      }

      if (req.method === 'POST' && pathname === '/bookmarks/delete') {
        const body = await readBody();
        const cortex = chassis.getCortex();
        const deleted = await cortex.deleteBookmark(body.urlOrId);
        sendJson({ success: true, deleted });
        return;
      }

      if (req.method === 'GET' && pathname === '/bookmarks/check') {
        const cortex = chassis.getCortex();
        const checkUrl = url.searchParams.get('url') || '';
        const isBookmarked = await cortex.isBookmarked(checkUrl);
        sendJson({ success: true, isBookmarked });
        return;
      }

      sendJson({ error: 'Endpoint not found' }, 404);
    } catch (err: any) {
      sendJson({ success: false, error: err?.message || String(err) }, 500);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    chassis.addLog('info', `Autonomous Bridge active at http://127.0.0.1:${port}`);
  });

  return server;
}
