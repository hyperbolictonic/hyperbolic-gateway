#!/usr/bin/env node
/**
 * Focus-independence regression test.
 *
 * The Cyberdeck drives a *visible* desktop browser, but the human (or their terminal/IDE)
 * will constantly steal the OS foreground. Electron's legacy transport,
 * `webContents.sendInputEvent`, is silently dropped by the OS whenever another window owns
 * focus — the classic "the click landed but nothing typed" failure. The simulator therefore
 * prefers CDP `Input.dispatch*`, which reaches the renderer regardless of OS focus.
 *
 * This test asserts that (a) input is being delivered over CDP and (b) typing, clicking and
 * wheel-scrolling all still land while the Cyberdeck window is not the OS foreground window.
 *
 * Requires the Cyberdeck Electron app running (bridge on 127.0.0.1:4111). Prints SKIP and
 * exits 0 when the bridge is down.
 *
 * Usage: node scripts/test-input-focus-independence.mjs
 */
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const BRIDGE = process.env.KUANG_BRIDGE_URL || 'http://127.0.0.1:4111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIXTURE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Focus Fixture</title></head>
<body>
  <main id="main">
    <h1>Focus independence fixture</h1>
    <div id="cards">
      <div class="card"><a href="/select/0" aria-label="Alpha Airways option 1: total £412"><span class="price">£412</span></a></div>
      <div class="card"><a href="/select/1" aria-label="Beta Air option 2: total £419"><span class="price">£419</span></a></div>
      <div class="card"><a href="/select/2" aria-label="Gamma Jets option 3: total £425"><span class="price">£425</span></a></div>
    </div>
    <label>Search <input id="q" aria-label="Search query" /></label>
    <p id="echo"></p>
    <button id="clickme">Click me</button>
    <div id="feed" style="height:200px;overflow:auto;border:1px solid #ccc"></div>
  </main>
  <script>
    document.getElementById('q').addEventListener('input', function (e) {
      document.getElementById('echo').textContent = 'Echo: ' + e.target.value;
    });
    document.getElementById('clickme').addEventListener('click', function () {
      setTimeout(function () {
        var d = document.createElement('p');
        d.id = 'clicked';
        d.textContent = 'Clicked!';
        document.body.appendChild(d);
      }, 250);
    });
    var feed = document.getElementById('feed');
    var n = 0;
    function item(i) {
      var d = document.createElement('div');
      d.className = 'feed-item';
      d.style.padding = '20px 8px';
      d.innerHTML = '<a href="/feed/' + i + '">Feed item ' + i + ': price £' + (100 + i) + '</a>';
      return d;
    }
    for (; n < 5; n++) feed.appendChild(item(n));
    var loading = false;
    feed.addEventListener('scroll', function () {
      if (loading) return;
      if (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 5) {
        loading = true;
        setTimeout(function () {
          for (var k = 0; k < 5 && n < 25; k++, n++) feed.appendChild(item(n));
          loading = false;
        }, 150);
      }
    });
  </script>
</body>
</html>`;

async function bridge(path, method = 'GET', body = null) {
  const res = await fetch(`${BRIDGE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const err = new Error(`${method} ${path} -> HTTP ${res.status}: ${json.error || json.message || 'unknown error'}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

const health = () => bridge('/health');
const inputTransport = async () => (await health())?.input?.transport ?? null;

/**
 * Returns { process, title } for the OS foreground window, or null on non-Windows /
 * when the probe is unavailable.
 */
function foregroundWindow() {
  if (process.platform !== 'win32') return null;
  const ps = `
Add-Type @"
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class FgProbe {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string Get() {
    IntPtr h = GetForegroundWindow();
    StringBuilder sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    uint pid; GetWindowThreadProcessId(h, out pid);
    string name = "?";
    try { name = Process.GetProcessById((int)pid).ProcessName; } catch {}
    return name + "|" + sb.ToString();
  }
}
"@
[FgProbe]::Get()`;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const [proc, ...rest] = out.split('|');
    return { process: proc, title: rest.join('|') };
  } catch {
    return null;
  }
}

async function main() {
  try {
    await bridge('/health');
  } catch (err) {
    console.log(`SKIP: Cyberdeck bridge not reachable at ${BRIDGE} (${err.message}). Start the app and re-run.`);
    process.exit(0);
  }

  // Make the window visible but explicitly do NOT take the foreground.
  await bridge('/window/visibility', 'POST', { visible: true, focus: false });
  await sleep(300);

  // Best effort: hand the OS foreground to a different application.
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Process notepad'], { stdio: 'ignore' });
    await sleep(1500);
  } catch {}

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(FIXTURE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/fixture.html`;

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let tabId = null;
  try {
    const fg = foregroundWindow();
    const appFocused = (await health())?.window?.focused;
    console.log(`INFO  OS foreground: ${fg ? `${fg.process} — "${fg.title}"` : 'unavailable'}; electron reports focused=${appFocused}`);

    const created = await bridge('/tabs/new', 'POST', { url });
    tabId = created?.tab?.id || created?.tab?.tabId || null;
    // NOTE: no /window/visibility call here — that would hand focus back to the app and
    // defeat the point of the test.
    for (let i = 0; i < 40; i++) {
      const h = await health();
      if ((h?.info?.url || '').includes(`127.0.0.1:${port}`)) break;
      await sleep(250);
    }
    for (let i = 0; i < 40; i++) {
      const r = await bridge('/evaluate', 'POST', { script: '({ w: window.innerWidth, h: window.innerHeight })' });
      if ((r?.result?.w || 0) > 0 && (r?.result?.h || 0) > 0) break;
      await sleep(250);
    }
    await bridge('/wait-for', 'POST', { conditions: [{ type: 'count', selector: '.card', min: 3 }], timeout_ms: 4000 });

    // --- typing -------------------------------------------------------------
    const typeResult = await (async () => {
      const found = await bridge('/find', 'POST', { name: 'Search query', limit: 25, include_offscreen: true });
      const markId = found?.marks?.[0]?.id;
      if (!markId) return { ok: false, detail: 'input not found' };
      const act = await bridge('/act', 'POST', {
        mark_id: markId,
        action: 'type',
        text: 'focusfree',
        await: [{ type: 'text', text: 'Echo: focusfree' }],
        timeout_ms: 15000,
      }).catch((e) => ({ ...(e.body || {}), error: e.message }));
      const ok = act?.awaited?.ok === true;
      let detail = `transport=${await inputTransport()}`;
      if (!ok) {
        const d = await bridge('/evaluate', 'POST', {
          script: `(() => { const el = document.querySelector('[data-mark-id="${markId}"]'); return { value: el && el.value, active: document.activeElement && (document.activeElement.id || document.activeElement.tagName), echo: (document.getElementById('echo')||{}).textContent }; })()`,
        });
        detail += ` | diag=${JSON.stringify(d?.result)}`;
      }
      return { ok, detail };
    })();
    check('type: keystrokes land (CDP, focus-independent)', typeResult.ok, typeResult.detail);

    // --- clicking -----------------------------------------------------------
    const clickResult = await (async () => {
      const found = await bridge('/find', 'POST', { name: 'Click me', limit: 25, include_offscreen: true });
      const markId = found?.marks?.[0]?.id;
      if (!markId) return { ok: false, detail: 'button not found' };
      const act = await bridge('/act', 'POST', {
        mark_id: markId,
        action: 'click',
        await: [{ type: 'selector', selector: '#clicked' }],
        timeout_ms: 15000,
      }).catch((e) => ({ ...(e.body || {}), error: e.message }));
      return { ok: act?.awaited?.ok === true, detail: `transport=${await inputTransport()}` };
    })();
    check('click: mouse press/release land (CDP, focus-independent)', clickResult.ok, clickResult.detail);

    // --- scrolling ----------------------------------------------------------
    const collected = await bridge('/collect', 'POST', { selector: '#feed', step: 600, delay_ms: 200, max_scrolls: 25, max: 40 });
    check(
      'scroll: wheel events land (CDP, focus-independent)',
      (collected?.count ?? 0) >= 25,
      `${collected?.count} rows, transport=${await inputTransport()}`
    );

    // --- transport proof ----------------------------------------------------
    const transport = await inputTransport();
    check('input is delivered over the focus-independent CDP transport', transport === 'cdp', `transport=${transport}`);

    const fgAfter = foregroundWindow();
    if (fgAfter && fgAfter.process.toLowerCase() !== 'electron') {
      console.log(`INFO  another application owned the foreground throughout (${fgAfter.process})`);
    } else {
      console.log('NOTE  the Cyberdeck window may have held the foreground; the CDP transport assertion above is the durable guarantee');
    }
  } catch (err) {
    check('focus-independence run', false, err.message);
  } finally {
    try { if (tabId) await bridge('/tabs/close', 'POST', { tabId }); } catch {}
    try { execFileSync('powershell', ['-NoProfile', '-Command', 'Stop-Process -Name notepad -Force -ErrorAction SilentlyContinue'], { stdio: 'ignore' }); } catch {}
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
