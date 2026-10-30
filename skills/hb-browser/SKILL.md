---
name: hb-browser
description: Operate the Hyperbolic Gateway browser MCP with a small set of grouped tools and proven navigation, inspection, interaction and debugging recipes.
---

# Hyperbolic Browser

Use this skill when an MCP client has the `hb-browser` server available.

Install:

```bash
hermes skills install https://raw.githubusercontent.com/hyperbolictonic/hyperbolic-gateway/main/skills/hb-browser/SKILL.md
npx skills add hyperbolictonic/hyperbolic-gateway --skill hb-browser
```

The app must be running. The MCP server talks to the local bridge at
`http://127.0.0.1:4111`.

## Tool surface

Start with the grouped tools, not the old flat names:

- `navigate` — open, back, forward, reload, consent, scroll, recipe
- `observe` — markdown, text, AX, Set-of-Marks, components
- `find` — semantic target search returning mark ids
- `act` — click, focus, hover, type, press, scroll, fill
- `wait_for` — declarative readiness gate
- `extract` — list, table, tables, app_data, schema_org, collect
- `capture` — screenshot or rendered snapshot
- `evaluate_javascript` — deliberate page JS
- `devtools` — state, diff, console, network, streams, HAR, JSON query, fingerprint, health
- `human_in_loop` — HIL, passive takeover, notifications, window and tray
- `browser_workspace` — tabs, downloads, contexts, recordings and scripts
- `shadow_iframes` — frames and closed-shadow focus
- `research` — read, search, LLM surface/fetch, crawl, topic research, prerender
- `memory` — recall, history and bookmarks
- `help` — categorized cheatsheet

Old flat names are hidden from `tools/list` but remain callable through
`tools/call` for compatibility.

## Recipes

### Research a page

```json
{"name":"research","arguments":{"action":"search","query":"site:example.com pricing"}}
```

Then open the chosen result:

```json
{"name":"navigate","arguments":{"action":"open","url":"https://example.com/pricing"}}
```

Read the result:

```json
{"name":"extract","arguments":{"kind":"table"}}
```

Use `extract({kind:"collect"})` when the page is a lazy or virtualized list.
Use `observe({as:"markdown"})` for the readable page body.

### Inspect the current page

```json
{"name":"observe","arguments":{"as":"markdown","budget":12000}}
```

Then extract the part you need:

```json
{"name":"extract","arguments":{"kind":"list","selector":"main"}}
```

### Interact with an element

Find the target first:

```json
{"name":"find","arguments":{"role":"button","name":"Sign in"}}
```

Act on the returned mark id:

```json
{"name":"act","arguments":{"mark_id":7,"action":"click"}}
```

Verify with:

```json
{"name":"observe","arguments":{"as":"components"}}
```

For fields that ignore synthetic typing, `act` returns
`error.code: "TYPE_NO_EFFECT"`. Stop retrying and consider
`human_in_loop({action:"request"})`.

### Fill a form

```json
{"name":"act","arguments":{"action":"fill","fields":{"#email":"me@example.com","#password":"..."},"submit_selector":"button[type=submit]"}}
```

Do not put real secrets in a skill, prompt or log. Use a human hand-off when the
credential must stay private.

### Debug a page

```json
{"name":"devtools","arguments":{"action":"console"}}
{"name":"devtools","arguments":{"action":"traffic","method":"GET"}}
{"name":"devtools","arguments":{"action":"har","save":true}}
```

`devtools` is read-only. Use `evaluate_javascript` only deliberately.

### Wait for a state

```json
{"name":"wait_for","arguments":{"conditions":[{"selector":".results","visible":true}],"timeout_ms":10000}}
```

### Human hand-off

```json
{"name":"human_in_loop","arguments":{"action":"request","reason":"Please solve the CAPTCHA"}}
```

Check passive takeover before blaming the server:

```json
{"name":"human_in_loop","arguments":{"action":"activity"}}
```

### Recipes

Save a repeatable path:

```json
{"name":"navigate","arguments":{"action":"recipe","recipe_action":"save","name":"pricing","url":"https://example.com","steps":[{"action":"click","target":"Pricing"}]}}
```

Replay:

```json
{"name":"navigate","arguments":{"action":"recipe","recipe_action":"replay","id":"..."}}
```
