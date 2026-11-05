---
name: hb-browser
description: Operate the Hypagon Gateway browser MCP with a small set of grouped tools and proven navigation, inspection, interaction and debugging recipes.
---

# Hypagon Browser

Use this skill when an MCP client has the `hb-browser` server available.

Install:

```bash
hermes skills install https://raw.githubusercontent.com/hyperbolictonic/hypagon/main/skills/hb-browser/SKILL.md
npx skills add hyperbolictonic/hypagon --skill hb-browser
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
- `collaborate` — highlight/ask/read/reply/resolve human page threads
- `browser_workspace` — tabs, downloads, contexts, recordings and scripts
- `media` — preview, transcript, download, jobs, cancel, list
- `shadow_iframes` — frames and closed-shadow focus
- `research` — read, search, LLM surface/fetch, crawl, topic research, prerender
- `memory` — recall, history and bookmarks
- `jev_index`, `read_section`, `search_page` — optional page compaction (only present when JEV is on)
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
Use `observe({as:"markdown"})` for the readable page body; when `jev_index` is
available, use it instead (see *Read a large page*).

### Read a large page (JEV)

When `jev_index` is in the tool list, prefer it over a full-page `observe`:

```json
{"name":"jev_index","arguments":{}}
```

The index lists sections with ids, token weights and one-line digests. Fetch only
what the task needs:

```json
{"name":"read_section","arguments":{"section_id":"sec_2","include_children":true}}
{"name":"search_page","arguments":{"query":"refund policy"}}
```

In **enforce** mode an unscoped `observe({as:"markdown"|"text"})` returns
`code: "JEV_REQUIRED"` (HTTP 409). Do not retry it: read the index, scope with
`region`, page with `budget`/`cursor`, or pass `full: true` only when the whole
page is genuinely required (bypasses are logged). Pages under 1,500 tokens are
served normally.

### Inspect the current page

If the tool list includes `jev_index`, read the index first (see above). For a
small page, or to look at the rendered state:

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

### Ask a human about an element

```json
{"name":"collaborate","arguments":{"action":"ask","target":{"selector":"#checkout","text":"Checkout button"},"text":"Should this stay disabled until the address is valid?","choices":["yes","no"]}}
```

Read the reply:

```json
{"name":"collaborate","arguments":{"action":"read","id":"collab_..."}}
```

### Preview and download media

Preview without downloading. This returns the title, duration, a transcript excerpt, and the
poster image, so you can decide whether the video is worth downloading:

```json
{"name":"media","arguments":{"action":"preview","url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}}
```

Read the full captions, paged. The transcript is indexed into Cortex, so `memory` → `recall` can
answer from it later (pass `index:false` to skip indexing):

```json
{"name":"media","arguments":{"action":"transcript","url":"https://www.youtube.com/watch?v=jNQXAC9IVRw","max_chars":8000}}
```

Queue a download and poll it. `kind` is `video` or `audio`; `quality` is `best`, `1080`, `720`,
`480` or `worst`:

```json
{"name":"media","arguments":{"action":"download","url":"https://www.youtube.com/watch?v=jNQXAC9IVRw","kind":"audio","quality":"best"}}
{"name":"media","arguments":{"action":"jobs"}}
```

Cancel a job, or list finished files:

```json
{"name":"media","arguments":{"action":"cancel","id":"mj_..."}}
{"name":"media","arguments":{"action":"list"}}
```

If a job or preview returns `LOGIN_REQUIRED`, stop and tell the human. They can enable
**Settings → Media → "Use browser session"** and ask you to retry; you cannot enable it yourself.

### Recipes

Save a repeatable path:

```json
{"name":"navigate","arguments":{"action":"recipe","recipe_action":"save","name":"pricing","url":"https://example.com","steps":[{"action":"click","target":"Pricing"}]}}
```

Replay:

```json
{"name":"navigate","arguments":{"action":"recipe","recipe_action":"replay","id":"..."}}
```
