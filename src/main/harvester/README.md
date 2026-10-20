# 📄 Kuang Grade Mark Eleven — Construct Harvester (`src/main/harvester/`)

This directory houses the DOM-to-Markdown downsampling engine, designed to compress verbose HTML web pages into token-efficient Markdown representations with YAML metadata envelopes.

---

## 🏛️ Pipeline Overview

1. **Composed-DOM capture** (`dom-serializer.ts`):
   Serialises the *composed* tree — light children plus every open shadow root, recursively — into HTML. Plain `outerHTML` stops at the shadow boundary, so a signup form built from web components used to arrive as empty custom-element tags. Live form state (`value`, `checked`, `selected`) is baked in as attributes because those are properties, not attributes; password values are recorded as a length only.
2. **JSDOM DOM Emulation**:
   Parses the captured HTML into a virtual DOM tree.
3. **Mozilla Readability**:
   Extracts article bodies while stripping away navigation sidebars, advertisement banners, tracker iframes, and redundant headers.
4. **Turndown Markdown Conversion**:
   Converts clean semantic HTML into concise, readable GitHub-Flavored Markdown. Links and images are resolved to absolute URLs; controls render as `<input type="text" label="Email" value="a@b.com">`, `<select label="Day" value="2" options="1,2,3">`, `<textarea label="Notes">…</textarea>`, with `[#id]` badges where Set-of-Marks stamped them.
5. **Front-matter envelope**:
   A short, stable header — no timestamps, no byte-ratio vanity metrics — so two harvests of an unchanged page are byte-identical and therefore diffable and pageable:
   ```yaml
   ---
   url: "https://example.com"
   title: "Example Title"
   reader: "readability"
   extracted_chars: 2310
   page_chars: 5410
   shadow_roots: 3
   ---
   ```
   `reader` names the path that produced the body (`readability` or `full-body`), and `extracted_chars` / `page_chars` are the same unit (characters of page text), so the coverage of the extracted region can be compared honestly. When the extracted region is a small fraction of a large page, the construct says so and points at the alternates (`observe(as:"text")`, `observe(as:"ax")`) rather than pretending the page is short.

---

## 📄 Source Files

- **[`markdown.ts`](./markdown.ts)**:
  `ConstructHarvester` class implementing DOM parsing, readability extraction, and markdown transformation.
- **[`dom-serializer.ts`](./dom-serializer.ts)**:
  `captureComposedDom` — shadow-root-piercing serialisation with live form state baked in and password values redacted to a length.
