---
type: Tutorial
title: First browser session
description: A safe first loop through bridge_health, navigate_to, observe, find, act, wait_for, and extract.
tags: [getting-started, tutorial, browser, primitives]
status: stable
---

# First browser session

This is the shortest useful loop. It deliberately avoids screenshots and
JavaScript evaluation: read the page as text, act on an addressable control,
wait for a condition, and verify the result.

Start the desktop app and connect `hb-browser` first.

## 1. Check the bridge

Call `bridge_health` with no arguments:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"bridge_health","arguments":{}}}
```

Confirm that the app version is current and the input transport is `cdp`.
`cdp` means input is sent as real browser input events and is not tied to the
OS foreground window.

## 2. Navigate

```json
{"name":"navigate_to","arguments":{"url":"https://news.ycombinator.com"}}
```

`navigate_to` returns after the page is ready enough to inspect and dismisses
common cookie/GDPR overlays by default.

## 3. Read the page

```json
{"name":"observe","arguments":{"as":"markdown","budget":12000}}
```

The response contains Markdown with inline `[#id]` marks and a paging cursor.
If the page is longer than the budget, pass `next_cursor` back as `cursor`.

Use `as:"text"` for raw visible text, `as:"ax"` for the accessibility tree, or
`as:"som"` for a numbered Set-of-Marks table. `as:"components"` returns
decision-ready rows with the actions each component accepts.

## 4. Find a control

Prefer a semantic search over a hand-written selector:

```json
{"name":"find","arguments":{"role":"link","name":"new","limit":5}}
```

`find` returns rows carrying mark ids. A mark id is re-resolved against the
live DOM, so it survives layout shifts better than a CSS selector.

## 5. Act and wait in one call

```json
{
  "name": "act",
  "arguments": {
    "mark_id": 12,
    "action": "click",
    "await_conditions": [
      {"type":"stable","target":"nodes","holdMs":400}
    ]
  }
}
```

`act` supports `click`, `focus`, `hover`, `type`, and `press`. For typing,
pass `text` and optionally `secret:true` so the value is redacted from logs.
Use `clear_first:true` when replacing a pre-filled value.

Do not use `sleep`. If the next step depends on readiness, use `wait_for` or
`act.await_conditions`.

## 6. Read structured data

```json
{"name":"extract","arguments":{"kind":"list","selector":".titleline"}}
```

Use `kind:"table"` for one table, `kind:"tables"` for all tables,
`kind:"app_data"` for embedded JSON/state, and `kind:"schema_org"` for JSON-LD.

## 7. Handle a human-required page

If you hit a login, CAPTCHA, 2FA prompt, payment confirmation, or another
blocker that should not be automated, call `request_human_intervention` with
a short reason. The app alerts the operator and can bring the browser forward.
The tool returns after the human resolves or cancels the request.

## Minimal loop

```text
bridge_health
  -> navigate_to
  -> observe(as:"markdown")
  -> find(role/name)
  -> act(mark_id, await_conditions)
  -> extract / observe
```

Read [Browser MCP API](../api/browser-mcp.md) for the full tool map and
[Error catalogue](../formats/errors.md) for recovery codes.
