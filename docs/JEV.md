# JEV (Just-Enough-View) page compaction

JEV keeps large pages out of the agent's context window. Instead of returning a
full page Markdown dump, the agent gets a compact **surface index** (Tier 1) and
fetches only the sections it needs from an in-memory **depth store** (Tier 2).

## Availability

Optional, not experimental:

- Settings → **DECISION MODEL → JEV PAGE COMPACTION**, persisted to `jev.json`
  (IPC-only writes), default **off**.
- Two controls: a master **on/off** switch (`power`) and a **read mode**
  (`prefer` | `enforce`). The mode is remembered while the switch is off.
- Both are disabled until a decision model is configured; the runtime gate is
  `power && decisionStatus().configured`. A legacy `{ enabled: true }` file
  migrates to `power: true, mode: "prefer"` — never silently to enforce.

## Modes

| Mode | Behaviour |
| --- | --- |
| `prefer` | Tools lead with the index and descriptions steer reads to it. Full-page reads still work. |
| `enforce` | **Unscoped** page reads are refused with `JEV_REQUIRED`; the agent must use `jev_index` → `read_section`. |

`enforce` applies to `observe(as:"markdown")`, `observe(as:"text")`, and
`GET /markdown` (the `get_page_markdown` / `harvest_markdown` aliases).

Allowed while enforcing:

- `region` scoped reads (mark id or CSS selector);
- bounded reads: `budget > 0` or a `cursor`;
- `full: true` — the logged bypass;
- pages at or below **1,500 tokens** (the index would not save anything);
- every non-content projection: `som`, `components`, `ax`, `list`, `table`,
  `app_data`, plus `find` / `extract` / `act` / screenshots.

`budget: 0` means "the whole construct", so it is treated as unbounded and
refused.

### Refusal contract

```json
{
  "success": false,
  "code": "JEV_REQUIRED",
  "error": "Unscoped page reads are disabled while JEV enforce is on. …",
  "page": { "url": "…", "tokens": 14823, "sections": 8 },
  "next": [
    { "tool": "jev_index" },
    { "tool": "read_section", "arguments": { "section_id": "sec_1" } }
  ],
  "override": { "parameter": "full", "value": true, "note": "bypasses the funnel and is logged" }
}
```

HTTP status is 409.

### Safety valves

- **Fail-open**: harvest errors, zero sections, or an index that is not smaller
  than the page serve the read instead of refusing it.
- **Loop breaker**: after two refusals for the same URL in 60 seconds, the next
  read is served with a note and counted as a bypass. A naive agent cannot burn
  its turn budget on the wall.
- Telemetry: `GET /jev/stats` reports `blocked`, `bypassed`, `loopBreaker`,
  `blockedTokens` and the active breaker entries.

## Tools

| Tool | Route | Purpose |
| --- | --- | --- |
| `jev_index` | `GET /jev/index` | Build/refresh the surface index for the active page. |
| `read_section` | `POST /jev/read` | Fetch one section body (`include_children` for nested subsections). |
| `search_page` | `POST /jev/search` | Keyword/regex scan over all folded section text, with snippets. |
| — | `GET /jev/stats` | Funnel counters and JEV status. |

## Preferred reading path

JEV is not just available when it is active — the tool surface is arranged so it
is the default way to read a page:

- `tools/list` leads with `jev_index`, `read_section`, `search_page` (after
  `drive`/`decide` when a decision model is configured).
- `jev_index` advertises itself as the preferred (or, in enforce, **mandatory**)
  reading path; `observe` and `decide` carry a matching note, including the
  `region` / `budget` / `full:true` rules in enforce.
- The OKF guide (`mark-eleven://skills/guide`) swaps its "read a page" recipe to
  `jev_index → read_section` while JEV is active.
- `navigate` responses end with a one-line JEV nudge, so the reminder arrives at
  the moment an agent is about to read.
- `GET /tools/config` reports `jev: { available, mode }`, which is how the MCP
  server learns the gate and mode at startup.

Activation and mode are read when the MCP server starts, so after flipping the
switch in Settings, reconnect the MCP client (or restart the app) to reorder
`tools/list` and adopt the enforce text. The bridge side — the gate, the funnel,
the navigate nudge, and the route errors — is live either way.

## Implementation

- `src/main/jev/engine.ts`: splits harvested markdown at heading boundaries
  (nested IDs `sec_1.1`), estimates tokens (`chars / 4`), derives a one-sentence
  digest per section, and renders the `JEV_SURFACE_INDEX` wire format.
- `src/main/jev/policy.ts`: pure `decideFunnel` policy plus the `FunnelBreaker`.
- `src/main/primitives/primitives.ts`: the single choke point — markdown and
  text projections consult the host guard before leaving the process.
- The depth store is scoped to the page URL and purged on navigate/back/forward/
  reload, tab switch/close, and explicit purge.
- Auto-fold: expanded sections are tracked; past ~6,000 tokens,
  `read_section` responses include fold hints naming the oldest expanded IDs.
- Tests: `npm run test:jev` and `npm run test:jev:funnel`.

## Limits

This is token discipline, not a security boundary. `read_url`,
`capture(rendered)`, screenshots and `evaluate_javascript` can still pull bytes
without going through the funnel.
