# 🎛️ Kuang Grade Mark Eleven — Cyberdeck HUD Renderer (`src/renderer/`)

This directory contains the user interface and visual presentation layer of the Cyberdeck, built with **Tailwind CSS v4** and **DaisyUI 5**.

---

## 🎨 Interface Features

1. **Cyberdeck Theme (`mark-eleven`)**:
   Custom high-contrast cyberpunk dark palette featuring electric cyan accents (`oklch(75% 0.18 215)`), slate chassis neutrals, and amber warning highlights.
2. **Ghost Cursor Radar Canvas**:
   An HTML5 `<canvas>` that renders a glowing cyan phosphor decay trail visualizing the agent's organic Bézier mouse movements in real time.
3. **DaisyUI 5 Tab Bar Strip**:
   Horizontal tab strip rendering active tabs, live loading spinners, title badges, and close buttons.
4. **Cortex Persistent Memory Modal (`#cortex-modal`)**:
   Interactive dialog featuring:
   - **Semantic Recall & History**: Real-time vector search across visited pages with percentage relevance match badges.
   - **Saved Bookmarks**: Card list with tag pills, annotations, and one-click navigation buttons.
5. **Hardware Viewport Coordination**:
   Automatically coordinates Electron's native `WebContentsView` visibility when modals or overlays are active, preventing hardware-accelerated clipping artifacts.

---

## 📄 Source Files

- **[`main.ts`](./main.ts)**:
  Main renderer script managing state synchronization, canvas rendering, modal events, and user interactions.
- **[`index.css`](./index.css)**:
  Global stylesheet configuring Tailwind CSS v4 directives and the custom DaisyUI 5 `mark-eleven` theme tokens.
