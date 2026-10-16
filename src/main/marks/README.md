# Set-of-Marks (Numbered Visual Grounding Badges)

The **Marks Overlay** (`src/main/marks/marks-overlay.ts`) provides visual grounding for autonomous multimodal LLMs by tagging visible interactive DOM elements with high-contrast, numbered neon badges (`[1]`, `[2]`, `[3]`, etc.).

## Why This Matters for Multimodal Agents

When agents interact with complex web applications (e.g. Skyscanner flight matrices, GitHub PR review screens, Reddit threads):
1. **Zero Hallucinated Coordinates**: Multimodal LLMs often misestimate `(x, y)` pixels from raw viewport images.
2. **Selector Invariant**: Avoids fragile, obfuscated CSS selectors or dynamically generated class names.
3. **Deterministic Actuation**: The agent simply inspects the annotated screenshot and issues `click_mark(4)` or `type_mark(2, "Tokyo")`. The chassis looks up mark #4's bounding rect and drives the physical Bézier mouse cursor directly to the center of the element.

## Workflow

1. Agent calls `take_annotated_screenshot()`.
2. The chassis detects visible interactive elements (`a`, `button`, `input`, `select`, `role="button"`, etc.).
3. Ephemeral amber neon badges and bounding boxes are injected into the DOM.
4. Electron captures the annotated viewport frame.
5. Badges are immediately cleaned up from the DOM so normal user interaction is never disturbed.
6. The agent receives the annotated screenshot alongside a structured lookup table:
   ```json
   [
     { "id": 1, "tag": "A", "text": "Flights", "rect": { "x": 120, "y": 45, "width": 80, "height": 32 } },
     { "id": 2, "tag": "INPUT", "type": "text", "text": "Where to?", "rect": { "x": 220, "y": 45, "width": 240, "height": 40 } }
   ]
   ```
7. Agent calls `click_mark(1)` or `type_mark(2, "Maldives")`.

## HTTP Bridge API

- `GET /marks/screenshot` -> returns `{ screenshot: { base64Image, width, height }, marks: MarkItem[] }`.
- `POST /marks/click` - `{ "markId": 1 }` -> executes humanized Bézier cursor click on mark #1.
- `POST /marks/type` - `{ "markId": 2, "text": "..." }` -> clicks mark #2 and types with natural cadence.
- `GET /marks/list` -> returns active marks table.

## MCP Tools

- `take_annotated_screenshot`: Captures a viewport screenshot tagged with numbered neon badges and returns the marks lookup table.
- `click_mark`: Clicks directly on the element corresponding to a numbered visual mark ID.
- `type_mark`: Focuses and enters text into the element corresponding to a numbered visual mark ID.
