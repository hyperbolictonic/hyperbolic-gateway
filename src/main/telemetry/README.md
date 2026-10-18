# 🕹️ Kuang Grade Mark Eleven — Ghost Cursor Telemetry (`src/main/telemetry/`)

This directory implements the organic input simulation engine and stealth host browser fingerprinting system, enabling autonomous LLMs to traverse the web without triggering behavioral anti-bot sensors (Cloudflare, Akamai, Datadome).

---

## 🏛️ Subsystems

### 1. Bio-Kinematic Chaos & Neuromotor Mouse Engine
- **Fractal Pink Noise ($1/f$):** Uses an Ornstein-Uhlenbeck stochastic drift process to generate autocorrelated micro-tremors, replacing synthetic uniform white noise with true biological muscle/tendon elasticity.
- **Asymmetric Log-Normal Velocity & Minimum Jerk:** Implements Flash & Hogan's 5th-order minimum jerk polynomial skewed into a 30% ballistic acceleration phase and a 70% sensory feedback precision braking phase.
- **Two-Thirds Power Law ($v \propto \kappa^{-1/3}$):** Dynamically couples path curvature to velocity, automatically decelerating through corners and accelerating along straight reaches.
- **Target Overshoot & Saccadic Micro-Corrections:** High-speed reaching movements organically overshoot the target centroid by 2–8px, followed by an authentic 40–90ms saccadic correction loop.
- **Duffing Chaotic Attractor:** Integrates Duffing non-periodic strange attractor perturbations using Runge-Kutta 4th order (RK4) to introduce non-repeating deterministic chaos.

### 2. Gaussian Typing Cadence
- Simulates human typing variance using a normal Gaussian distribution between 60ms and 240ms per keystroke.
- Incorporates natural pauses on punctuation, uppercase transitions, and spacebars.

### 3. Stealth Host Browser Fingerprinting
- Inspects the host machine (`os.platform()`, `os.release()`) to discover installed Chromium / Chrome versions.
- Spoofs realistic `User-Agent`, `Sec-CH-UA`, and platform client hint headers so requests appear indistinguishable from the user's primary desktop browser.

---

## 📄 Source Files

- **[`chaos-kinematics.ts`](./chaos-kinematics.ts)**:
  `generateChaosTrajectory()` core engine. Implements the Ornstein-Uhlenbeck pink noise generator, Duffing strange attractor, minimum jerk model, and saccadic overshoot recoil.
- **[`bezier.ts`](./bezier.ts)**:
  Bézier trajectory wrapper delegating to the chaos kinematics engine with backwards-compatible interface types.
- **[`input-simulator.ts`](./input-simulator.ts)**:
  `HumanizedInputSimulator` class. Replays the bio-kinematic trajectory as real input events: mouse moves, clicks, keystrokes and wheel impulses. Delivery prefers the tab's attached CDP debugger (`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`), which reaches the renderer **regardless of OS window focus** and only enables focus *emulation* rather than stealing the foreground. If no debugger is attached it falls back to `webContents.sendInputEvent`, bringing the window forward first because the OS drops those events while another window is focused. `lastInputTransport` (`cdp` | `native`) is surfaced through `/health` as `input.transport`.
- **[`host-fingerprint.ts`](./host-fingerprint.ts)**:
  `detectHostBrowserProfile()` utility. Extracts machine attributes and builds stealth headers.
