# ⚡ Project Manifesto: Hyperbolic Gateway

> **System Designation:** Stateful Visual Matrix Navigator (Electron Chassis + Pure Node.js Telemetry Engine)
> **Design Thesis:** An unrestricted, stateful web-browsing gateway for LLM Agents that replaces legacy headless data scrapers with human-like visual interaction and clean data harvesting.

---

## 🧭 1. The Core Concept

**Hyperbolic Gateway** is an interactive, stateful web-browsing Model Context Protocol (MCP) server that empowers an LLM Agent to break out of its enclosed training data and operate the live, open web.

Instead of navigating the internet as a background process fetching raw strings of chaotic HTML, Hyperbolic Gateway launches a **fully active, visible Chromium browser instance** directly on the user's desktop. The AI Agent doesn't merely read text; it experiences web platforms like a human operator—navigating, scrolling, clicking buttons, filling forms, and observing the live rendering state of the web.

When a payload needs to be ingested, the system downsamples the active DOM into an ultra-clean, token-efficient Markdown file, allowing the AI to read dense pages without blowing through its context window limits.

---

## 👁️ 2. The Inspiration

The project originally drew its name and creative aesthetic from **William Gibson’s seminal cyberpunk masterpiece, _Neuromancer_**. It has since been rebranded to **Hyperbolic Gateway**, with **Hyperbolic Browser** and **Hyperbolic Rest** as its components.

In the _Sprawl_ trilogy, the **Kuang Grade Mark Eleven** is a legendary, military-grade icebreaker designed to penetrate the toughest, most heavily fortified corporate data fortresses inside the Matrix. That fictional device remains the project’s inspiration; Hyperbolic Gateway is an independent project and is not affiliated with William Gibson or _Neuromancer_.

Hyperbolic Gateway maps this sci-fi concept onto modern software architecture:

- To an LLM confined to its offline training weights, a tool that lets it pierce the open web and dynamically bypass corporate anti-bot systems is functionally the ultimate icebreaker.
- The browser window acts as the **Cyberdeck**, translating the global network into a visual space the AI can navigate.
- Extracting clean Markdown files from complex web layouts mirrors the act of downloading raw data packets into a physical **Memory Construct**.

---

## 📡 3. Core Features

### 🖥️ Visible Stateful Chassis (Electron)

- **Live Graphical Viewport:** Launches a real, visible Chromium window (`headless: false`) sitting alongside your chat interface. You can watch the AI browse in real-time.
- **Authentic Session Management:** Native support for cookies, session persistence, complex single-page apps (SPAs), and heavy JavaScript frameworks.

### 🕹️ Humanized Interaction Telemetry (The Ghost Cursor)

- **Bézier Curve Mouse Movements:** Smoothly calculates curved, organic paths for cursor movement. The pointer accelerates, decelerates, and hovers with realistic human randomness rather than instantly teleporting to coordinates.
- **OS-Level Input Simulation:** Utilizes Electron's native input event piping. Clicks and keystrokes are processed by Chromium as authentic hardware signals, allowing the Agent to float straight through advanced behavioral anti-bot sensors (like Cloudflare or Akamai).
- **Variable Typing Cadence:** Simulates a human typing profile, varying the millisecond delay between keystrokes to mimic real touch-typing.

### 📄 Token-Efficient Construct Compilation (`markitdown-js`)

- **Pure Node.js Markdown Engine:** Uses a native JavaScript rebuild of Microsoft's `MarkItDown` framework. It requires zero platform-specific binaries or underlying Python environments.
- **Semantic Data Flattening:** Strips away sidebars, tracking scripts, ads, and chaotic nested divs, compressing web pages into beautiful, clean Markdown tables and headers that the LLM can read instantly.
- **Automated Envelope Front-Matter:** Saves files locally with clean metadata blocks containing the site title, exact timestamp, and source URL for easy downstream indexing.

### 🔌 Developer-First MCP Architecture

- **Zero Cognitive Friction:** Uses highly predictable, industry-standard tool naming conventions (`go_to_url`, `click_element`, `scroll_page`, `type_text`, `save_as_markdown`) ensuring any LLM can command the browser flawlessly without requiring massive system prompts.
- **Under-the-Hood Cyberpunk Styling:** Keeps the codebase short, ultra-clean, and easy to read, while wrapping console logs and project files in an elegant Sprawl-themed aesthetic.
