# JEV (Just-Enough-View) page compaction

JEV keeps large pages out of the agent's context window. Instead of returning a
full page Markdown dump, the agent gets a compact **surface index** (Tier 1) and
fetches only the sections it needs from an in-memory **depth store** (Tier 2).

## Availability

Optional, not experimental:

- Settings → **DECISION MODEL → JEV PAGE COMPACTION**, persisted to `jev.json`
  (IPC-only writes), default **off**.
- The toggle is disabled until a decision model is configured, and the runtime
  gate is `enabled && decisionStatus().configured`. While off, every JEV route
  returns a clear "JEV is disabled" error.

## Tools

| Tool | Route | Purpose |
| --- | --- | --- |
| `jev_index` | `GET /jev/index` | Build/refresh the surface index for the active page. |
| `read_section` | `POST /jev/read` | Fetch one section body (`include_children` for nested subsections). |
| `search_page` | `POST /jev/search` | Keyword/regex scan over all folded section text, with snippets. |

## Preferred reading path

JEV is not just available when it is active — the tool surface is arranged so it
is the default way to read a page:

- `tools/list` leads with `jev_index`, `read_section`, `search_page` (after
  `drive`/`decide` when a decision model is configured).
- `jev_index` is described as the **preferred reading path**; `observe` and
  `decide` carry a "JEV ACTIVE" note that points reading at the index and keeps
  `observe(as:"markdown")` for acting on `[#ID]` marks or short pages.
- The OKF guide (`mark-eleven://skills/guide`) swaps its "read a page" recipe to
  `jev_index → read_section` while JEV is active.
- `navigate` responses end with a one-line JEV nudge, so the reminder arrives at
  the moment an agent is about to read.
- `GET /tools/config` reports `jev.available`, which is how the MCP server
  learns the gate at startup (`enabled && decision model configured`).

Activation is read when the MCP server starts, so after flipping the toggle in
Settings, reconnect the MCP client (or restart the app) to reorder `tools/list`.
The bridge-side behaviour — the gate, the navigate nudge, and the route errors —
is live either way.

## Implementation

- `src/main/jev/engine.ts`: splits harvested markdown at heading boundaries
  (nested IDs `sec_1.1`), estimates tokens (`chars / 4`), derives a one-sentence
  digest per section, and renders the `JEV_SURFACE_INDEX` wire format.
- The depth store is scoped to the page URL and purged on navigate/back/forward/
  reload, tab switch/close, and explicit purge.
- Auto-fold: expanded sections are tracked; past ~6,000 tokens,
  `read_section` responses include fold hints naming the oldest expanded IDs.
- Tests: `npm run test:jev`.
