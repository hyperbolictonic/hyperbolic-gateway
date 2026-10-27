# 📚 Hyperbolic Gateway — Documentation Hub

Welcome to the documentation repository for **Hyperbolic Gateway** (*Hyperbolic Browser + Hyperbolic Rest for your Local AI*).

---

## 📑 Contents

- [CODEBASE.md](./CODEBASE.md) — Architecture lowdown: system maps, call paths, findings, optimisations, and an airline-search walkthrough.
- [BUILDING.md](./BUILDING.md) — Installers, CI, signing, auto-update and the release policy.
- [CONTROL_LAYER.md](./CONTROL_LAYER.md) — **Targeting, consent and human takeover**: control facts, text anchoring, frame evaluation, consent policy, takeover arbitration, input pacing.
- [SHADOW_DOM_AND_FRAMES.md](./SHADOW_DOM_AND_FRAMES.md) — **What Kuang can see and click**: open vs closed shadow roots, iframe execution contexts, the isolated-world gotcha, and what to do when a control is sealed.
- [SHADOW_WALK.md](./SHADOW_WALK.md) — **Sealed-content plan**: closed-root discovery via the accessibility tree, focus walk, component signatures, the Shadow Walk settings tab, and the tiered risk levers.
- [DECISION_MODELS.md](./DECISION_MODELS.md) — The optional `decide` / `drive` decision layer.
- [KUANG_WRAP.md](./KUANG_WRAP.md) - Compatibility stub; see [HYPERBOLIC_REST.md](./HYPERBOLIC_REST.md) for the second MCP server (saved REST wrappers and response recipes, `hb-rest`).
- [RESEARCH_STEALTH.md](./RESEARCH_STEALTH.md) - Settings → Research: isolated research session, proxy, engine chain, cooldowns, delays, hidden-view activation, and challenge backoff.
- [concept.md](./concept.md) — The foundational concept, design philosophy, and lore behind Hyperbolic Gateway.
- [TODO.md](./TODO.md) — Agent capability roadmap, prioritized from foundational utilities to high-bandwidth cognitive features and biomechanical kinematics.
- [PROPOSED_ABSTRACTIONS.md](./PROPOSED_ABSTRACTIONS.md) — The orthogonal primitive layer (observe/act/wait_for/…) design, status (A1–A6, B, C, D), and verification record.
- [FIELD_NOTES_2026-10-18.md](./FIELD_NOTES_2026-10-18.md) — Root-caused field findings from hardening the TIER-1 harvest path on real SPAs.
- [FIX_PLAN_2026-10-18.md](./FIX_PLAN_2026-10-18.md) — The remediation plan those findings produced.
- [PACKAGING.md](./PACKAGING.md) — Distribution and installer notes.
- [Root README.md](../README.md) — System overview, the 62-tool MCP reference, and architecture principles.
- [Plugin Skill Reference](../.agents/plugins/mark-eleven/skills/mark-eleven/SKILL.md) — Operational instructions for LLM agents utilizing Mark Eleven.
- [OKF Bundle (kuang_docs)](../kuang_docs/okf.json) — Playbook/reference partitions exposed as MCP resources (`mark-eleven://okf/…`).

---

## 🏛️ Architecture Documentation by Subsystem

- [Main Process & Chassis (src/main)](../src/main/README.md)
- [LanceDB Cortex Persistent Memory (src/main/cortex)](../src/main/cortex/README.md)
- [Multi-Tab Orchestration (src/main/tabs)](../src/main/tabs/README.md)
- [Autonomous Shield Breaker & Consent Dismissal (src/main/shield)](../src/main/shield/README.md)
- [Human Input & Takeover Arbitration (src/main/input)](../src/main/input/README.md)
- [Frame-Scoped Evaluation (src/main/browser)](../src/main/browser/README.md)
- [Download Manager & Document Harvester (src/main/downloads)](../src/main/downloads/README.md)
- [Session & Cookie Jar Vault (src/main/session)](../src/main/session/README.md)
- [Live Network & Stream Interceptor (src/main/network)](../src/main/network/README.md)
- [Set-of-Marks Visual Grounding (src/main/marks)](../src/main/marks/README.md)
- [Orthogonal Primitives (src/main/primitives)](../src/main/primitives/README.md)
- [Script Vault & Semantic Macro Engine (src/main/scripts)](../src/main/scripts/README.md)
- [System Tray & Desktop Visibility (src/main/tray)](../src/main/tray/README.md)
- [Human-In-The-Loop Intervention Protocol (src/main/hil)](../src/main/hil/README.md)
- [Ghost Cursor Telemetry & Stealth (src/main/telemetry)](../src/main/telemetry/README.md)
- [Construct Harvester & Markdown (src/main/harvester)](../src/main/harvester/README.md)
- [Model Context Protocol Server (src/mcp)](../src/mcp/README.md)
- [Renderer & DaisyUI 5 Cyberdeck HUD (src/renderer)](../src/renderer/README.md)
- [Preload Bridge (src/preload)](../src/preload/README.md)
- [Shared Type Definitions (src/shared)](../src/shared/README.md)
- [Recipe Library (packages/recipe)](../packages/recipe/README.md)
- [Testing & Automation Scripts (scripts)](../scripts/README.md)
