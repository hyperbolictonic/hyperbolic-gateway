# Handoff — Kuang ↔ Orcha MCP stdio reliability ("kuang goes away")

**Audience:** the agent working in `<user>\Documents\<workspace>\agent_\agent-orcha`
**Author:** Kuang-side session (read-only inspection of the Orcha tree; no files there were modified)
**Date:** 2026-10-19

---

## 0. TL;DR

1. Orcha's reported failure chain is **real and reproduced** for the headline link: an **undrained stderr pipe stalls the Kuang child**. I proved it live (call ~157 of 600 hard-stalls with stderr unread; 601/601 succeed when drained). Details in §2.
2. **However, the Orcha working tree already contains the fix** (stderr is drained, reconnect/backoff, last-known-good tools). The line numbers in the diagnosis no longer match the code on disk. So step 0 for the Orcha agent is: **confirm what is actually deployed/built**, not re-fix what's already there. See §4.
3. Two of the observed Kuang-side symptoms in the logs are **not** explained by the stderr theory and need separate attention: an idle child being **recycled on a ~61-minute timer**, and **4–10 concurrent `mcp-server.cjs` children** competing for one browser session. See §3.
4. **Applied (Kuang side).** Kuang no longer depends on the client draining stderr: per-call logs
   go to the file only, stderr carries a short boot banner, writes are backpressure-aware and
   hard-capped, a wedged Cyberdeck can no longer hang a tool forever, and stdin EOF shuts the
   child down cleanly. Rebuilt as `bin/mcp-server.cjs`; all 14 MCP regression checks pass. See §6.

---

## 1. Topology (who spawns what)

Two independent spawn paths point at the same Kuang bundle:

- **OpenCode plugin** — `.agents\plugins\mark-eleven\mcp_config.json` runs
  `node -e "…require('<repo>/bin/mcp-server.cjs')"`.
- **Orcha** — `scripts/kuang-mcp-stdio.cjs` (in the Orcha repo) resolves the same
  `bin/mcp-server.cjs` via `require(targetPath)`.

Both produce a child whose **stdout is JSON-RPC**, whose **stderr is diagnostic logging**, and
which talks to the Electron Cyberdeck over **HTTP `127.0.0.1:4111`**.

Implication: **stdout is the lifeline.** Anything that stalls the child's event loop, or fails to
drain its stderr, makes the whole `kuang` tool namespace disappear even though the browser app is
perfectly healthy.

---

## 2. Verified: undrained stderr stalls the child (reproduced)

### Method
Spawn `bin/mcp-server.cjs` with `stdio: ['pipe','pipe','pipe']`, run `initialize`, then drive
`bridge_health` calls sequentially. Two variants, identical except for stderr handling:

- **A** — stderr piped and **never read** (the reported Orcha bug).
- **B** — stderr piped and **drained** (control).

### Results (live, against the running Cyberdeck on `:4111`)

| Variant | Requested | Responses | Timeouts | First stall at | stderr drained | Elapsed |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| **A** (unread stderr) | 600 | **158** | 4 | **call 157** | 0 B | 37.4 s |
| **B** (drained stderr) | 600 | **601** | **0** | — | **311,599 B** | 20.3 s |

Variant A stops answering JSON-RPC entirely and never recovers; Variant B is monotonic and clean.

### Why it fills so fast
Kuang logs **3–4 stderr lines per tool call** (`logMcp` → `console.error`, plus the extra
`tools/call` line at `bin/mcp-server.cjs:38247`). Measured cost:

- **≈ 519 bytes of stderr per tool call** (311,599 B ÷ 600 calls).
- Cross-check from the on-disk log: 387 tool calls produced 189,614 bytes ≈ 490 B/call.

A 64 KB OS pipe buffer therefore fills after **~125 tool calls** — i.e. a normal browsing turn.
The child then blocks/queues on stderr and the JSON-RPC channel goes dead while the HTTP bridge
stays up.

### Corroboration in Kuang's own logs
`data/logs/mcp-server.log` shows `[Tool Dispatch]` → `[HTTP Forward]` → `[Tool Success]` lines per
call right up until activity stops, with **no** shutdown/EPIPE/exception line — consistent with a
child that is still alive but no longer being serviced.

---

## 3. Two log symptoms the stderr theory does *not* explain

Please don't attribute these to the same bug — they look like separate mechanisms.

### 3a. Idle child recycled on a ~61-minute timer
After `2026-10-18T17:43:42`, the server is re-initialised with an almost exact cadence:

```
18:43:42 → 19:44:47 → 20:45:58 → 21:47:05   (+ 05:28:41 → 06:29:48)
deltas:      61.1 min    61.2 min    61.1 min        61.1 min
```

Across those ~13 hours the log contains **only 6 boot pairs (12 lines) and zero tool dispatches**:

```
6 x "Initializing Mark Eleven MCP Server over stdio..."
6 x "Connected to stdio transport. Listening for JSON-RPC messages."
```

No shutdown line, no error. So the child was **idle, then killed and respawned by its parent** — a
supervisor/recycle behaviour, not a mid-session stall. Worth checking in Orcha: is there a TTL /
idle reaper / per-turn respawn, and does closing stdin cause Node to exit silently (code 0, no log)?

### 3b. Concurrent children competing for one browser
Live process scan during this investigation:

```
4 x  node "<repo>/bin/mcp-server.cjs"                 (ppid 33332)
3 x  node scripts/kuang-mcp-stdio.cjs                  (ppid 29360)
1 x  node -e "…require('<repo>/bin/mcp-server.cjs')"   (ppid 19804)
```

Every one of these opens the **same** single browser session on `:4111`. Nothing reaps them.
More clients = more stderr, more races on the one chassis. The `globalThis` pool in
`McpClientManager.ts` mitigates per-module duplication inside one process, but not across the
multiple server processes above (e.g. `next dev` + OpenCode CLI + HMR).

---

## 4. What the Orcha tree already does (verify, don't re-implement)

Read on 2026-10-19; the diagnosis cites older line numbers. Current code:

| Concern | Where | Status |
| :--- | :--- | :--- |
| Drain child stderr | `McpClientManager.ts:237-263` (`attachTransport`) | **Present** — `stderrStream.on('data', …)` with ring buffer |
| stderr mode | `McpClientManager.ts:514-519` | `pipe` by default (now drained) unless `ORCHA_MCP_STDERR=inherit` |
| Reconnect on dead transport | `attachTransport` `onclose`/`onerror` + `ensureAlive()` + `invoke()` dispose→reconnect | **Present** |
| Liveness ping | `ensureAlive()` (idle > 30 s → `client.ping({timeout:5s})`) | **Present** |
| Never cache an empty/failed tool list as good | `listToolsForServer()` + `pool.lastGoodTools` | **Present** — failures return last-good or throw |
| Distinct short TTL for failures | `ToolRegistryService.ts:63` `MCP_FAILURE_TTL_MS = 30000` | **Present** |
| `hasKuang` gating of generic web tools | `ToolRegistryService.ts:475`, `:510`, `:521-524` | **Present** — with `mcpRecentlyDegraded` handling |

### Verification checklist for the Orcha agent
1. **Is the running server actually this build?** `tsconfig.tsbuildinfo`/`next dev` can serve stale
   code. Restart dev and re-run a session; confirm no unbounded stderr growth.
2. **Confirm the drain is reached before the child can write.** It runs in `attachTransport`, which
   is called before `client.connect(transport)` — good; add a regression test if none exists.
3. **Negative-caching test:** fail `listTools` (kill the child) and assert the toolset keeps
   `kuang` (last-good) and does *not* re-enable `web_search`/`web_fetch` for the turn.
4. **Long-call interaction:** `CALL_TOOL_TIMEOUT_MS = 180 s` and `request_human_intervention` can
   legitimately block for up to 180 s. Make sure the idle-ping / stall detector cannot misread a
   long HIL call as "server gone" and recycle the child mid-intervention.
5. **Reaper:** account for §3a (~61-min respawn) and §3b (child leakage). Something must own the
   lifecycle so children are 1-per-server and reaped on shutdown/HMR.

---

## 5. Repro harness (drop-in for the Orcha agent)

Save as `stderr-repro.cjs` and run `node stderr-repro.cjs A 600` vs `node stderr-repro.cjs B 600`.
With the Cyberdeck running on `:4111`, A should stall near call ~150; B should complete.

```js
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');

const REPO   = 'C:\\Users\\mike\\Documents\\<workspace>\\kuang_grade_mark_eleven';
const SERVER = path.join(REPO, 'bin', 'mcp-server.cjs');
const VARIANT = process.argv[2] || 'A';   // 'A' = stderr unread, 'B' = drained
const N = Number(process.argv[3] || 400);

const child = spawn(process.execPath, [SERVER], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let stderrBytes = 0;
if (VARIANT === 'B') child.stderr.on('data', (c) => { stderrBytes += c.length; });
else child.stderr.pause();                 // A: never read

let nextId = 1, responses = 0, buf = '';
const pending = new Map();
child.stdout.on('data', (c) => {
  buf += c.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== undefined) { responses++; const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m); } }
  }
});
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
const call = (name, args, ms) => new Promise((resolve) => {
  const id = nextId++;
  const t = setTimeout(() => { pending.delete(id); resolve({ timeout: true }); }, ms);
  pending.set(id, (m) => { clearTimeout(t); resolve(m); });
  send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
});

(async () => {
  send({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'repro', version: '0' } } });
  await new Promise((r) => setTimeout(r, 1500));
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  let timeouts = 0, firstTimeoutAt = -1;
  for (let i = 0; i < N; i++) {
    const res = await call('bridge_health', {}, 8000);
    if (res.timeout) { timeouts++; if (firstTimeoutAt < 0) firstTimeoutAt = i; if (timeouts > 3) break; }
  }
  console.log(JSON.stringify({ variant: VARIANT, requested: N, responses, timeouts, firstTimeoutAt, stderrBytesRead: stderrBytes }, null, 2));
  child.kill(); process.exit(0);
})();
```

---

## 6. Kuang-side hardening (APPLIED)

Orcha's contract is correct: a well-behaved MCP server must not depend on the client draining
stderr. Kuang no longer makes stderr a load-bearing pipe. Implemented in
`src/mcp/bridge-server.ts` and rebuilt into `bin/mcp-server.cjs`:

1. **Per-call logs go to the file only.** `logMcp()` writes `data/logs/mcp-server.log` through a
   bounded, asynchronous queue (no `appendFileSync` in the hot path); stderr gets a short boot
   banner by default. The verbose `tools/call` dump was also moved off `console.error`.
2. **Backpressure-aware, hard-capped stderr.** If a write returns `false`, stderr goes quiet until
   `drain`; lines are dropped rather than queued, and total stderr is capped at 16 KiB.
3. **Env switches:** `KUANG_MCP_LOG=0` (no file log), `KUANG_MCP_STDERR=0` (no stderr),
   `KUANG_MCP_STDERR=verbose` (per-call stderr, debugging only).
4. **Bridge timeout.** Every `:4111` round-trip now has a `KUANG_BRIDGE_TIMEOUT_MS` ceiling
   (default 300 000 ms — above any legitimate HIL/navigation wait), so a wedged Cyberdeck returns a
   clear error instead of hanging the tool forever.
5. **Explicit lifecycle.** `stdin` `end`/`close` triggers a logged, clean `exit(0)` so the child
   cannot linger as an orphan competing for the single browser session. Pending log lines are
   flushed synchronously on shutdown. EPIPE / `unhandledRejection` / `uncaughtException` guards
   and the `clampText` 60 K ceiling are unchanged.

### Verification (same machine, live Cyberdeck)

| Test | Before | After |
| :--- | :--- | :--- |
| 600 calls, stderr **never read** | 158 responses, 4 timeouts, stall @157 | **601 responses, 0 timeouts** |
| per-call stderr (25 calls) | ~13,000 B | **0 B** |
| boot banner on stderr | 1 stream, every call | **199 B, 2 lines** |
| `stdin.end()` | (unmanaged) | **exit code 0 + shutdown log line** |
| `npm run test:mcp:primitives` | — | **ALL CHECKS PASSED (14)** |

Remaining (recommended, not done here — belongs to Orcha): the ~61-min idle recycle (§3a) and
child reaping / single-flight across processes (§3b).

---

## 7. Evidence index

- Stall repro: Variant A `responses=158, timeouts=4, firstTimeoutAt=157, stderrBytesRead=0`;
  Variant B `responses=601, timeouts=0, stderrBytesRead=311599`.
- Kuang stderr sources: `bin/mcp-server.cjs:37779` (`logMcp`), `:38247` (tools/call + args).
- Kuang resilience guards: `src/mcp/bridge-server.ts:25-50`, `:55-59`.
- Respawn cadence + idle windows: `data/logs/mcp-server.log` (inits listed in §3a).
- Live child inventory: `Get-CimInstance Win32_Process` scan in §3b.
- HTTP bridge health during the same window (app never went down): `data/logs/http-bridge.log`.
