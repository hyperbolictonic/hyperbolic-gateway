---
type: Example
title: Browser session example
description: A complete observe-act-wait-extract session against a real page using hb-browser.
tags: [example, browser, primitives]
status: stable
---

# Browser session example

Goal: open Hacker News, find the newest-story link, and return a small set of
headlines without screenshots or JavaScript evaluation.

## 1. Health

```json
{"name":"bridge_health","arguments":{}}
```

Confirm `status: "ok"` and `input.transport: "cdp"`.

## 2. Navigate

```json
{"name":"navigate_to","arguments":{"url":"https://news.ycombinator.com/newest"}}
```

## 3. Observe

```json
{"name":"observe","arguments":{"as":"markdown","budget":16000}}
```

The result contains Markdown with inline mark ids. If `next_cursor` is present,
call `observe` again with `cursor` to page.

## 4. Find a link

```json
{"name":"find","arguments":{"role":"link","name":"comments","limit":5}}
```

Each row includes a mark id and the accessible name. Use the mark id, not a
brittle CSS path.

## 5. Act and wait

```json
{
  "name": "act",
  "arguments": {
    "mark_id": 17,
    "action": "click",
    "await_conditions": [
      {"type":"stable","target":"nodes","holdMs":500}
    ]
  }
}
```

If the click opens a new tab, call `list_tabs` and `switch_tab` instead of
assuming the active tab changed.

## 6. Extract

```json
{
  "name":"extract",
  "arguments":{"kind":"list","selector":".titleline","limit":20}
}
```

Use `kind:"table"` when the page has a real table. For embedded application
state, use `kind:"app_data"`; for JSON-LD, use `kind:"schema_org"`.

## 7. Verify

```json
{"name":"page_state","arguments":{}}
```

`page_state` returns a revision. After another action, call
`diff { since: <revision> }` to see what changed without re-reading the whole
page.

## Failure paths

- `STALE_REF`: re-run `observe` or `find`.
- `TIMEOUT`: use a narrower `wait_for` condition.
- `NO_TARGET`: check the role/name or selector.
- `HUMAN_IN_PROGRESS`: wait for the operator, then re-observe.
- CAPTCHA/login/2FA: call `request_human_intervention` rather than trying to
  automate the challenge.

## Why not sleep?

A fixed sleep is either too short (the page is not ready) or too long (wasted
time and a stale reference). `wait_for` supports `selector`, `gone`, `text`,
`regex`, `url`, `role_name`, `count`, `network_idle`, `stable`, and `revision`.
