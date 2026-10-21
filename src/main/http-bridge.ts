import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserChassis } from './browser-chassis.js';
import { APP_VERSION } from '../shared/version.js';
import { runDecision, decisionStatus } from './decide/decision-client.js';
import { decideGuarded } from './decide/decision-guard.js';

function logBridge(message: string, isError = false) {
  const timestamp = new Date().toISOString();
  if (isError) {
    console.error(`[Cyberdeck Bridge ${timestamp}] ${message}`);
  } else {
    console.log(`[Cyberdeck Bridge ${timestamp}] ${message}`);
  }
  try {
    const logDir = path.resolve(process.cwd(), 'data', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const cleanMsg = message.replace(/\x1b\[[0-9;]*m/g, '');
    fs.appendFileSync(path.join(logDir, 'http-bridge.log'), `[${timestamp}] ${cleanMsg}\n`);
  } catch {
    // Ignore logging disk errors
  }
}

export function startHttpBridge(chassis: BrowserChassis, port: number = 4111) {
  /** Timestamp of the last mutating action, for `since: "last_action"` network correlation. */
  let lastActionAt = Date.now();
  const MUTATING_PATHS = new Set([
    '/navigate', '/click', '/type', '/form/fill', '/press-key', '/scroll',
    '/marks/click', '/marks/type', '/act',
  ]);
  const server = http.createServer(async (req, res) => {
    const startTime = Date.now();

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

    if (req.method === 'POST' && MUTATING_PATHS.has(pathname)) {
      lastActionAt = Date.now();
    }

    if (req.method === 'GET') {
      logBridge(`--> \x1b[36mGET\x1b[0m ${pathname}`);
      chassis.addLog('info', `GET ${pathname}`);
    }

    // Helper to read JSON body
    const readBody = (): Promise<any> =>
      new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const parsed = body ? JSON.parse(body) : {};
            const preview = JSON.stringify(parsed);
            logBridge(`--> \x1b[35m${req.method}\x1b[0m ${pathname} body: ${preview.length > 300 ? preview.slice(0, 300) + '...' : preview}`);
            chassis.addLog('info', `${req.method} ${pathname}`);
            resolve(parsed);
          } catch {
            logBridge(`--> \x1b[35m${req.method}\x1b[0m ${pathname} body: [Raw/Non-JSON] ${body.slice(0, 100)}`);
            chassis.addLog('info', `${req.method} ${pathname}`);
            resolve({});
          }
        });
      });

    // Helper to send JSON
    const sendJson = (data: any, status = 200) => {
      const duration = Date.now() - startTime;
      const statusColor = status >= 400 ? '\x1b[31m' : '\x1b[32m';
      const summary = status >= 400 ? JSON.stringify(data) : (data?.result ? String(data.result).slice(0, 120) : 'OK');
      logBridge(`<-- ${statusColor}${status}\x1b[0m ${req.method} ${pathname} (${duration}ms) - ${summary}`, status >= 400);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    };

    try {
      if (req.method === 'GET' && (pathname === '/health' || pathname === '/page-info')) {
        const info = chassis.getPageInfo();
        sendJson({
          status: 'ok',
          app: 'kuang-grade-mark-eleven',
          version: APP_VERSION,
          revision: chassis.getRevision(),
          capabilities: chassis.getCapabilities(),
          decision: decisionStatus(),
          lastActionAt,
          window: { visible: chassis.isWindowVisible(), focused: chassis.isWindowFocused() },
          input: { transport: chassis.getSimulator().lastInputTransport },
          info,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/navigate') {
        const body = await readBody();
        const autoDismiss = body.autoDismissConsent !== undefined ? Boolean(body.autoDismissConsent) : true;
        let targetUrl = body.url || body.destination || body.target || body.link || ''; if (targetUrl && !/^https?:\/\//i.test(targetUrl) && !/^about:/i.test(targetUrl) && !/^mark-eleven:/i.test(targetUrl)) { targetUrl = 'https://' + targetUrl; } const result = await chassis.navigateTo(targetUrl, autoDismiss);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/shield/dismiss') {
        const result = await chassis.dismissConsent();
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/click') {
        const body = await readBody();
        const selector = body.selector || body.element || body.target || body.css;
        const x = body.x !== undefined ? Number(body.x) : undefined;
        const y = body.y !== undefined ? Number(body.y) : undefined;
        const coords = x !== undefined && !isNaN(x) && y !== undefined && !isNaN(y) ? { x, y } : undefined;
        if (!selector && !coords) {
          sendJson({ success: false, error: 'Must provide either "selector" or coordinates (x, y)' }, 400);
          return;
        }
        const result = await chassis.clickElement(selector, coords);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/type') {
        const body = await readBody();
        const selector = body.selector || body.element || body.target;
        const text = body.text ?? body.value ?? body.content ?? body.input ?? '';
        const result = await chassis.typeText(String(text), selector);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/form/fill') {
        const body = await readBody();
        const result = await chassis.fillForm(body.fields || {}, body.submitSelector);
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
        const includeMarks = url.searchParams.get('include_marks') !== 'false' && url.searchParams.get('marks') !== 'false';
        const includeOffscreen = ['1', 'true'].includes((url.searchParams.get('include_offscreen') || '').toLowerCase());
        const construct = await chassis.harvestMarkdown({ includeMarks, includeOffscreen });
        sendJson({ success: true, construct });
        return;
      }

      if (req.method === 'GET' && pathname === '/screenshot') {
        const maxWidthParam = url.searchParams.get('max_width');
        const maxWidth = maxWidthParam !== null ? Number(maxWidthParam) : 768;
        const format = (url.searchParams.get('format') || 'jpeg').toLowerCase() as 'jpeg' | 'png';
        const qualityParam = url.searchParams.get('quality');
        const quality = qualityParam !== null ? Number(qualityParam) : 70;

        const screenshot = await chassis.takeScreenshot({ maxWidth, format, quality });
        sendJson({ success: true, screenshot });
        return;
      }

      if (req.method === 'POST' && pathname === '/screenshots/cleanup') {
        const body = await readBody();
        const maxFiles = body.maxFiles !== undefined ? Number(body.maxFiles) : 50;
        const maxAgeMs = body.maxAgeDays !== undefined ? Number(body.maxAgeDays) * 86400000 : 7 * 86400000;
        const cleanupResult = chassis.cleanupScreenshots(maxFiles, maxAgeMs);
        sendJson({ success: true, ...cleanupResult });
        return;
      }

      if (req.method === 'POST' && pathname === '/evaluate') {
        const body = await readBody();
        const script = body.script || body.code || body.js || body.expression || body.javascript || '';
        const result = await chassis.evaluateJavaScript(script);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'GET' && (pathname === '/console-logs' || pathname === '/console/logs')) {
        const logs = chassis.getTargetConsoleLogs(50);
        sendJson({ success: true, logs });
        return;
      }

      if (req.method === 'GET' && pathname === '/fingerprint') {
        const profile = chassis.getFingerprintProfile();
        sendJson({ success: true, profile });
        return;
      }

      if (req.method === 'GET' && pathname === '/downloads') {
        const downloads = chassis.getDownloads();
        sendJson({ success: true, downloads });
        return;
      }

      if (req.method === 'POST' && pathname === '/downloads/read') {
        const body = await readBody();
        const document = await chassis.readDownloadedDocument(body.filename || body.id);
        sendJson({ success: true, document });
        return;
      }

      if (req.method === 'POST' && pathname === '/session/save') {
        const body = await readBody();
        const result = await chassis.saveSession(body.name);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/session/restore') {
        const body = await readBody();
        const result = await chassis.restoreSession(body.name);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'GET' && pathname === '/session/list') {
        const sessions = chassis.listSessions();
        sendJson({ success: true, sessions });
        return;
      }

      if (req.method === 'POST' && pathname === '/session/delete') {
        const body = await readBody();
        const deleted = chassis.deleteSession(body.name);
        sendJson({ success: true, deleted });
        return;
      }

      if ((req.method === 'GET' || req.method === 'POST') && pathname === '/network/traffic') {
        const filter = req.method === 'POST' ? await readBody() : undefined;
        let traffic = chassis.getNetworkTraffic(filter);
        if (filter) {
          const since = filter.since === 'last_action' ? lastActionAt : Number(filter.since);
          if (since && !isNaN(since)) {
            traffic = traffic.filter((r) => (r.requestTime || 0) >= since);
          }
        }
        sendJson({ success: true, count: traffic.length, traffic });
        return;
      }

      if (req.method === 'POST' && pathname === '/network/payload') {
        const body = await readBody();
        const payload = chassis.getApiPayload(body.requestId);
        sendJson({ success: true, payload });
        return;
      }

      if (req.method === 'POST' && pathname === '/network/clear') {
        chassis.clearNetworkTraffic();
        sendJson({ success: true, message: 'Network traffic buffer cleared' });
        return;
      }

      if (req.method === 'POST' && pathname === '/json/query') {
        const body = await readBody();
        const source = body.source || body.from || 'network_payload';
        const sourceId = body.sourceId || body.source_id || body.requestId || body.request_id || body.streamId || body.stream_id || body.filename || body.file;
        const result = chassis.queryJsonData({
          source,
          sourceId,
          jsonString: body.jsonString || body.json_string || body.json,
          path: body.path || body.query,
          view: body.view || body.mode,
          limit: body.limit !== undefined ? Number(body.limit) : undefined,
          maxStringLength: body.maxStringLength || body.max_string_length,
          filterPredicate: body.filterPredicate || body.filter_predicate || body.filter,
        });
        sendJson({ success: true, ...result });
        return;
      }

      if (req.method === 'POST' && pathname === '/snapshot/rendered') {
        const body = await readBody();
        const result = await chassis.snapshotRenderedPage({
          format: body.format || body.mode,
          waitUntilIdleMs: body.waitUntilIdleMs ?? body.wait_until_idle_ms,
          pierceShadowDom: body.pierceShadowDom ?? body.pierce_shadow_dom,
          saveToDisk: body.saveToDisk ?? body.save_to_disk,
          forceRerender: body.forceRerender ?? body.force_rerender,
        });
        sendJson({ success: true, ...result });
        return;
      }

      if (req.method === 'POST' && pathname === '/prerender/links') {
        const body = await readBody();
        const result = await chassis.prerenderLinks({
          urls: body.urls,
          selector: body.selector,
          maxPages: body.maxPages ?? body.max_pages,
          harvestToCortex: body.harvestToCortex ?? body.harvest_to_cortex,
          waitUntilIdleMs: body.waitUntilIdleMs ?? body.wait_until_idle_ms,
        });
        sendJson({ success: true, ...result });
        return;
      }

      if ((req.method === 'GET' || req.method === 'POST') && pathname === '/streams/list') {
        const body = req.method === 'POST' ? await readBody() : {};
        const streams = chassis.getRealtimeStreams(body);
        sendJson({ success: true, streams });
        return;
      }

      if (req.method === 'POST' && pathname === '/streams/messages') {
        const body = await readBody();
        const messages = chassis.getStreamMessages(body);
        sendJson({ success: true, messages });
        return;
      }

      if (req.method === 'POST' && pathname === '/streams/clear') {
        const body = await readBody();
        chassis.clearStreamMessages(body.streamId);
        sendJson({ success: true, message: 'Stream message buffer cleared' });
        return;
      }

      if (req.method === 'POST' && pathname === '/capture/clear') {
        const body = await readBody();
        const scope = body?.scope || 'all';
        const cleared: string[] = [];
        if (scope === 'all' || scope === 'network') {
          chassis.clearNetworkTraffic();
          cleared.push('network');
        }
        if (scope === 'all' || scope === 'streams') {
          chassis.clearStreamMessages();
          cleared.push('streams');
        }
        sendJson({
          success: true,
          cleared,
          message: cleared.length > 0 ? `Cleared capture buffer(s): ${cleared.join(', ')}` : 'Unknown scope; nothing cleared',
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/marks/screenshot') {
        const flag = (name: string) => ['1', 'true'].includes((url.searchParams.get(name) || '').toLowerCase());
        const result = await chassis.takeAnnotatedScreenshot({ economy: flag('economy'), textOnly: flag('text_only'), includeOffscreen: flag('include_offscreen') });
        sendJson({ success: true, ...result });
        return;
      }

      if (req.method === 'POST' && pathname === '/marks/click') {
        const body = await readBody();
        const rawId = body.markId ?? body.mark_id ?? body.mark ?? body.id ?? body.badge ?? body.index ?? body.num ?? body.number;
        if (rawId === undefined || isNaN(Number(rawId))) {
          sendJson({ success: false, error: 'Must provide valid numeric markId (or mark_id)' }, 400);
          return;
        }
        const result = await chassis.clickMark(Number(rawId));
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/marks/type') {
        const body = await readBody();
        const rawId = body.markId ?? body.mark_id ?? body.mark ?? body.id ?? body.badge ?? body.index ?? body.num ?? body.number;
        const text = body.text ?? body.value ?? body.content ?? body.input ?? '';
        if (rawId === undefined || isNaN(Number(rawId))) {
          sendJson({ success: false, error: 'Must provide valid numeric markId (or mark_id)' }, 400);
          return;
        }
        const result = await chassis.typeMark(Number(rawId), String(text), {
          clearFirst: body?.clear_first === true || body?.clearFirst === true,
        });
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'GET' && pathname === '/marks/list') {
        const marks = chassis.getActiveMarks();
        sendJson({ success: true, marks });
        return;
      }

      if (req.method === 'POST' && pathname === '/scripts/save') {
        const body = await readBody();
        const script = await chassis.saveScript(body);
        sendJson({ success: true, script });
        return;
      }

      if ((req.method === 'GET' || req.method === 'POST') && pathname === '/scripts/recall') {
        const body = req.method === 'POST' ? await readBody() : {};
        const scripts = await chassis.recallScripts(body.query, {
          domain: body.domain,
          tag: body.tag,
          limit: body.limit,
        });
        sendJson({ success: true, scripts });
        return;
      }

      if (req.method === 'POST' && pathname === '/scripts/run') {
        const body = await readBody();
        const execution = await chassis.runScript(body.name, body.args);
        sendJson({ success: true, execution });
        return;
      }

      if (req.method === 'GET' && pathname === '/scripts/list') {
        const query = url.searchParams.get('q') || undefined;
        const tag = url.searchParams.get('tag') || undefined;
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 100;
        // Tree search when a query is present, otherwise enumerate (recallScripts lists all when query is undefined).
        const scripts = await chassis.recallScripts(query, { tag, limit });
        sendJson({ success: true, scripts });
        return;
      }

      if (req.method === 'POST' && pathname === '/scripts/delete') {
        const body = await readBody();
        const deleted = await chassis.deleteScript(body.name);
        sendJson({ success: true, deleted });
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

      if (req.method === 'GET' && (pathname === '/tabs' || pathname === '/tabs/list')) {
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
        let rawId = body.tabId ?? body.tab_id ?? body.tab ?? body.id;
        if (typeof rawId === 'number') rawId = `tab_${rawId}`;
        else if (rawId && !String(rawId).startsWith('tab_') && !isNaN(Number(rawId))) rawId = `tab_${rawId}`;
        chassis.switchTab(rawId);
        sendJson({ success: true, message: `Switched to tab ${rawId}` });
        return;
      }

      if (req.method === 'POST' && pathname === '/tabs/close') {
        const body = await readBody();
        let rawId = body.tabId ?? body.tab_id ?? body.tab ?? body.id;
        if (typeof rawId === 'number') rawId = `tab_${rawId}`;
        else if (rawId && !String(rawId).startsWith('tab_') && !isNaN(Number(rawId))) rawId = `tab_${rawId}`;
        chassis.closeTab(rawId);
        sendJson({ success: true, message: `Closed tab ${rawId || 'active'}` });
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

      // Human-In-The-Loop & Notification Endpoints
      if (req.method === 'POST' && pathname === '/hil/request') {
        const body = await readBody();
        const result = await chassis.requestHumanIntervention(body.reason, {
          url: body.url,
          timeoutSeconds: body.timeoutSeconds,
          bringToFront: body.bringToFront,
        });
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/hil/resolve') {
        const body = await readBody();
        const resolved = chassis.resolveHumanIntervention(body.id, body.notes);
        sendJson({ success: true, resolved });
        return;
      }

      if (req.method === 'POST' && pathname === '/hil/cancel') {
        const body = await readBody();
        const cancelled = chassis.cancelHumanIntervention(body.id);
        sendJson({ success: true, cancelled });
        return;
      }

      if (req.method === 'GET' && pathname === '/hil/active') {
        const active = chassis.getActiveHumanIntervention();
        sendJson({ success: true, active });
        return;
      }

      if (req.method === 'GET' && pathname === '/hil/history') {
        const history = chassis.getHumanInterventionHistory();
        sendJson({ success: true, history });
        return;
      }

      if (req.method === 'POST' && pathname === '/notify') {
        const body = await readBody();
        const sent = chassis.sendNotification(body.title, body.message, body.urgency, body.sound);
        sendJson({ success: true, sent });
        return;
      }

      // Window & System Tray Management Endpoints
      if (req.method === 'POST' && pathname === '/window/visibility') {
        const body = await readBody();
        chassis.setWindowVisibility(!!body.visible);
        if (body.visible && body.focus !== false) chassis.focusWindow();
        sendJson({ success: true, visible: chassis.isWindowVisible(), focused: chassis.isWindowFocused() });
        return;
      }

      if (req.method === 'GET' && pathname === '/window/visibility') {
        sendJson({ success: true, visible: chassis.isWindowVisible(), focused: chassis.isWindowFocused() });
        return;
      }

      if (req.method === 'POST' && pathname === '/window/focus') {
        const focused = chassis.focusWindow();
        sendJson({ success: true, focused });
        return;
      }

      if (req.method === 'POST' && pathname === '/window/tray') {
        const body = await readBody();
        if (typeof body.closeToTray === 'boolean') {
          chassis.setCloseToTray(body.closeToTray);
        }
        sendJson({ success: true, closeToTray: chassis.isCloseToTray() });
        return;
      }

      if (req.method === 'GET' && pathname === '/window/tray') {
        sendJson({ success: true, closeToTray: chassis.isCloseToTray() });
        return;
      }

      // Chaos Kinematics & Mouse Movement Endpoints
      if (req.method === 'POST' && pathname === '/chaos/trajectory') {
        const body = await readBody();
        const target = body.target || { x: 500, y: 500 };
        const steps = chassis.testChaosTrajectory(target, body.options);
        const totalDurationMs = steps.reduce((sum, s) => sum + s.delayMs, 0);
        const peakVelocity = Math.max(...steps.map((s) => s.velocity));
        const correctiveSteps = steps.filter((s) => s.isCorrective).length;
        sendJson({
          success: true,
          steps,
          metrics: {
            stepCount: steps.length,
            totalDurationMs,
            peakVelocity,
            hasOvershoot: correctiveSteps > 0,
            correctiveSteps,
          },
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/mouse/move') {
        const body = await readBody();
        const target = body.target || { x: 500, y: 500 };
        await chassis.moveMouse(target, body.options);
        sendJson({ success: true, target });
        return;
      }

      // ---- Primitives layer (observe / act / wait / extract / collect / find) ----

      if (req.method === 'GET' && pathname === '/page-version') {
        sendJson({ success: true, revision: chassis.getRevision(), capabilities: chassis.getCapabilities() });
        return;
      }

      if ((req.method === 'POST' || req.method === 'GET') && pathname === '/page-state') {
        const state = await chassis.getPrimitives().pageState();
        sendJson({ success: true, state });
        return;
      }

      if (req.method === 'POST' && pathname === '/diff') {
        const body = await readBody();
        const since = body?.since !== undefined && body.since !== null && body.since !== '' ? Number(body.since) : undefined;
        const diff = await chassis.getPrimitives().diff(isNaN(Number(since)) ? undefined : since);
        sendJson({ success: true, ...diff });
        return;
      }

      if (req.method === 'POST' && pathname === '/wait-for') {
        const body = await readBody();
        const conditions = Array.isArray(body?.conditions) ? body.conditions : body?.condition ? [body.condition] : [];
        if (!conditions.length) {
          sendJson({ success: false, error: 'Provide { conditions: [{type:"selector", selector:"..."}] }', code: 'BAD_REQUEST' }, 400);
          return;
        }
        const result = await chassis.getPrimitives().waitFor(conditions, {
          timeoutMs: body.timeout_ms ?? body.timeoutMs,
          pollMs: body.poll_ms ?? body.pollMs,
          require: body.require === 'all' ? 'all' : 'any',
        });
        sendJson({ success: true, ...result });
        return;
      }

      if (req.method === 'POST' && pathname === '/expect') {
        const body = await readBody();
        const conditions = Array.isArray(body?.conditions) ? body.conditions : body?.condition ? [body.condition] : [];
        const result = await chassis.getPrimitives().expect(conditions);
        sendJson({ success: true, ...result });
        return;
      }

      // ---- optional decision model (off unless configured) -------------------
      if (req.method === 'GET' && pathname === '/decisions') {
        const decisions = chassis.getDecisionEvents();
        sendJson({ success: true, count: decisions.length, decisions });
        return;
      }
      if (pathname === '/decide' && (req.method === 'GET' || req.method === 'POST')) {
        if (req.method === 'GET') {
          sendJson({ success: true, ...decisionStatus() });
          return;
        }
        const body = await readBody();
        // A guarded call (the decision loop) inspects the real page text as well as the caller's
        // state: a wall announces itself in copy ("Verify your birthday to continue") that the
        // component table alone does not carry. Raw `decide` stays a pure pipe.
        const useGuard = body?.guard !== undefined || body?.eliminate !== undefined;
        let state = body?.state;
        if (body?.include_page_text === true || (body?.include_page_text !== false && useGuard)) {
          try {
            const page = await chassis.getPrimitives().observe({ as: 'text', budget: 4000 });
            const pageText = typeof page?.text === 'string' ? page.text.slice(0, 4000) : '';
            if (pageText.trim()) {
              state = `${typeof state === 'string' ? state : JSON.stringify(state ?? '')}\n\nVisible page text:\n${pageText}`;
            }
          } catch {
            // No page context available (e.g. called before a tab exists) — carry on with the state.
          }
        }
        const result = useGuard
          ? await decideGuarded({
              state,
              questions: body?.questions || {},
              model: body?.model,
              guard: body?.guard || {},
              maxAttempts: body?.eliminate?.max_attempts ?? body?.eliminate?.maxAttempts ?? (body?.eliminate ? 3 : 1),
            })
          : await runDecision({
              state,
              questions: body?.questions || {},
              model: body?.model,
            });
        if (result.ok) {
          sendJson({ success: true, ...result });
        } else {
          const code = result.error?.code;
          const status = code === 'TIMEOUT' ? 504 : code === 'HUMAN_REQUIRED' ? 409 : code === 'UPSTREAM_ERROR' ? 502 : 400;
          sendJson(
            {
              success: false,
              // `error` stays a string: the MCP client turns it into "HTTP 400: <error>".
              error: result.error?.message || 'decision call failed',
              code,
              gate: (result as any).gate,
              hint: result.error?.hint,
              fallback: (result as any).fallback,
              reasons: (result as any).reasons,
              upstreamStatus: result.error?.status,
              protocol: result.protocol,
              latencyMs: result.latencyMs,
            },
            status
          );
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/observe') {
        const body = await readBody();
        const obs = await chassis.getPrimitives().observe({
          as: body?.as || body?.format || 'markdown',
          region: body?.region,
          budget: body?.budget !== undefined ? Number(body.budget) : undefined,
          cursor: body?.cursor,
          includeOffscreen: body?.include_offscreen === true || body?.includeOffscreen === true,
          limit: body?.limit !== undefined ? Number(body.limit) : undefined,
        });
        sendJson({ success: true, ...obs });
        return;
      }

      if (req.method === 'POST' && pathname === '/extract') {
        const body = await readBody();
        const kind = body?.kind || 'list';
        const data = await chassis.getPrimitives().extract({
          kind,
          ref: body?.ref !== undefined && body.ref !== null ? Number(body.ref) : undefined,
          selector: body?.selector,
          type: body?.type,
          limit: body?.limit !== undefined ? Number(body.limit) : undefined,
        });
        sendJson({ success: true, ...data });
        return;
      }

      if (req.method === 'POST' && pathname === '/llm/surface') {
        const body = await readBody();
        const report = await chassis.probeLlmSurface(body?.url);
        sendJson({ success: true, ...report });
        return;
      }

      if (req.method === 'POST' && pathname === '/llm/fetch') {
        const body = await readBody();
        const result = await chassis.fetchLlmSurface({ url: body?.url, as: body?.as });
        sendJson({ success: true, ...result });
        return;
      }

      if (req.method === 'POST' && pathname === '/search/web') {
        const body = await readBody();
        const outcome = await chassis.searchWeb(body?.query, {
          engine: body?.engine,
          engines: Array.isArray(body?.engines) ? body.engines : undefined,
          urlTemplate: body?.url_template ?? body?.urlTemplate,
          max: body?.max_results ?? body?.max,
        });
        sendJson({ success: true, ...outcome });
        return;
      }

      if (req.method === 'POST' && pathname === '/crawl/deep') {
        const body = await readBody();
        const outcome = await chassis.deepCrawl({
          startUrl: body?.url || body?.start_url || body?.startUrl,
          maxDepth: body?.max_depth ?? body?.maxDepth,
          maxPages: body?.max_pages ?? body?.maxPages,
          matchPatterns: body?.match_patterns ?? body?.matchPatterns,
          sameOrigin: body?.same_origin ?? body?.sameOrigin,
          preferLlm: body?.prefer_llm ?? body?.preferLlm,
          harvestToCortex: body?.harvest_to_cortex ?? body?.harvestToCortex,
          selector: body?.selector,
          delayMs: body?.delay_ms ?? body?.delayMs,
        });
        sendJson({ success: true, ...outcome });
        return;
      }

      if (req.method === 'POST' && pathname === '/research/topic') {
        const body = await readBody();
        const outcome = await chassis.researchTopic({
          query: body?.query,
          maxSources: body?.max_sources ?? body?.maxSources,
          engine: body?.engine,
          engines: Array.isArray(body?.engines) ? body.engines : undefined,
          urlTemplate: body?.url_template ?? body?.urlTemplate,
          excerptChars: body?.excerpt_chars ?? body?.excerptChars,
          harvestToCortex: body?.harvest_to_cortex ?? body?.harvestToCortex,
          preferLlm: body?.prefer_llm ?? body?.preferLlm,
        });
        sendJson({ success: true, ...outcome });
        return;
      }

      if (req.method === 'POST' && pathname === '/collect') {
        const body = await readBody();
        const data = await chassis.getPrimitives().collectAll({
          ref: body?.ref !== undefined && body.ref !== null ? Number(body.ref) : undefined,
          selector: body?.selector,
          scroll: body?.scroll === 'window' ? 'window' : 'container',
          step: body?.step !== undefined ? Number(body.step) : undefined,
          delayMs: body?.delay_ms ?? body?.delayMs,
          maxScrolls: body?.max_scrolls ?? body?.maxScrolls,
          max: body?.max !== undefined ? Number(body.max) : undefined,
        });
        sendJson({ success: true, ...data });
        return;
      }

      if (req.method === 'POST' && pathname === '/find') {
        const body = await readBody();
        const data = await chassis.getPrimitives().find({
          role: body?.role,
          name: body?.name,
          contains: body?.contains ?? body?.text,
          regex: body?.regex,
          flags: body?.flags,
          tag: body?.tag,
          selector: body?.selector,
          limit: body?.limit !== undefined ? Number(body.limit) : undefined,
          includeOffscreen: body?.include_offscreen === undefined ? true : body.include_offscreen === true,
        });
        sendJson({ success: true, ...data });
        return;
      }

      if (req.method === 'POST' && pathname === '/act') {
        const body = await readBody();
        const rawId = body?.mark_id ?? body?.markId ?? body?.mark ?? body?.id ?? body?.badge;
        const selector = body?.selector || body?.element || body?.target || body?.css;
        const x = body?.x !== undefined ? Number(body.x) : undefined;
        const y = body?.y !== undefined ? Number(body.y) : undefined;
        const result = await chassis.getPrimitives().act({
          markId: rawId !== undefined && rawId !== null ? Number(rawId) : undefined,
          selector,
          x,
          y,
          action: body?.action || 'click',
          text: body?.text !== undefined ? String(body.text) : undefined,
          secret: body?.secret === true,
          clearFirst: body?.clear_first === true || body?.clearFirst === true,
          await: Array.isArray(body?.await) ? body.await : Array.isArray(body?.await_conditions) ? body.await_conditions : undefined,
          timeoutMs: body?.timeout_ms ?? body?.timeoutMs,
          dryRun: body?.dry_run === true || body?.dryRun === true,
          includeOffscreen: body?.include_offscreen === undefined ? true : body.include_offscreen === true,
        });
        sendJson({ success: true, ...result });
        return;
      }

      if (req.method === 'POST' && pathname === '/network/har') {
        const body = await readBody();
        const har = chassis.getPrimitives().exportHar({
          limit: body?.limit !== undefined ? Number(body.limit) : undefined,
          pattern: body?.pattern,
        });
        if (body?.save) {
          const dir = path.resolve(process.cwd(), 'data', 'har');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `har_${Date.now()}.har`);
          fs.writeFileSync(file, JSON.stringify(har, null, 2));
          sendJson({ success: true, entries: har.log.entries.length, filePath: file });
          return;
        }
        sendJson({ success: true, entries: har.log.entries.length, har });
        return;
      }

      // Named contexts (cookie/storage profiles) — thin aliases over the session vault.
      if (req.method === 'POST' && pathname === '/context/save') {
        const body = await readBody();
        const result = await chassis.saveSession(body?.name);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'POST' && pathname === '/context/open') {
        const body = await readBody();
        if (!body?.name) {
          sendJson({ success: false, error: 'Provide { name }', code: 'BAD_REQUEST' }, 400);
          return;
        }
        const result = await chassis.restoreSession(body.name);
        sendJson({ success: true, result });
        return;
      }

      if (req.method === 'GET' && pathname === '/context/list') {
        sendJson({ success: true, contexts: chassis.listSessions() });
        return;
      }

      if (req.method === 'POST' && pathname === '/context/delete') {
        const body = await readBody();
        const deleted = chassis.deleteSession(body?.name);
        sendJson({ success: true, deleted });
        return;
      }

      sendJson({ error: 'Endpoint not found' }, 404);
    } catch (err: any) {
      const code = err?.code || 'INTERNAL';
      const client = ['BAD_REQUEST', 'STALE_REF', 'NO_TARGET', 'NOT_SUPPORTED', 'TIMEOUT', 'NO_LLM_SURFACE', 'FETCH_BLOCKED'].includes(code);
      sendJson({ success: false, error: err?.message || String(err), code }, client ? 400 : 500);
    }
  });

  server.on('error', (err: any) => {
    logBridge(`HTTP Bridge server error on port ${port}: ${err?.message || err}`, true);
    chassis.addLog('warn', `HTTP Bridge server error on port ${port}: ${err?.message || err}`);
  });

  server.listen(port, '127.0.0.1', () => {
    logBridge(`\n======================================================\n 🚀 KUANG GRADE MARK ELEVEN // CYBERDECK HTTP BRIDGE\n Active at: http://127.0.0.1:${port}\n Live directive logging enabled.\n======================================================\n`);
    chassis.addLog('info', `Autonomous Bridge active at http://127.0.0.1:${port}`);
  });

  return server;
}
