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

### [ ] Feature 1: `deep_crawl(start_url, max_depth, max_pages, match_patterns)`
- **Goal:** Allow an agent to run an autonomous, multi-page crawl from a seed URL or search result without turn-by-turn LLM intervention.
- **Specs:**
  - `start_url`: Seed URL (e.g., a recipe blog category or wiki index).
  - `max_depth`: Depth limit (default: 2).
  - `max_pages`: Total page budget (e.g., 5-10 pages).
  - `match_patterns`: Optional URL glob or regex whitelist (e.g., `["/recipe/*", "/builds/*"]`).
  - Automatically indexes all crawled pages directly into **LanceDB Cortex**, returning a concise summary table of harvested pages and topics.

### [ ] Feature 2: `extract_structured_data(format)` (Schema.org / JSON-LD / Readability)
- **Goal:** One-shot extraction of core content without navigation or visual DOM overhead.
- **Modes:**
  - `schema_org`: Extracts all `<script type="application/ld+json">` payloads (`Recipe`, `Article`, `FAQPage`, `ItemPage`). For recipes, this gives prep time, ingredients array, nutrition, and steps in raw structured JSON!
  - `article_reader`: Extracts the distilled article body using Readability heuristics (title, byline, clean markdown content, stripping all headers/ads).
  - `table_data`: Parses all HTML/markdown tables on the page into clean JSON objects/arrays for easy data aggregation.

### [ ] Feature 3: `research_topic(query, max_sources)` (Autonomous Research Mode)
- **Goal:** Autonomous search -> fetch top N sources -> distill -> index -> return synthesized findings.
- **Workflow:**
  1. Executes search (Google, DuckDuckGo, or direct wiki search).
  2. Spawns speculative background renderers across top 3-5 distinct sources.
  3. Pre-harvests clean markdown into LanceDB.
  4. Runs a similarity query against the research topic and returns the unified answer with source citations.

### [ ] Feature 5: `search_web(query, engine?, max_results?)` & Configurable Search Engine Hub
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
  - Returns structured results: Array of `{ title, url, snippet, rank }` with inline `[#ID]` marks for immediate navigation or batch harvesting.

### [ ] Feature 6: LLM-Friendly Site Discovery (site-provided Markdown / Text)
- **Goal:** When a site publishes an LLM-friendly surface, prefer it over rendering + parsing HTML — fewer tokens, no hydration, no Set-of-Marks pass.
- **What counts as "LLM-friendly" (detect, don't guess):**
  - **`/llms.txt` / `/llms-full.txt`** — the emerging convention ([llmstxt.org](https://llmstxt.org)): a Markdown index of a site's key pages, optionally with full content inline. Use it as a map: fetch the index, then pull only the sections the task needs.
  - **`/sitemap.xml`** — a URL inventory to feed `deep_crawl` (Feature 1) instead of crawling blindly.
  - **Content negotiation** — request `Accept: text/markdown, text/plain, text/html` and prefer a Markdown/plain body when the server offers one (many docs sites and LLM gateways already negotiate this).
  - **Per-page alternates** — `<link rel="alternate" type="text/markdown">` / `type="text/plain">`, or same-path `.md` / `.txt` / `?format=markdown` variants (Mintlify, Docusaurus, ReadMe, GitBook, etc.).
- **Implementation sketch:**
  - A tool, e.g. `llms_txt({ url?, section?, raw? })`, that fetches and returns a site's LLM index/content as Markdown, and can index it into **LanceDB Cortex**.
  - `navigate_to({ url, prefer? })` (or a new `fetch_markdown({ url, prefer: "md" | "text" })`) that loads the advertised Markdown/Text form *instead of* the rendered page.
  - Harvest fallback chain becomes: **site-provided Markdown/Text → rendered Markdown → HTML→Markdown**.
  - Discovery probes run in the **real Chromium engine** (inherits the host fingerprint, see §3), so a Cloudflare-fronted docs site still resolves.
- **Token economy:** raw Markdown/Text is typically ~5–10× cheaper than rendered DOM + a Set-of-Marks pass, and needs no JS hydration.
- **Out of scope:** blindly fetching `/page.md` for arbitrary URLs (a 404 guess costs a round trip and usually returns HTML). Only use an alternate form when the site **advertises** it (`llms.txt`, a `<link rel="alternate">`, or a successful content negotiation).

---

## 6. Key Differences: Automation Mode vs. Discovery Mode

| Aspect | Automation Mode (Current Mark Eleven) | Discovery / Research Mode (New Tools) |
| :--- | :--- | :--- |
| **Primary Goal** | Click, type, interact, fill forms, execute workflows | Read, gather, compare, extract structured knowledge |
| **Interface** | Visual badges (Set-of-Marks), Bézier clicks, telemetry | Schema.org JSON, Readability Markdown, Cortex RAG |
| **Execution** | Step-by-step turn-based control with screenshots | Batch concurrent execution (3-10 pages in parallel) |
| **Token Cost** | Medium (images + coordinates) | Ultra-low (distilled text + JSON-LD) |
