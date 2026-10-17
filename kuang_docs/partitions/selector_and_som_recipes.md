# Kuang Grade Mark Eleven: Selector & Set-of-Marks Recipes

## 1. Golden Operational Sequence (Preferential Tool Hierarchy)

To maximize execution speed, minimize token burn, and eliminate bot shadowbans, ALWAYS follow this 3-tier sequence:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 1 (FIRST CHOICE): Grounded Markdown (`get_page_markdown`)         │
│ • Downsamples page to clean text with inline [#ID] marks.              │
│ • You can immediately call `click_mark(id)` or `type_mark(id, text)`.   │
│ • ZERO image tokens burned, 100% hardware trusted (isTrusted: true).    │
├────────────────────────────────────────────────────────────────────────┤
│ TIER 2 (FALLBACK): Set-of-Marks Screenshot (`take_economy_screenshot`) │
│ • Use ONLY when visual layout, complex maps, or CAPTCHAs require vision.│
│ • Downscaled 640px JPEG (~15x lighter than full PNG).                  │
│ • Mark IDs match the markdown marks identically.                       │
├────────────────────────────────────────────────────────────────────────┤
│ TIER 3 (LAST RESORT): Script Inspection (`evaluate_javascript`)        │
│ • Use STRICTLY for read-only DOM inspection, calculating values, or    │
│   querying hidden attributes.                                          │
│ • NEVER use JS to artificially set input values (`el.value = ...`) or  │
│   dispatch synthetic clicks (`el.click()`) on protected sites! That   │
│   sets `isTrusted: false` and triggers silent bot shadowbans.          │
└────────────────────────────────────────────────────────────────────────┘
```

## 2. Set-of-Marks (SoM) Visual Grounding

Mark Eleven features a multi-layered Set-of-Marks visual overlay system.

### Color Coding
- **Cyan Badges (`#06b6d4`):** Static structural anchors (navbars, search inputs, headers, primary buttons). These IDs are **session-sticky** and never scramble on layout shifts.
- **Neon Yellow Badges (`#eab308`):** Dynamic page content (search results, live table rows, product cards).
- **Muted Gray Badges (`#a1a1aa`):** Disabled elements (do not click).

### Inspection Tools
1. `get_page_markdown()`: Extracts page text with inline `[#ID]` marks stamped directly on buttons, links, and inputs.
2. `take_economy_screenshot()`: Downscaled 640px JPEG Set-of-Marks screenshot (~15x lighter than PNG). Recommended for vision.
3. `take_annotated_screenshot()`: Full-resolution PNG with numbered badges + marks lookup table.
4. `list_marks()`: Marks table only with NO image. Ideal for fast coordinate checks or text-only models (~15ms, 0 image tokens).

### Interaction
- Call `click_mark(mark_id)`: Dispatches human-like Bézier cursor movement and hardware click (`isTrusted: true`). Coordinates are dynamically re-calculated from the live DOM node, tracking layout shifts automatically.
- Call `type_mark(mark_id, text)`: Clicks the input badge and types with realistic Gaussian cadence (`isTrusted: true`).
