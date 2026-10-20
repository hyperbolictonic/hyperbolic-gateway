import { BrowserWindow, type WebContents } from 'electron';
import { generateOrganicTrajectory, type Point, type PathStep, type ChaosKinematicsOptions } from './bezier.js';

export interface InputTelemetryReporter {
  onMouseMove?: (point: Point, velocity: number) => void;
  onClick?: (point: Point) => void;
  onKey?: (char: string, delay: number) => void;
  onScroll?: (deltaY: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Named (non-printable) keys, mapped to their CDP `key`/`code`/virtual-keycode. */
const NAMED_KEYS: Record<string, { key: string; code: string; vk: number }> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  Space: { key: ' ', code: 'Space', vk: 32 },
};

/**
 * Printable punctuation → US-layout `code` name **and Windows virtual-key code**.
 *
 * `vk` must be the virtual-key code, never the ASCII value: ASCII collides with real VKs, and
 * Chromium honours those as editing/navigation commands instead of inserting the character —
 * `'.'` is ASCII 46 = `VK_DELETE` and `"'"` is ASCII 39 = `VK_RIGHT`, so both were silently
 * swallowed (typing `gmail.com` produced `gmailcom`, and any password containing `'` was
 * corrupted). Shifted variants share the physical key's VK; the character itself is carried by
 * the event's `text`, so no shift modifier is needed.
 */
const PUNCT: Record<string, { code: string; vk: number }> = {
  ' ': { code: 'Space', vk: 32 },
  ';': { code: 'Semicolon', vk: 186 }, ':': { code: 'Semicolon', vk: 186 },
  '=': { code: 'Equal', vk: 187 }, '+': { code: 'Equal', vk: 187 },
  ',': { code: 'Comma', vk: 188 }, '<': { code: 'Comma', vk: 188 },
  '-': { code: 'Minus', vk: 189 }, '_': { code: 'Minus', vk: 189 },
  '.': { code: 'Period', vk: 190 }, '>': { code: 'Period', vk: 190 },
  '/': { code: 'Slash', vk: 191 }, '?': { code: 'Slash', vk: 191 },
  '`': { code: 'Backquote', vk: 192 }, '~': { code: 'Backquote', vk: 192 },
  '[': { code: 'BracketLeft', vk: 219 }, '{': { code: 'BracketLeft', vk: 219 },
  '\\': { code: 'Backslash', vk: 220 }, '|': { code: 'Backslash', vk: 220 },
  ']': { code: 'BracketRight', vk: 221 }, '}': { code: 'BracketRight', vk: 221 },
  "'": { code: 'Quote', vk: 222 }, '"': { code: 'Quote', vk: 222 },
  '!': { code: 'Digit1', vk: 49 }, '@': { code: 'Digit2', vk: 50 },
  '#': { code: 'Digit3', vk: 51 }, '$': { code: 'Digit4', vk: 52 },
  '%': { code: 'Digit5', vk: 53 }, '^': { code: 'Digit6', vk: 54 },
  '&': { code: 'Digit7', vk: 55 }, '*': { code: 'Digit8', vk: 56 },
  '(': { code: 'Digit9', vk: 57 }, ')': { code: 'Digit0', vk: 48 },
};

/** Best-effort US-layout descriptor for a single typed character. */
function keyDescriptor(ch: string): { key: string; code: string; vk: number } {
  if (NAMED_KEYS[ch]) return NAMED_KEYS[ch];
  const lower = ch.toLowerCase();
  if (lower >= 'a' && lower <= 'z') {
    return { key: ch, code: `Key${lower.toUpperCase()}`, vk: lower.toUpperCase().charCodeAt(0) };
  }
  if (ch >= '0' && ch <= '9') return { key: ch, code: `Digit${ch}`, vk: ch.charCodeAt(0) };
  const punct = PUNCT[ch];
  if (punct) return { key: ch, code: punct.code, vk: punct.vk };
  return { key: ch, code: '', vk: 0 };
}

export class HumanizedInputSimulator {
  private currentCursor: Point = { x: 100, y: 100 };

  /**
   * Which transport delivered the most recent input event: `cdp` (focus-independent,
   * preferred) or `native` (`webContents.sendInputEvent`, needs OS window focus).
   * Surfaced via `/health` so agents can tell whether input is focus-safe right now.
   */
  public lastInputTransport: 'cdp' | 'native' | null = null;

  constructor(private reporter?: InputTelemetryReporter) {}

  public getCursorPosition(): Point {
    return { ...this.currentCursor };
  }

  /**
   * Returns the tab's CDP debugger when it is attached. Input dispatched over CDP
   * (`Input.dispatch*`) reaches the renderer regardless of OS window focus, unlike
   * Electron's `webContents.sendInputEvent`, which the OS silently drops whenever another
   * window owns the foreground (a backgrounded / occluded Cyberdeck window would then
   * "click" into the void).
   */
  private getCdp(webContents: WebContents): Electron.Debugger | null {
    try {
      if (webContents && !webContents.isDestroyed() && webContents.debugger.isAttached()) {
        return webContents.debugger;
      }
    } catch {}
    return null;
  }

  /** Sends a CDP command; returns false (never throws) when CDP is unavailable. */
  private async cdp(
    webContents: WebContents,
    method: string,
    params: Record<string, unknown>
  ): Promise<boolean> {
    const dbg = this.getCdp(webContents);
    if (!dbg) return false;
    try {
      await dbg.sendCommand(method, params);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delivers one input event, preferring CDP and recording which transport was used.
   * `nativeFallback` is only invoked when CDP is unavailable or the command is rejected.
   */
  private async dispatch(
    webContents: WebContents,
    method: string,
    params: Record<string, unknown>,
    nativeFallback: () => void
  ): Promise<void> {
    if (await this.cdp(webContents, method, params)) {
      this.lastInputTransport = 'cdp';
      return;
    }
    this.lastInputTransport = 'native';
    try {
      nativeFallback();
    } catch {}
  }

  /**
   * Prepares the target for synthetic input.
   *
   * With CDP available, input is dispatched over the devtools protocol, which reaches the
   * renderer regardless of OS window focus — so we only enable focus *emulation* (the page
   * reports `document.hasFocus()`, so focus-gated JS still responds) and never steal the
   * foreground from whatever the human is using.
   *
   * Without CDP we fall back to `webContents.sendInputEvent`, which the OS drops unless the
   * owning window is focused, so in that case we do bring the window forward.
   */
  private ensureInputTarget(webContents: WebContents): void {
    if (!webContents || webContents.isDestroyed()) return;

    if (this.getCdp(webContents)) {
      void this.cdp(webContents, 'Emulation.setFocusEmulationEnabled', { enabled: true });
      return;
    }

    try {
      const win = BrowserWindow.fromWebContents(webContents);
      if (win && !win.isDestroyed() && win.isVisible() && !win.isFocused()) {
        try { win.show(); } catch {}
        try { win.focus(); } catch {}
      }
    } catch {}
    try { webContents.focus(); } catch {}
  }

  /**
   * Moves the mouse smoothly along an organic Bézier trajectory to target coordinates.
   */
  public async moveMouseTo(
    webContents: WebContents,
    target: Point,
    options?: ChaosKinematicsOptions
  ): Promise<void> {
    this.ensureInputTarget(webContents);
    const trajectory = generateOrganicTrajectory(this.currentCursor, target, options);

    // Initialize visual ghost cursor overlay inside the web page if needed
    await this.ensureVisualCursor(webContents);

    for (const step of trajectory) {
      await this.dispatch(
        webContents,
        'Input.dispatchMouseEvent',
        { type: 'mouseMoved', x: step.x, y: step.y, button: 'none', buttons: 0, pointerType: 'mouse' },
        () => {
          webContents.sendInputEvent({
            type: 'mouseMove',
            x: step.x,
            y: step.y,
            movementX: step.x - this.currentCursor.x,
            movementY: step.y - this.currentCursor.y,
          });
        }
      );

      // Update in-page visual pointer position and phosphor trail
      webContents.executeJavaScript(
        `window.__kuangMoveCursor && window.__kuangMoveCursor(${step.x}, ${step.y}, ${step.isCorrective ? 'true' : 'false'})`,
        true
      ).catch(() => {});

      this.currentCursor = { x: step.x, y: step.y };

      await sleep(step.delayMs);
    }

    // Report the glide ONCE, not once per step. The in-page phosphor trail is already drawn
    // per step above (window.__kuangMoveCursor), so emitting a telemetry event per step only
    // flooded the HUD — one click produced 38-140 `mouse_move` rows.
    const lastStep = trajectory.length > 0 ? trajectory[trajectory.length - 1] : null;
    this.reporter?.onMouseMove?.(this.currentCursor, lastStep ? lastStep.velocity : 0);
  }

  private async ensureVisualCursor(webContents: WebContents): Promise<void> {
    if (!webContents || webContents.isDestroyed()) return;
    try {
      await webContents.executeJavaScript(`
        (() => {
          if (window.__kuangCursorActive) return;
          window.__kuangCursorActive = true;

          const canvas = document.createElement('canvas');
          canvas.id = '__kuang_ghost_cursor_canvas';
          canvas.style.position = 'fixed';
          canvas.style.top = '0';
          canvas.style.left = '0';
          canvas.style.width = '100vw';
          canvas.style.height = '100vh';
          canvas.style.pointerEvents = 'none';
          canvas.style.zIndex = '2147483647';
          document.documentElement.appendChild(canvas);

          const ctx = canvas.getContext('2d');
          let trail = [];
          let currentPos = { x: -100, y: -100, isCorrective: false };
          let ripple = null;

          function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
          }
          window.addEventListener('resize', resize);
          resize();

          window.__kuangMoveCursor = (x, y, isCorrective) => {
            currentPos = { x, y, isCorrective };
            trail.push({ x, y, alpha: 1.0, isCorrective });
            if (trail.length > 20) trail.shift();
          };

          window.__kuangClickCursor = (x, y) => {
            ripple = { x, y, radius: 4, alpha: 1.0 };
          };

          function render() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw fading phosphor trail
            for (let i = 0; i < trail.length; i++) {
              const p = trail[i];
              p.alpha *= 0.88;
              if (p.alpha > 0.05) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 2.5 * p.alpha, 0, Math.PI * 2);
                ctx.fillStyle = p.isCorrective
                  ? \`rgba(245, 158, 11, \${p.alpha * 0.9})\`
                  : \`rgba(0, 210, 255, \${p.alpha * 0.8})\`;
                ctx.fill();
              }
            }
            trail = trail.filter(p => p.alpha > 0.05);

            // Draw click ripple
            if (ripple) {
              ctx.beginPath();
              ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
              ctx.strokeStyle = \`rgba(245, 158, 11, \${ripple.alpha})\`;
              ctx.lineWidth = 2;
              ctx.stroke();
              ripple.radius += 2.5;
              ripple.alpha *= 0.88;
              if (ripple.alpha <= 0.05) ripple = null;
            }

            // Draw Cyberdeck Neon Arrow Pointer
            if (currentPos.x >= 0) {
              const cx = currentPos.x;
              const cy = currentPos.y;

              ctx.save();
              ctx.translate(cx, cy);
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(0, 16);
              ctx.lineTo(4, 12);
              ctx.lineTo(8, 19);
              ctx.lineTo(11, 17);
              ctx.lineTo(7, 10);
              ctx.lineTo(13, 10);
              ctx.closePath();
              ctx.fillStyle = currentPos.isCorrective ? '#f59e0b' : '#00d2ff';
              ctx.shadowColor = currentPos.isCorrective ? '#f59e0b' : '#00d2ff';
              ctx.shadowBlur = 10;
              ctx.fill();
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 1;
              ctx.stroke();
              ctx.restore();
            }

            requestAnimationFrame(render);
          }
          requestAnimationFrame(render);
        })()
      `, true);
    } catch {}
  }

  /**
   * Simulates a humanized click:
   * 1. Traverses to coordinates via Bézier path
   * 2. Dwells for human reaction duration (30-90ms)
   * 3. Sends mouseDown
   * 4. Holds button (40-80ms click dwell)
   * 5. Sends mouseUp
   */
  public async clickAt(
    webContents: WebContents,
    target: Point,
    options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }
  ): Promise<void> {
    const button = options?.button ?? 'left';
    const clickCount = options?.clickCount ?? 1;

    // Move to location
    await this.moveMouseTo(webContents, target);

    // Trigger visual in-page ripple
    webContents.executeJavaScript(
      `window.__kuangClickCursor && window.__kuangClickCursor(${target.x}, ${target.y})`,
      true
    ).catch(() => {});

    // Pre-click hesitation (mimicking visual confirmation)
    await sleep(35 + Math.random() * 55);

    // Mouse Down
    await this.dispatch(
      webContents,
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: target.x, y: target.y, button, buttons: 1, clickCount, pointerType: 'mouse' },
      () => {
        webContents.sendInputEvent({
          type: 'mouseDown',
          x: target.x,
          y: target.y,
          button,
          clickCount,
        });
      }
    );

    // Contact duration (finger depressing mouse switch)
    await sleep(45 + Math.random() * 45);

    // Mouse Up
    await this.dispatch(
      webContents,
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: target.x, y: target.y, button, buttons: 0, clickCount, pointerType: 'mouse' },
      () => {
        webContents.sendInputEvent({
          type: 'mouseUp',
          x: target.x,
          y: target.y,
          button,
          clickCount,
        });
      }
    );

    this.reporter?.onClick?.(target);

    // Post-click recovery pause
    await sleep(40 + Math.random() * 60);
  }

  /**
   * Types text with humanized cadence, realistic inter-key variance, and word pauses.
   */
  public async typeText(
    webContents: WebContents,
    text: string,
    options?: { baseSpeedWpm?: number }
  ): Promise<void> {
    this.ensureInputTarget(webContents);
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const d = keyDescriptor(char);

      const viaCdp = await this.cdp(webContents, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: d.key,
        code: d.code,
        windowsVirtualKeyCode: d.vk,
        nativeVirtualKeyCode: d.vk,
        text: char,
        unmodifiedText: char,
      });
      if (viaCdp) {
        this.lastInputTransport = 'cdp';
      } else {
        this.lastInputTransport = 'native';
        // Send keyDown
        webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: char,
        });

        // Send char input
        webContents.sendInputEvent({
          type: 'char',
          keyCode: char,
        });
      }

      await this.cdp(webContents, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: d.key,
        code: d.code,
        windowsVirtualKeyCode: d.vk,
        nativeVirtualKeyCode: d.vk,
      });
      if (!viaCdp) {
        // Send keyUp
        webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: char,
        });
      }

      // Variable inter-key latency (60-140ms, with extra pauses on spaces and punctuation)
      let delay = 60 + Math.floor(Math.random() * 70);
      if (char === ' ') {
        delay += 90 + Math.floor(Math.random() * 100); // Spacebar deliberation pause
      } else if (['.', ',', '!', '?', ';'].includes(char)) {
        delay += 140 + Math.floor(Math.random() * 150); // Punctuation pause
      }

      this.reporter?.onKey?.(char, delay);
      await sleep(delay);
    }
  }

  /**
   * Presses an individual key (e.g. 'Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown').
   */
  public async pressKey(webContents: WebContents, key: string): Promise<void> {
    this.ensureInputTarget(webContents);
    const d = keyDescriptor(key);
    const downViaCdp = await this.cdp(webContents, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: d.key,
      code: d.code,
      windowsVirtualKeyCode: d.vk,
      nativeVirtualKeyCode: d.vk,
    });
    this.lastInputTransport = downViaCdp ? 'cdp' : 'native';
    if (!downViaCdp) {
      webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: key,
      });
    }
    await sleep(40 + Math.random() * 30);
    await this.cdp(webContents, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: d.key,
      code: d.code,
      windowsVirtualKeyCode: d.vk,
      nativeVirtualKeyCode: d.vk,
    });
    if (!downViaCdp) {
      webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: key,
      });
    }
    this.reporter?.onKey?.(key, 50);
  }

  /**
   * Clears the *focused* field with a trusted select-all + delete (Ctrl+A, Backspace).
   *
   * Deliberately keyboard-driven rather than writing `el.value = ''`: a real keystroke fires a
   * genuine `input` event (so React/Vue controlled inputs actually update) and never sets
   * `isTrusted: false`, which is what trips behavioural bot sensors.
   */
  public async clearFocusedField(webContents: WebContents): Promise<void> {
    this.ensureInputTarget(webContents);
    const downViaCdp = await this.cdp(webContents, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2, // Ctrl
    });
    this.lastInputTransport = downViaCdp ? 'cdp' : 'native';
    if (!downViaCdp) {
      webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
    }
    await sleep(30 + Math.random() * 30);
    await this.cdp(webContents, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 2,
    });
    if (!downViaCdp) {
      webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
    }
    await this.pressKey(webContents, 'Backspace');
  }

  /**
   * Smoothly scrolls the page in incremental chunks simulating mousewheel inertia.
   */
  public async scrollPage(
    webContents: WebContents,
    deltaY: number,
    chunks: number = 8
  ): Promise<void> {
    this.ensureInputTarget(webContents);
    const step = Math.round(deltaY / chunks);
    for (let i = 0; i < chunks; i++) {
      await this.dispatch(
        webContents,
        'Input.dispatchMouseEvent',
        { type: 'mouseWheel', x: this.currentCursor.x, y: this.currentCursor.y, deltaX: 0, deltaY: -step, pointerType: 'mouse' },
        () => {
          webContents.sendInputEvent({
            type: 'mouseWheel',
            x: this.currentCursor.x,
            y: this.currentCursor.y,
            deltaX: 0,
            deltaY: -step,
            canScroll: true,
          });
        }
      );

      this.reporter?.onScroll?.(step);
      await sleep(25 + Math.random() * 20);
    }
  }
}
