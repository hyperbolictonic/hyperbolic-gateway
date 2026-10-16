# 🕹️ Kuang Grade Mark Eleven — Ghost Cursor Telemetry (`src/main/telemetry/`)

This directory implements the organic input simulation engine and stealth host browser fingerprinting system, enabling autonomous LLMs to traverse the web without triggering behavioral anti-bot sensors (Cloudflare, Akamai, Datadome).

---

## 🏛️ Subsystems

### 1. Organic Bézier Mouse Kinematics
- Calculates natural, curved trajectories between pointer coordinates using randomized cubic Bézier control points.
- Applies quintic ease-in / ease-out curves with simulated velocity deceleration near targets and randomized micro-overshoots.
- Emits real-time coordinate and velocity pulses to the frontend radar canvas HUD.

### 2. Gaussian Typing Cadence
- Simulates human typing variance using a normal Gaussian distribution between 60ms and 240ms per keystroke.
- Incorporates natural pauses on punctuation, uppercase transitions, and spacebars.

### 3. Stealth Host Browser Fingerprinting
- Inspects the host machine (`os.platform()`, `os.release()`) to discover installed Chromium / Chrome versions.
- Spoofs realistic `User-Agent`, `Sec-CH-UA`, and platform client hint headers so requests appear indistinguishable from the user's primary desktop browser.

---

## 📄 Source Files

- **[`input-simulator.ts`](./input-simulator.ts)**:
  `HumanizedInputSimulator` class. Dispatches authentic OS hardware events via `webContents.sendInputEvent` for mouse moves, clicks, keystrokes, and mousewheel impulses.
- **[`host-fingerprint.ts`](./host-fingerprint.ts)**:
  `detectHostBrowserProfile()` utility. Extracts machine attributes and builds stealth headers.
