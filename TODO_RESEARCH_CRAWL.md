# Mark Eleven: Deep Research, Web Crawling & Discovery Engine (TODO & Architecture)

## 1. Executive Summary & Philosophy
While Mark Eleven excels at browser automation, visual grounding, and form interaction, real-world everyday agent usage frequently requires **information discovery and deep research**:
- Comparing 5 recipe variants and extracting clean ingredients/steps.
- Scraping and synthesizing game character builds (PoE, Diablo, Elden Ring, MMOs).
- Monitoring and cross-referencing news articles on a breaking topic.
- Extracting tabular comparison data across multiple reviews or product specs.

Instead of burning LLM tokens taking screenshots or navigating pages sequentially in 1-by-1 agent turns, specialized discovery architectures extract structured data at scale with minimal token overhead.

---

### 2. How Modern Systems Do It (Industry Benchmark)

Modern agents and research systems (e.g. Perplexity Deep Research, OpenAI Deep Research, Crawl4AI, Firecrawl, Tavily, Jina Reader) divide research into 4 distinct architectural tiers:

| Tier | Component | How It Works | Industry Examples |
| :--- | :--- | :--- | :--- |
| **Tier 1: Discovery & Link Expansion** | **Breadth-First Focused Crawl** | Starts with search/seed URLs. Filters candidate links using relevance scores or topic heuristics. | Tavily Extract, Crawl4AI DeepCrawl |
| **Tier 2: Real-Browser Headless/Detached Fetching** | **Authentic Chromium Renderer** | **Crucial:** Never runs as a bot script or python request. Runs inside Mark Eleven's genuine Chromium engine with host user-agent, real Sec-CH-UA, platform headers, and real canvas/WebGL fingerprints. Completely bypasses Cloudflare, anti-bot, and Paywalls. | Mark Eleven Prerender Engine |
| **Tier 3: Two-Stage Inspection (Citations -> Full Acquisition)** | **Scout & Retrieve Architecture** | Stage 1: Returns distilled citations + high-relevance snippets so the agent can judge usefulness before paying full token cost. Stage 2: If deemed useful, agent retrieves the complete document or extracts specific tables/recipes. | Perplexity Deep Research, Mark Eleven Cortex DB |
| **Tier 4: Content Distillation & Semantic Stripping** | **Readability & Schema Extraction** | Strips navbars, ads, cookie notices, footers, sidebars. Extracts standard JSON-LD schemas (`Recipe`, `NewsArticle`, `Product`, `HowTo`) or distilled Markdown. | Mozilla Readability, Defuddle, Schema.org parser |

---

## 3. Real Browser Behavior (Anti-Bot & Authenticity)

Unlike tools like `curl`, `cheerio`, or naive Puppeteer headless browsers that get immediately blocked by Cloudflare, Akamai, or Datadome:
- **100% Genuine Chromium Engine:** All crawls and background harvests execute inside detached `WebContentsView` instances powered by Electron's real Chromium engine.
- **Inherited Host Fingerprint:** Every request automatically injects the active Windows host profile (`sec-ch-ua`, `sec-ch-ua-platform: "Windows"`, real platform version, real cookie jar, and real WebGL rendering context).
- **Full JavaScript Hydration:** Single-page apps, React/Next.js hydration, and infinite scrolling work naturally because real JavaScript executes.

---

## 4. Two-Stage Acquisition Workflow: Citations First, Full Content on Demand

Instead of dumping 50,000 tokens of raw text into the LLM context window right away:
1. **Stage 1 (Scout / Citations Mode):**
   - The crawler returns a lightweight overview: Source URL, Title, 2-line summary, and top 3 matched citation snippets.
   - Example:
     ```json
     {
       "source_id": "src_1",
       "url": "https://maxroll.gg/poe/build-guides/frostblink-elementalist",
       "title": "Frostblink Ignite Elementalist League Starter",
       "match_score": 0.94,
       "citation_snippets": [
         "...The 6-link setup uses Frostblink of Wintry Blast + Spell Echo + Added Cold...",
         "...Budget gear requires Heatshiver and Berek's Respite to achieve 4M ignite DPS..."
       ]
     }
     ```
2. **Stage 2 (Full Acquisition on Demand):**
   - The agent inspects the snippets. If `src_1` is indeed the relevant build, it calls:
     `acquire_full_document(source_id="src_1", format="markdown" | "schema_org" | "tables")`
   - Only the chosen documents are pulled into the LLM context in full, saving 90% of token bandwidth while guaranteeing total data completeness.

---

## 5. High-Priority TODOs for Mark Eleven

### [x] Feature 1: `deep_crawl(start_url, max_depth, max_pages, match_patterns)` — ✅ *[IMPLEMENTED 2026-10-19]*
- **Goal:** Allow an agent to run an autonomous, multi-page crawl from a seed URL or search result without turn-by-turn LLM intervention.
- **Specs:**
  - `start_url`: Seed URL (e.g., a recipe blog category or wiki index).
  - `max_depth`: Depth limit (default: 2).
  - `max_pages`: Total page budget (e.g., 5-10 pages).
  - `match_patterns`: Optional URL glob or regex whitelist (e.g., `["/recipe/*", "/builds/*"]`).
  - Automatically indexes all crawled pages directly into **LanceDB Cortex**, returning a concise summary table of harvested pages and topics.
- **Implemented (2026-10-19):** `src/main/crawl/crawler.ts` (BFS + glob/regex scoping + Cortex indexing), chassis `deepCrawl`/`crawlRenderPage`, route `POST /crawl/deep`, catalog tool `deep_crawl`, and `npm run test:crawl` (local-fixture regression: depth/paging budgets, `match_patterns`, same-origin, the content-negotiated Markdown fast path, and indexing). Each page takes the cheap `llm` path first; pages are rendered in a **reused off-screen view**.

### [x] Feature 2: `extract_structured_data(format)` (Schema.org / JSON-LD / Readability) — ✅ *[IMPLEMENTED 2026-10-19 — folded into `extract`, no new tool]*
- **Goal:** One-shot extraction of core content without navigation or visual DOM overhead.
- **Modes:**
  - `schema_org`: Extracts all `<script type="application/ld+json">` payloads (`Recipe`, `Article`, `FAQPage`, `ItemPage`). For recipes, this gives prep time, ingredients array, nutrition, and steps in raw structured JSON!
  - `article_reader`: Extracts the distilled article body using Readability heuristics (title, byline, clean markdown content, stripping all headers/ads).
  - `table_data`: Parses all HTML/markdown tables on the page into clean JSON objects/arrays for easy data aggregation.
- **Implemented (2026-10-19) — folded into `extract` rather than a new tool** (avoiding a second extraction front door, per the Phase-7 decision). `extract(kind:"schema_org", type?)` parses + **types** JSON-LD (flattens `@graph`; `type` filters to e.g. `"Recipe"`). `extract(kind:"tables")` returns **every** table. `article_reader` **already existed** as `observe(as:"markdown")` (Mozilla Readability + aggregator fallback), and `kind:"app_data"` already returned parsed JSON-LD / `__NEXT_DATA__` — nothing new was needed for those. Covered by `npm run test:primitives`.

### [x] Feature 3: `research_topic(query, max_sources)` (Autonomous Research Mode) — ✅ *[IMPLEMENTED 2026-10-19]*
- **Goal:** Autonomous search -> fetch top N sources -> distill -> index -> return synthesized findings.
- **Workflow:**
  1. Executes search (Google, DuckDuckGo, or direct wiki search).
  2. Spawns speculative background renderers across top 3-5 distinct sources.
  3. Pre-harvests clean markdown into LanceDB.
  4. Runs a similarity query against the research topic and returns the unified answer with source citations.
- **Implemented (2026-10-19):** `src/main/research/researcher.ts` + chassis `researchTopic()`, route `POST /research/topic`, catalog tool `research_topic`, and `npm run test:research`. Pipeline: `search_web` → gather the top distinct URLs → per-source `deep_crawl` (depth 0, cheap `llm` path first) → distill + index into Cortex → **extractive** highlights (paragraphs ranked by query-term overlap) with citations. **Deviation (deliberate):** no prose synthesis — Kuang has no LLM, so the tool returns cited evidence and the caller writes the answer; the Cortex similarity query is available separately via `recall_memory` (running it inline would be fragile, since indexing is asynchronous).

### [x] Feature 5: `search_web(query, engine?, max_results?)` & Configurable Search Engine Hub — ✅ *[IMPLEMENTED 2026-10-19]*
- **Goal:** Provide configurable, multi-engine search capability without relying on a single search provider.
- **Configurable Search Engines:**
  - `duckduckgo`: `https://html.duckduckgo.com/html/?q={query}` (Zero-JS lightweight HTML, extremely resilient to bot detection).
  - `google`: `https://www.google.com/search?q={query}&udm=14` (`udm=14` triggers Google's clean web-only text view without AI overviews or ad widgets).
  - `bing`: `https://www.bing.com/search?q={query}`.
  - `brave`: `https://search.brave.com/search?q={query}`.
  - `startpage`: `https://www.startpage.com/sp/search?query={query}`.
  - `custom`: User-configured URL template in settings or environment (e.g. internal SearXNG instance `https://searx.local/search?q={query}`).
- **Features:**
  - Automated fallback: If Google triggers a CAPTCHA or consent modal, seamlessly fall back to DuckDuckGo HTML or Brave without agent failure.
  - Returns structured results: Array of `{ rank, title, url, snippet }` — plain URLs for `navigate_to` / `collect_all`. (A detached SERP carries no live marks; marks only apply to the active page.)
- **Implemented (2026-10-19):** `src/main/search/search-engine.ts` + chassis `searchWeb`/`loadDetached`, route `POST /search/web`, catalog tool `search_web`, and `npm run test:search` (local-fixture regression covering parsing, `max_results`, chain fallback, `blocked` detection and `BAD_REQUEST`). Validated live against DuckDuckGo HTML.

### [x] Feature 6: LLM-Friendly Site Discovery (site-provided Markdown / Text) — ✅ *[IMPLEMENTED 2026-10-19]*
- **Goal:** When a site publishes an LLM-friendly surface, prefer it over rendering + parsing HTML — fewer tokens, no hydration, no Set-of-Marks pass. **Detection is an explicit, agent-callable tool so the agent decides** — Kuang never silently swaps a page for a different representation.
- **What counts as "LLM-friendly" (detect, don't guess):**
  - **`/llms.txt` / `/llms-full.txt`** — the emerging convention ([llmstxt.org](https://llmstxt.org)): a Markdown index of a site's key pages, optionally with full content inline. Use it as a map: fetch the index, then pull only the sections the task needs.
  - **`/sitemap.xml`** — a URL inventory to feed `deep_crawl` (Feature 1) instead of crawling blindly.
  - **Content negotiation** — request `Accept: text/markdown, text/plain, text/html` and prefer a Markdown/plain body when the server offers one (many docs sites and LLM gateways already negotiate this).
  - **Per-page alternates** — `<link rel="alternate" type="text/markdown">` / `type="text/plain">`, or same-path `.md` / `.txt` / `?format=markdown` variants (Mintlify, Docusaurus, ReadMe, GitBook, etc.).
- **Agent-facing tools (the `llm_*` family — the agent's "option"):**
  - **`llm_surface({ url? })` — the check.** A read-only probe (defaults to the active tab) that reports what the site offers, so the agent can *choose* to spend tokens on Markdown/Text instead of a render:
    ```json
    {
      "url": "https://docs.example.com/",
      "llms_txt": { "found": true, "url": "https://docs.example.com/llms.txt", "bytes": 4210, "full": false },
      "sitemap": { "found": true, "url": "https://docs.example.com/sitemap.xml", "entries": 312 },
      "markdown_alternates": [{ "href": "/page.md", "type": "text/markdown" }],
      "content_negotiation": { "accepts_markdown": true, "content_type": "text/markdown" },
      "recommended": "llms_txt"
    }
    ```
    `recommended` ∈ `"llms_txt" | "llms_full" | "markdown" | "text" | "rendered"`. When it returns **`"rendered"`**, the site offers no LLM surface — read it the normal way with `observe(as:"markdown")`.
  - **`llm_fetch({ url?, as? })` — the fetch (gated).** Retrieves the chosen site-provided representation (defaults to `recommended`); can index it into **LanceDB Cortex**. `as: "llms_txt" | "llms_full" | "markdown" | "text"`. **Hard gate:** it refuses with a structured `NO_LLM_SURFACE` error unless a probe has confirmed an advertised surface for that origin/page. It never fetches arbitrary URLs and never guesses paths — it fetches **only a URL the site itself advertises**.
- **Naming & disambiguation (deliberately *not* a `*_markdown` tool):**
  - The semantic split is **rendered vs site-provided**:
    - `observe(as:"markdown")` — and its retired hidden aliases `get_page_markdown` / `harvest_markdown` — returns the **rendered DOM of the live tab** (TIER 1).
    - `llm_surface` / `llm_fetch` return the **site's own Markdown/Text representation**, fetched as an alternate. Not a render.
  - Both names carry the **`llm_` prefix** so they read as one family and cannot be mistaken for the observation tools. **Do not** name anything `fetch_markdown` / `get_markdown` / `read_markdown` — that collides with `observe(as:"markdown")` and would revive the exact alias shape we retired in Phase 3.
  - **Cross-reference in descriptions:** the `llm_*` descriptions say *"for the rendered page use `observe(as:'markdown')`"*, and `observe`'s description gains one line pointing at `llm_surface` for sites that publish an LLM-friendly surface.
  - **Not TIER-1.** `llm_surface` / `llm_fetch` are opt-in (`TOOL_TIERS` leaves them unprefixed); a normal page is still read with `observe`. The probe's `recommended:"rendered"` default keeps `observe` as the fallback, so this stays additive and never becomes a second front door for "get markdown from a page".
- **Harvest fallback chain:** site-provided Markdown/Text → rendered Markdown → HTML→Markdown.
- **Safety & bot-detection posture (why the fetch is constrained):**
  - **Two acquisition profiles, chosen by what's being fetched:**
    - **Tier A — static, spec-defined text endpoints** (`/llms.txt`, `/llms-full.txt`, `/sitemap.xml`): fetched with the session's `net.fetch` (inherits cookies / UA / TLS via Chromium's network stack). These are *published* endpoints — a plain `GET` with `Accept: text/plain, */*` is exactly what they expect, so there is no navigation/header mismatch to flag.
    - **Tier B — a page's advertised Markdown/Text alternate** (`<link rel="alternate" type="text/markdown">`): loaded as a **real document navigation** in a detached `WebContentsView` (reusing `PrerenderEngine`), **not** `net.fetch`. A navigation carries Chromium's full header set + renderer fingerprint, so it looks like a human opening the page — the safest way to hit a per-page alternate.
  - **Never guess.** No `/page.md` probing for arbitrary URLs — the only URLs fetched are ones the site advertises (an `llms.txt`/sitemap entry, or an `<link rel="alternate">` `href`). A missed guess is itself a scanner signature; we don't make them.
  - **Well-known paths only, once per origin.** Confined to `/llms.txt`, `/llms-full.txt`, `/sitemap.xml` at the origin root; results cached per origin so we don't repeat-hit (request volume is a bot signal).
  - **Honor `robots.txt`** for the probes (and the future crawler).
  - **No escalation on a block.** A `403` / `429` / challenge page / `text/html`-where-text-was-expected ends the attempt — return `FETCH_BLOCKED` (or no surface) and fall back to the render path (`observe`) or `request_human_intervention`. No retry storms.
  - **Don't mislabel.** If an alternate fetch returns `text/html`, it is **not** markdown — report no surface rather than feeding HTML to the agent as Markdown.
  - **Raw `net.fetch` stays internal.** It is **not** exposed as a general-purpose agent tool; the only agent-facing entries are `llm_surface` (probe) and `llm_fetch` (gated). A general `http_get` is deliberately out of scope — its risk posture is different and needs its own decision.
  - **Runs in the real Chromium engine** (inherits the host fingerprint, see §3), so a Cloudflare-fronted docs site still resolves — and a JS-gated one falls back to the render path rather than forcing the fetch.
- **Token economy:** raw Markdown/Text is typically ~5–10× cheaper than rendered DOM + a Set-of-Marks pass, and needs no JS hydration.
- **Out of scope:** blindly fetching `/page.md` for arbitrary URLs (a 404 guess costs a round trip and usually returns HTML). Only use an alternate form when the site **advertises** it (`llms.txt`, a `<link rel="alternate">`, or a successful content negotiation).
- **Implemented (2026-10-19):** `src/main/llm/llm-surface.ts` (`llm_surface` probe + gated `llm_fetch`), chassis `probeLlmSurface` / `fetchLlmSurface` / `navigateForText`, bridge routes `POST /llm/surface` + `POST /llm/fetch`, catalog tools `llm_surface` / `llm_fetch`, and `npm run test:llm` (local-fixture regression covering discovery, the gate, and the navigation path).

---

## 6. Key Differences: Automation Mode vs. Discovery Mode

| Aspect | Automation Mode (Current Mark Eleven) | Discovery / Research Mode (New Tools) |
| :--- | :--- | :--- |
| **Primary Goal** | Click, type, interact, fill forms, execute workflows | Read, gather, compare, extract structured knowledge |
| **Interface** | Visual badges (Set-of-Marks), Bézier clicks, telemetry | Schema.org JSON, Readability Markdown, Cortex RAG |
| **Execution** | Step-by-step turn-based control with screenshots | Batch concurrent execution (3-10 pages in parallel) |
| **Token Cost** | Medium (images + coordinates) | Ultra-low (distilled text + JSON-LD) |
