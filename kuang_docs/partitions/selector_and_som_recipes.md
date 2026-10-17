# Kuang Grade Mark Eleven: Selector & Set-of-Marks Recipes

## 1. Set-of-Marks (SoM) Visual Grounding

Mark Eleven features a multi-layered Set-of-Marks visual overlay system.

### Color Coding
- **Cyan Badges (`#06b6d4`):** Static structural anchors (navbars, search inputs, headers, primary buttons). These IDs are **session-sticky** and never scramble on layout shifts.
- **Neon Yellow Badges (`#eab308`):** Dynamic page content (search results, live table rows, product cards).
- **Muted Gray Badges (`#a1a1aa`):** Disabled elements (do not click).

### Inspection Tools
1. `take_annotated_screenshot()`: Full-resolution PNG with numbered badges + marks lookup table.
2. `take_economy_screenshot()`: Same marks table with a 640px JPEG (~15x lighter). Use this for multimodal LLMs when token budget matters.
3. `list_marks()`: Marks table only with NO image. Ideal for fast coordinate checks or text-only models (~15ms, 0 image tokens).

### Interaction
- Call `click_mark(mark_id)`: Dispatches human-like Bézier cursor movement and hardware click. Coordinates are dynamically re-calculated from the live DOM node, tracking layout shifts automatically.
- Call `type_mark(mark_id, text)`: Clicks the input badge and types with realistic Gaussian cadence.
