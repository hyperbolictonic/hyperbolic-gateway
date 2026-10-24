# Set-of-Marks (Numbered Visual Grounding Badges)

The **Marks Overlay** (`src/main/marks/marks-overlay.ts`) provides visual grounding for autonomous multimodal LLMs by tagging visible interactive DOM elements with high-contrast, numbered neon badges (`[1]`, `[2]`, `[3]`, etc.).

## Why This Matters for Multimodal Agents

When agents interact with complex web applications (e.g. Skyscanner flight matrices, GitHub PR review screens, Reddit threads):
1. **Zero Hallucinated Coordinates**: Multimodal LLMs often misestimate `(x, y)` pixels from raw viewport images.
2. **Selector Invariant**: Avoids fragile, obfuscated CSS selectors or dynamically generated class names.
3. **Deterministic Actuation**: The agent simply inspects the annotated screenshot and issues `act(4)` (or `act({ mark_id: 2, action: "type", text: "Tokyo" })`). The chassis looks up mark #4's bounding rect and drives the physical Bézier mouse cursor directly to the center of the element.

## Detection & Accessibility Metadata

### Shadow DOM

The scanner collects **roots** before candidates: the document plus every open `el.shadowRoot`
(recursively), then runs the interactive selector in each root — so a web component's inner control
gets its own mark. Selectors resolve through open roots, and a custom-element host resolves to the
control a mouse would actually hit. Hit-tests use `kqAtPoint` (deep) because `elementFromPoint`
returns the host, and containment uses `kqContainsComposed` because `contains()` does not cross a
boundary.

Closed roots (`attachShadow({mode:'closed'})`) are invisible to page JavaScript and therefore get no
marks. Full detail: [docs/SHADOW_DOM_AND_FRAMES.md](../../../docs/SHADOW_DOM_AND_FRAMES.md).


Marks are built from three layers, so custom (non-`<select>`) widgets are covered:

1. **Semantic HTML + ARIA roles:** `a[href]`, `button`, `input`, `select`, `textarea`, `summary`, `contenteditable`, and roles `button`, `link`, `checkbox`, `radio`, `switch`, `combobox`, `option`, `treeitem`, `tab`, `menuitem*`, `slider`, `spinbutton`, `searchbox`, `textbox`.
2. **ARIA state attributes:** anything with `aria-haspopup` or `aria-expanded`.
3. **`cursor: pointer` heuristic:** outermost clickable `div`/`span`/`li`/`td`/`img`/`svg`/`label` with no role (framework click handlers).

Additional behaviour:
- **Occlusion check:** `document.elementFromPoint` at each element's centre; elements covered by modals/menus are skipped.
- **Popup priority:** elements inside open popups (`role=listbox|menu|dialog`, `aria-modal`, `dialog[open]`, Radix/MUI/antd/select2 portals) are numbered first so options survive the 99-mark cap.
- **Accessible names:** `aria-label` → `aria-labelledby` → `<label>` → text → `placeholder`/`title`/`alt`/`name`/`value`.
- **State flags** (`MarkItem.state`): `disabled`, `expanded=`, `checked`, `selected`, `pressed=`, `current`, `required`, `invalid`, `haspopup=`, `readonly`. Disabled marks get grey badges.
- **`MarkItem.value`:** current value of inputs/selects/sliders (never for password fields).
- **Stale-mark safety:** `data-mark-id` attributes are cleared at the start of every scan; IDs are only valid until the next scan.

Rendered table line: `[#4] <INPUT role=combobox> "Country" {value="UK", expanded=false, required}`.

## Workflow

1. Agent calls `take_screenshot({ marks: true })`.
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
7. Agent calls `act(1)` or `act({ mark_id: 2, action: "type", text: "Maldives" })`.

## HTTP Bridge API

- `GET /marks/screenshot` -> returns `{ screenshot: { base64Image, filePath, width, height, mimeType }, marks: MarkItem[] }`.
  - `?economy=1` -> downscales to 640px wide and encodes as JPEG q45 (`mimeType: "image/jpeg"`).
  - `?text_only=1` -> skips capture entirely; `screenshot.base64Image` is empty and only `marks` is meaningful.
- `POST /marks/click` - `{ "markId": 1 }` -> executes humanized Bézier cursor click on mark #1.
- `POST /marks/type` - `{ "markId": 2, "text": "..." }` -> clicks mark #2 and types with natural cadence.
- `GET /marks/list` -> returns active marks table.

## MCP Tools

- `take_screenshot({ marks: true, detail })`: one capture tool with three Set-of-Marks detail levels — `"full"` (PNG), `"economy"` (640px JPEG q45), `"markdown"` (marks table, no image). Same badge ids in every mode.
- `act({ mark_id, action, text })`: the single interaction verb. Addresses a mark badge (preferred), a CSS selector, or coordinates and dispatches the humanized Bézier click / type / hover / press.

The older `take_annotated_screenshot` / `take_economy_screenshot` / `list_marks` / `click_mark` / `type_mark` names remain callable but are **hidden aliases** of the two tools above.

## Choosing a Mode

| Mode | Image | Typical size | Best for |
| :--- | :--- | :--- | :--- |
| Full (`take_screenshot({ marks: true, detail: "full" })`) | PNG, native resolution | hundreds of KB | Vision models needing fine detail |
| Economy (`take_screenshot({ marks: true, detail: "economy" })`) | JPEG q45, max 640px wide | tens of KB | Vision models, cost-sensitive loops |
| Text-only (`take_screenshot({ marks: true, detail: "markdown" })` or `observe({ as: "som" })`) | none | marks table only | Text-only models, cheapest scan |

Mark IDs are registered identically in every mode, so `act(mark_id, …)` works after any of them. Economy downscaling only affects the returned image; actuation uses the real DOM rects.
