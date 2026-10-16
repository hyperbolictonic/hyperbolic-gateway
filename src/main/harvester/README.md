# 📄 Kuang Grade Mark Eleven — Construct Harvester (`src/main/harvester/`)

This directory houses the DOM-to-Markdown downsampling engine, designed to compress verbose HTML web pages into token-efficient Markdown representations with YAML metadata envelopes.

---

## 🏛️ Pipeline Overview

1. **JSDOM DOM Emulation**:
   Parses raw HTML captured from `document.documentElement.outerHTML` into a virtual DOM tree.
2. **Mozilla Readability**:
   Extracts article bodies while stripping away navigation sidebars, advertisement banners, tracker iframes, and redundant headers.
3. **Turndown Markdown Conversion**:
   Converts clean semantic HTML into concise, readable GitHub-Flavored Markdown.
4. **YAML Front-Matter Envelope**:
   Appends token-estimation metrics, raw byte sizes, compression ratios, and source provenance at the top of the construct:
   ```yaml
   ---
   designation: "KUANG_GRADE_MARK_ELEVEN_CONSTRUCT"
   source_url: "https://example.com"
   title: "Example Title"
   harvested_at: "2026-10-16T08:00:00.000Z"
   raw_bytes: 54100
   construct_bytes: 2310
   estimated_tokens: 577
   compression_ratio: "4.2%"
   ---
   ```

---

## 📄 Source Files

- **[`markdown.ts`](./markdown.ts)**:
  `ConstructHarvester` class implementing DOM parsing, readability extraction, and markdown transformation.
