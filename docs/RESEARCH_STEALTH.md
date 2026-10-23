# Research stealth mode

**Settings → RESEARCH** controls the hidden pipeline used by `search_web`,
`deep_crawl`, and `research_topic`. It is a reliability layer, not a CAPTCHA
bypass.

## What it changes

| Control | Effect |
| --- | --- |
| **Enable stealth** | Applies the research defaults below; when off, the existing tool arguments are left alone. |
| **Engine chain** | Default provider order. The shipped stealth order is DuckDuckGo → Brave → Google. A custom template is tried first when configured. |
| **Custom template** | A SearXNG/self-hosted URL containing `{query}`. |
| **Research proxy** | Applied only to the isolated `persist:kuang-research` session; normal browsing tabs keep the default session and direct route. |
| **Domain cooldown** | After a WAF/challenge page or HTTP 403/429, the host is skipped for this many seconds. |
| **Politeness delay** | Minimum gap between crawled pages and research sources. |
| **Crawl concurrency** | Parallel page fetches inside `deep_crawl` (1–4). `1` is sequential and safest; higher values raise WAF risk. |
| **Prefer Markdown/LLM** | Try content-negotiated Markdown/Text and advertised alternates before rendering. |
| **Default crawl pages / research sources / search results** | Applied when the tool call omits its own limit. |
| **Activate hidden view** | Uses CDP to keep the off-screen view in an `active` lifecycle, emulates focus, and gives it a 1280×900 layout viewport. |

## Isolation

Research renderers use `persist:kuang-research`, not the normal tab session.
That means research cookies, cache, and `aws-waf-token` values do not mix with
the visible browser tabs. The session is persistent so consent/challenge state
can survive between calls; **Reset research cookies** clears it.

`search_web` and crawl rendering use the isolated session. The Markdown/Text
content-negotiation fast path uses a second `LlmSurface` bound to the same
research session, so `prefer_llm` does not silently bypass the proxy or
isolation.

## Challenge handling

- Search hub already reports when an engine returns no results plus a
  bot-check/consent wall. Stealth mode records a cooldown for that engine.
- Rendered pages are checked for AWS WAF, Cloudflare, DataDome, CAPTCHA,
  “unusual traffic”, 403, and 429 signatures. A detected challenge marks the
  host as cooling and skips the page.
- The crawler calls the cooldown gate before the cheap Markdown path too, so a
  cooled host is never contacted by `prefer_llm`.

## Limits

- A hidden Chromium view is still detectable. TLS/JA4, hidden visibility,
  lack of human input, IP reputation, and missing cookies can all matter.
- The search path still loads SERP URLs directly; humanized typing into a
  search box is not implemented yet.
- CAPTCHAs are surfaced as failures/notes, never auto-solved.
- A proxy only helps if it is reliable and not itself flagged. Prefer a sticky
  residential/mobile exit or a separate network for agent traffic.
- For sites that aggressively challenge, use the visible tab and
  `request_human_intervention` instead.

## Tests

```bash
npm run test:research:settings   # schema, persistence, challenge detection
npm run test:crawl:pool          # crawl concurrency / budget / prefer-llm
npm run test:research            # bridge-level research_topic regression
```

## Files

- `src/main/research/settings.ts` — settings schema, persistence, challenge
  detector.
- `src/main/browser-chassis.ts` — isolated session, proxy, cooldown gate,
  hidden-view activation.
- `src/main/research/researcher.ts` — per-source delay.
- Settings → RESEARCH — controls.
