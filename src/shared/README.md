# 📐 Kuang Grade Mark Eleven — Shared Type Definitions (`src/shared/`)

This directory houses universal TypeScript interfaces, schemas, and telemetry models shared across the Electron main process, preload script, renderer UI, and external test suites.

---

## 📄 Key Types

- **`AgentStatus`**:
  Lifecycle enum (`'IDLE' | 'TRAVERSING' | 'SIMULATING_INPUT' | 'HARVESTING' | 'ERROR'`).
- **`TelemetryEvent`**:
  Input kinematics payload containing event type (`mouse_move`, `click`, `keystroke`, `scroll`, `navigation`, `harvest`), coordinates, velocities, and millisecond timestamps.
- **`HarvestedConstruct`**:
  Synthesized document construct containing source URL, title, raw byte length, clean markdown content, and estimated LLM tokens.
- **`TabSummary`**:
  Structured metadata for open browser tabs (`id`, `title`, `url`, `isLoading`, `isActive`).
- **`ChassisState`**:
  Comprehensive telemetry snapshot containing active URL, agent status, coordinates, uptime, and aggregated interaction statistics.

---

## 📄 Source Files

- **[`types.ts`](./types.ts)**:
  Single source of truth for cross-process data contracts.
