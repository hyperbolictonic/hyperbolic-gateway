import type { WebContents } from 'electron';
import { generateOrganicTrajectory, type Point, type PathStep, type ChaosKinematicsOptions } from './bezier.js';

export interface InputTelemetryReporter {
  onMouseMove?: (point: Point, velocity: number) => void;
  onClick?: (point: Point) => void;
  onKey?: (char: string, delay: number) => void;
  onScroll?: (deltaY: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HumanizedInputSimulator {
  private currentCursor: Point = { x: 100, y: 100 };

  constructor(private reporter?: InputTelemetryReporter) {}

  public getCursorPosition(): Point {
    return { ...this.currentCursor };
  }

  /**
   * Moves the mouse smoothly along an organic Bézier trajectory to target coordinates.
   */
  public async moveMouseTo(
    webContents: WebContents,
    target: Point,
    options?: ChaosKinematicsOptions
  ): Promise<void> {
    const trajectory = generateOrganicTrajectory(this.currentCursor, target, options);

    for (const step of trajectory) {
      webContents.sendInputEvent({
        type: 'mouseMove',
        x: step.x,
        y: step.y,
        movementX: step.x - this.currentCursor.x,
        movementY: step.y - this.currentCursor.y,
      });

      this.currentCursor = { x: step.x, y: step.y };
      this.reporter?.onMouseMove?.(this.currentCursor, step.velocity);

      await sleep(step.delayMs);
    }
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

    // Pre-click hesitation (mimicking visual confirmation)
    await sleep(35 + Math.random() * 55);

    // Mouse Down
    webContents.sendInputEvent({
      type: 'mouseDown',
      x: target.x,
      y: target.y,
      button,
      clickCount,
    });

    // Contact duration (finger depressing mouse switch)
    await sleep(45 + Math.random() * 45);

    // Mouse Up
    webContents.sendInputEvent({
      type: 'mouseUp',
      x: target.x,
      y: target.y,
      button,
      clickCount,
    });

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
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

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

      // Send keyUp
      webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: char,
      });

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
    webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: key,
    });
    await sleep(40 + Math.random() * 30);
    webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: key,
    });
    this.reporter?.onKey?.(key, 50);
  }

  /**
   * Smoothly scrolls the page in incremental chunks simulating mousewheel inertia.
   */
  public async scrollPage(
    webContents: WebContents,
    deltaY: number,
    chunks: number = 8
  ): Promise<void> {
    const step = Math.round(deltaY / chunks);
    for (let i = 0; i < chunks; i++) {
      webContents.sendInputEvent({
        type: 'mouseWheel',
        x: this.currentCursor.x,
        y: this.currentCursor.y,
        deltaX: 0,
        deltaY: -step,
        canScroll: true,
      });

      this.reporter?.onScroll?.(step);
      await sleep(25 + Math.random() * 20);
    }
  }
}
