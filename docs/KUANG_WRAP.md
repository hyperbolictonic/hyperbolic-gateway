# Kuang Wrap — design notes

**Status:** active design, branch `feat/kuang-wrap`. Slice 0 (the pure recipe
library) is implemented. Everything below marked *planned* is not shipped yet.

Kuang Wrap is a second MCP server that lets an agent turn a REST endpoint into
a saved, typed tool: a wrapper for the request, a recipe for the response, and
a secret reference for the credential. It is the other half of the browser:
HTML for humans, JSON for agents.

## Shape

```
Agent ──stdio──▶ kuang-wrap ──HTTP──▶ localhost bridge ──▶ WrapService (main)
                    │                                      ├─ wrapper store
                    │                                      ├─ secret store (safeStorage)
                    └─ tools/list + list_changed            ├─ HTTP executor
                                                           └─ recipe → Markdown
```

| Layer | Owns | Never owns |
| --- | --- | --- |
| `packages/recipe` | Pure JSON → Markdown translation | Network, files, secrets, Electron |
| `src/main/wrap` | Wrappers, secrets, execution, audit | MCP protocol |
| `src/mcp/wrap-server.ts` | MCP tool surface, dynamic tool list | Credentials, parsing rules |
| Bridge | Local routing + auth token | Long-lived state |

The MCP process is stateless. It asks the app for the manifest and forwards
calls. **Secrets never enter the MCP process.** That is the whole security
model in one sentence.

## Non-goals for v1

- OAuth2 flows and token refresh (static bearer/header/basic first).
- A standalone daemon that runs without the Kuang app.
- GraphQL, gRPC, WebSocket subscriptions.
- Binary downloads (the existing download manager owns that).
- Arbitrary JavaScript in recipes or request templates.
- Cloud sync of wrappers or secrets.

## Agent-facing surface

The wrapper is a **projection** of the API, not a mirror of it. The agent
should never assemble a URL, a header set, or a body JSON unless the wrapper
author explicitly exposes a raw body. The wrapper author — human or agent —
does that work once; every call is a short, typed argument list.

1. **Semantic inputs, flat arguments.** `customer_id`, `items`, `note`; not
   `{ data: { attributes: { … } } }`. The MCP `inputSchema` carries the types,
   descriptions, enums, defaults, and examples.
2. **One action, one tool.** `wrap_orders_create` beats a generic
   `wrap_request(url, method, body)` for discoverability and token cost.
3. **Deterministic mapping.** `request.body` is a template. The same arguments
   always produce the same request. There is no model-authored JSON.
4. **Preview before mutation.** A dry run returns the exact URL, headers
   (redacted), and body without sending it.
5. **Dual output.** Markdown for reading, `records` for querying. The agent
   asks for `format: "json"` instead of parsing the Markdown.
6. **Token budget is part of the contract.** Only declared fields, caps on
   items and characters, and a compact `wrap_list`.
7. **Errors are actionable.** Status, code, field, retryable, and a short hint;
   never a full HTML error page.

### POST, the simple path

A create wrapper:

```json
{
  "schemaVersion": 1,
  "id": "orders.create",
  "name": "Create order",
  "request": {
    "method": "POST",
    "url": "https://api.example.com/v1/orders",
    "body": {
      "customer": "{{customer_id}}",
      "line_items": "{{items}}",
      "note": "{{note}}"
    }
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "customer_id": { "type": "string", "description": "Customer ID" },
      "items": {
        "type": "array",
        "description": "Line items",
        "items": {
          "type": "object",
          "properties": {
            "sku": { "type": "string" },
            "qty": { "type": "integer", "minimum": 1 }
          },
          "required": ["sku", "qty"]
        }
      },
      "note": { "type": "string", "description": "Optional note" }
    },
    "required": ["customer_id", "items"],
    "additionalProperties": false
  },
  "mutating": true,
  "response": {
    "schemaVersion": 1,
    "select": "$",
    "mode": "document",
    "record": { "id": "id", "status": "status", "total": "total" },
    "fields": {
      "Order": "id",
      "Status": "status",
      "Total": { "path": "total", "format": "number" }
    }
  }
}
```

The agent sees a tool with three arguments and calls it:

```json
wrap_orders_create({
  "customer_id": "cus_123",
  "items": [{ "sku": "A-1", "qty": 2 }],
  "note": "gift"
})
```

The app sends exactly:

```http
POST /v1/orders
Content-Type: application/json
Authorization: Bearer <from secret store>

{"customer":"cus_123","line_items":[{"sku":"A-1","qty":2}],"note":"gift"}
```

The agent never saw the URL, the header, the token, or the body envelope. It
saw a create-order tool with a customer, line items, and an optional note.

### Interpolation rules

| Template | Input | Result |
| --- | --- | --- |
| `"{{items}}"` (whole string) | array/object/number/boolean | inserted with its JSON type |
| `"Order for {{customer_id}}"` (embedded) | string | text interpolation |
| `"{{note}}"` | omitted/`undefined` | key omitted from the body |
| `"{{note}}"` | explicit `null` | `null`, if the schema allows it |
| `"{{q}}"` in `query` | string | URL-encoded |
| `"{{tag}}"` in `query` | array | repeated `tag=a&tag=b` (or `style: "csv"`) |
| `"{{value}}"` in `headers` | string | value only; header names are fixed |

No expressions, no `eval`, no model-generated JSON. If an API truly needs a
free-form body (for example an Elasticsearch query DSL), the wrapper opts in
with `body: "{{body}}"` and an input of `type: "object"`; that is explicit,
visible in the schema, and still previewable.

### The agent loop

```
wrap_list                     # what can I do? one line per wrapper
wrap_<action> { … }           # or wrap_run { id, args }
  └─ mutating? wrap_test { …, dryRun: true } first
result.markdown               # what to read
result.records                # what to filter, store, or return as JSON
```

`wrap_list` returns only `id`, a one-line description, method + host, and the
required argument names. `wrap_get` returns the full schema when the agent
needs it. That keeps discovery cheap.

## Wrapper spec

A wrapper is a small JSON document. `request` is executed; `response` is a
[recipe](../packages/recipe/README.md); `inputSchema` is the MCP input schema.

```json
{
  "schemaVersion": 1,
  "id": "weather.current",
  "name": "Current weather",
  "description": "Current conditions for a city.",
  "request": {
    "method": "GET",
    "url": "https://api.example.com/v1/weather",
    "query": { "q": "{{city}}" },
    "headers": { "Accept": "application/json" },
    "auth": "weather-key",
    "timeoutMs": 15000
  },
  "inputSchema": {
    "type": "object",
    "properties": { "city": { "type": "string" } },
    "required": ["city"]
  },
  "response": {
    "schemaVersion": 1,
    "select": "$.current",
    "mode": "document",
    "record": {
      "city": "location.name",
      "temp_c": "temp_c",
      "updated": "last_updated"
    },
    "fields": {
      "City": "location.name",
      "Temperature": { "path": "temp_c", "format": "number", "suffix": " °C" },
      "Updated": { "path": "last_updated", "format": "date" }
    }
  },
  "exposeAsTool": false,
  "mutating": false
}
```

- `{{name}}` interpolation in `url`, `query`, and `headers` is limited to
  validated input properties. There is no expression language.
- `auth` is a **secret name**, never a value. Wrapper files are safe to read.
- `mutating` defaults to `true` for `POST`/`PUT`/`PATCH`/`DELETE`. Read-only
  wrappers are the default; mutating calls can require human approval.
- `exposeAsTool` is opt-in. Generated tools are capped and namespaced.

## Recipes

The translation layer is `packages/recipe`, a pure ESM package with no
dependencies. It exports `deriveRecipe`, `renderRecipe`, `resolvePath`,
`renderTemplate`, `validateRecipe`, and the format types. The JSON Schema is
[`recipe.schema.json`](../packages/recipe/schema/recipe.schema.json).

It deliberately has no `eval`, no network and no clock. That makes it safe to
run on untrusted API responses, easy to test with Node's built-in runner, and
publishable on its own later.

`renderRecipe` returns `markdown`, `records`, `documents`, and `meta`.
`records` is the queryable projection (`recipe.record` names the keys) with
original JSON types. In `documents` mode each entry is
`{ title, markdown, record }`. There is no Markdown → JSON parser: the
executor can return the records directly with `format: "json"`, which is
lossless and cheaper.

**Packaging decision:** monorepo now, standalone repository/package when the
format has survived a few real APIs unchanged or a second consumer appears.
The package boundary is enforced by imports: nothing in `packages/recipe` may
import Electron or MCP.

## Secrets

| Rule | Why |
| --- | --- |
| Secrets are written only from Settings over IPC | An agent must not be able to create or read a credential |
| `safeStorage` encrypts at rest in main | DPAPI / Keychain / libsecret, no custom crypto |
| Agents see names and allowed hosts, never values | `wrap_secret_list` returns metadata only |
| A secret is bound to `allowedHosts` | A wrapper cannot attach it to an attacker's host |
| Binding a secret to a host is human-only | Prevents agent-authored exfiltration |
| No auth on cross-origin redirects | Prevents a 302 from leaking a token |
| No credentials in query strings | Query strings end up in logs and proxies |
| Audit log records method, host, status, bytes | Debugging without storing headers or bodies |

**Prerequisite:** the bridge is currently unauthenticated. Before any secret
route ships, add a per-run bearer token for `/wrap/*`, generated in main and
passed to the MCP server through the environment. Without it, any local
process could spend the user's tokens.

On Linux, `safeStorage.getSelectedStorageBackend()` can return `basic_text`
when no keyring is available. Detect it and warn; do not pretend the secret is
protected.

## Execution policy

- Schemes: `https` by default; `http` only for an explicitly allowed host.
- Block `file:`, `ftp:`, `data:`, and anything that is not HTTP(S).
- Resolve the host and refuse loopback, private, link-local, unique-local, and
  cloud metadata addresses (`169.254.169.254`, `fd00::/8`, …) unless a human
  has added that host to an allowlist. Local development APIs are a legitimate
  use case, but they are opt-in.
- Redirects: maximum 5; re-check the scheme and address on every hop; drop
  `Authorization` when the origin changes.
- Response cap: 5 MB; timeout 15 s; `Accept: application/json` by default.
- Retries: only for 429/502/503/504, at most twice, respecting `Retry-After`;
  never retry a mutating call unless the wrapper opts in.
- Concurrency: a small per-host queue (default 2) so a loop cannot hammer an
  API.
- Redact `Authorization`, `Cookie`, `Set-Cookie`, and query values from logs,
  errors, and audit entries.

## MCP surface

Meta-tools (always present):

| Tool | Purpose |
| --- | --- |
| `wrap_list` | List wrappers: id, name, method, host, secret names, last result |
| `wrap_get` | Read one wrapper definition (no secret values) |
| `wrap_create` | Validate and save a wrapper |
| `wrap_update` | Patch and save |
| `wrap_delete` | Remove a wrapper |
| `wrap_run` | Execute by id with arguments; returns Markdown |
| `wrap_test` | Execute without saving, or preview a recipe against a sample |
| `wrap_reload` | Re-read the manifest after an external edit |
| `wrap_secret_list` | Names and allowed hosts only |

Generated tools: one `wrap_<id>` per wrapper **only** when `exposeAsTool` is
true, capped at 40. The wrapper server calls `sendToolListChanged()` after a
create/update/delete so the client sees the new list without a restart. The
SDK in this repo supports it (`McpServer.sendToolListChanged`).

Results are Markdown text for compatibility, plus `structuredContent` with
`{ markdown, documents, meta }` where the client supports it.

## Bridge routes (planned)

All under `/wrap` and all authenticated with the wrap token; secret management
is IPC-only and never exposed here.

| Route | Body | Result |
| --- | --- | --- |
| `GET /wrap/manifest` | — | wrappers, generated tool names, limits |
| `GET /wrap/status` | — | app version, token present, wrapper count |
| `POST /wrap/run` | `{ id, args, page? }` | `{ markdown, documents, meta, request }` |
| `POST /wrap/test` | `{ wrapper?, id?, args?, sample? }` | preview, nothing saved |
| `POST /wrap/wrappers` | `{ action: "create"\|"update"\|"delete", wrapper }` | manifest entry |
| `GET /wrap/audit?limit=50` | — | redacted audit rows |

## Storage

```
<userData>/wrap/
  wrappers/<id>.json      one file per wrapper, atomic write (tmp + rename)
  recipes/<id>.json       reusable response recipes
  secrets.enc             safeStorage ciphertext, main process only
  audit.jsonl             append-only, redacted
```

Every file carries `schemaVersion`. Unknown fields survive a read/write cycle
when possible so a newer version does not destroy data. No credentials ever
appear in `wrappers/` or `recipes/`.

## Packaging

- `bin/wrap-server.cjs`, built by `build:mcp` next to `mcp-server.cjs`.
- `bin/**/*` is already in `asarUnpack`; the userData copy step must copy both
  binaries and refresh them on update.
- The MCP Clients tab gets a second entry with the same bundled-runtime /
  system-Node switch and the same bridge URL, plus `KUANG_BRIDGE_TOKEN`.
- `KUANG_WRAP=0` disables the server; `KUANG_WRAP_LOG=0` silences its file log.
- The recipe library is bundled into main and the wrap server at build time;
  it is not a runtime dependency. It has no dependencies of its own, so until
  it is linked into the pnpm workspace it can be imported by relative path and
  tested directly with Node's runner.

## Slices

| Slice | Scope | Gate |
| --- | --- | --- |
| **S0** ✅ | Pure recipe package, schema, tests, design | 25 tests pass, typecheck clean |
| **S1** | Wrapper store, executor, `/wrap/run`, `wrap_run`/`wrap_test`, public read-only APIs | Live call to a public API returns Markdown; no secrets exist yet |
| **S2** | `safeStorage`, host binding, Settings → Wrappers, wrap bridge token, audit | Exfiltration test: agent-created wrapper cannot attach a secret to a foreign host; unauthenticated `/wrap/run` is 401 |
| **S3** | Derived recipes, save/reuse, documents mode, pagination, Cortex indexing | A paginated API returns all pages up to the cap; documents are searchable |
| **S4** | Generated tools, `sendToolListChanged`, MCP Clients entry, docs | 40-tool cap holds; client sees a new tool without restart |
| **S5** | OAuth2 client credentials, expiry HIL, `lastVerified` | Expired token produces a human-action request, not a silent 401 loop |

## Threat model

| Threat | Control |
| --- | --- |
| Agent creates a wrapper pointing at an attacker host and attaches a secret | Host-bound secrets; human-only binding; no cross-origin auth redirect |
| Local process calls the bridge and spends tokens | Wrap bridge token, generated per run |
| SSRF into localhost or cloud metadata | Scheme + DNS/IP checks; human allowlist for private hosts |
| Credential leaks into logs | Redaction and a test that asserts no header value appears |
| Prompt injection inside an API response | Response is data; it is rendered, never executed |
| Tool-list exhaustion | Meta-tools + opt-in generated tools + cap |
| Schema drift breaks a wrapper | `wrap_test`, `lastVerified`, clear upstream errors |
| Linux has no keyring | Detect `basic_text`; warn and refuse secrets if requested |

## Open questions

1. Should a wrapper be runnable headless (without the Electron app)? Not in v1.
   The separate MCP binary keeps that door open.
2. Secret scope: host-only, or host + wrapper? Start host-only; add an optional
   wrapper scope if a shared host needs separate credentials.
3. Should `POST` require human approval by default? Leaning yes for the first
   call per wrapper per session; read-only remains frictionless.
4. Where do parsed documents go? Return them first; Cortex indexing is opt-in
   per recipe because it costs embeddings and disk.
5. Do we expose generated tools by default? No. Meta-tools are enough until a
   wrapper is stable.

## Decision log

- **2026-10-23** — Recipe engine is a pure package; monorepo first, standalone
  later. No Electron or MCP imports.
- **2026-10-23** — Kuang Wrap is a second **stdio MCP server**, not a second
  HTTP service. It shares the app's bridge and lifecycle.
- **2026-10-23** — No separate port in v1. Isolation comes from a route
  namespace and an auth token, not a second daemon.
- **2026-10-23** — Secrets live in main behind `safeStorage`; the MCP process
  never sees a value.
- **2026-10-23** — Ship the bridge token before the first secret, not after.
