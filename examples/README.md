# Examples

Small, runnable examples that drive the Cyberdeck local bridge
(`http://127.0.0.1:4111`) from plain Node — useful for scripts, CI, or a REPL
when an MCP client is not in the loop. The app must be running.

These deliberately stay on the **endorsed humanlike path**: navigate, read the
Set-of-Marks table, and actuate with `click_mark`. They never inject or read raw
page JavaScript, which is what keeps the browser looking human (`isTrusted`
events, Bézier cursor telemetry).

| File | Shows |
| --- | --- |
| `bridge-await-results.mjs` | Poll for a page to settle using raw bridge calls, scan long/virtualized lists with `include_offscreen`, and click a mark. |

```bash
node examples/bridge-await-results.mjs "https://example.com" --offscreen
node examples/bridge-await-results.mjs "https://example.com" --click "Show more"
```

> For real work prefer the **orthogonal primitives** (`wait_for`, `observe`, `act`,
> `collect_all`, …) over hand-rolled polling — see
> [`kuang_docs/partitions/primitives_and_workflows.md`](../kuang_docs/partitions/primitives_and_workflows.md).

## Bridge endpoint → MCP tool

| Endpoint | MCP tool |
| --- | --- |
| `POST /navigate` | `navigate_to` |
| `GET /marks/screenshot?text_only=1` | `list_marks` |
| `GET /marks/screenshot?economy=1` | `take_economy_screenshot` |
| `GET /marks/screenshot` | `take_annotated_screenshot` |
| `POST /marks/click` | `click_mark` |
| `POST /marks/type` | `type_mark` |
| `GET /markdown` | `get_page_markdown` |
| `POST /wait-for` | `wait_for` |
| `POST /observe` | `observe` |
| `POST /collect` | `collect_all` |
| `POST /act` | `act` |
| `GET /health` | `bridge_health` |

## See also

- `scripts/test-harvest-regression.mjs` (`npm run test:harvest`) — an offline
  regression test for the markdown harvester and off-screen marks.
- `mark-eleven://skills/guide` (MCP resource) — the full operational guide.
