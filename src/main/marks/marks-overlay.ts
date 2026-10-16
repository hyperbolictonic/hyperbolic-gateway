import type { WebContents } from 'electron';

export interface MarkItem {
  id: number;
  tag: string;
  type?: string;
  text: string;
  role?: string;
  rect: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
}

export class MarksOverlay {
  private activeMarks: Map<number, MarkItem> = new Map();

  /**
   * Scans the active WebContents DOM for visible interactive elements,
   * injects neon visual badges ([1], [2], [3]...), and returns structured mark metadata.
   */
  public async injectMarks(wc: WebContents): Promise<MarkItem[]> {
    if (!wc || wc.isDestroyed()) return [];

    const script = `
      (() => {
        // Remove existing overlay if present
        const old = document.getElementById('mark-eleven-som-container');
        if (old) old.remove();

        const container = document.createElement('div');
        container.id = 'mark-eleven-som-container';
        container.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;';
        document.documentElement.appendChild(container);

        const candidates = document.querySelectorAll(
          'a[href], button, input, select, textarea, details, summary, [role="button"], [role="link"], [role="checkbox"], [role="combobox"], [role="tab"], [role="menuitem"], [onclick], [tabindex="0"]'
        );

        const marks = [];
        let markId = 1;

        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          // Filter invisible or zero-size elements
          if (rect.width < 6 || rect.height < 6) continue;
          if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
          if (rect.right < 0 || rect.left > window.innerWidth) continue;

          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

          // Compute readable label
          let label = el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('value') || el.getAttribute('title') || '';
          label = label.replace(/\\s+/g, ' ').trim().slice(0, 50);

          el.setAttribute('data-mark-id', String(markId));

          // Create badge element
          const badge = document.createElement('div');
          badge.className = 'mark-eleven-badge';
          badge.textContent = String(markId);
          badge.style.cssText = \`
            position: fixed;
            top: \${Math.max(0, rect.top)}px;
            left: \${Math.max(0, rect.left)}px;
            background: #eab308;
            color: #09090b;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11px;
            font-weight: 800;
            line-height: 1;
            padding: 2px 4px;
            border-radius: 3px;
            box-shadow: 0 0 6px rgba(0, 0, 0, 0.9), 0 0 10px rgba(234, 179, 8, 0.6);
            border: 1px solid #ca8a04;
            pointer-events: none;
            z-index: 2147483647;
          \`;

          // Subtle box outline
          const box = document.createElement('div');
          box.style.cssText = \`
            position: fixed;
            top: \${rect.top}px;
            left: \${rect.left}px;
            width: \${rect.width}px;
            height: \${rect.height}px;
            border: 1px dashed rgba(234, 179, 8, 0.7);
            pointer-events: none;
            box-sizing: border-box;
            z-index: 2147483646;
          \`;

          container.appendChild(box);
          container.appendChild(badge);

          marks.push({
            id: markId,
            tag: el.tagName.toUpperCase(),
            type: (el.getAttribute('type') || '').toLowerCase() || undefined,
            text: label,
            role: el.getAttribute('role') || undefined,
            rect: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            center: {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
            },
          });

          markId++;
          if (markId > 99) break; // Limit to 99 most visible elements to keep tokens minimal
        }

        return marks;
      })()
    `;

    try {
      const marks: MarkItem[] = await wc.executeJavaScript(script);
      this.activeMarks.clear();
      for (const m of marks) {
        this.activeMarks.set(m.id, m);
      }
      return marks;
    } catch (err: any) {
      console.warn(`[MarksOverlay] Failed to inject marks: ${err?.message || err}`);
      return [];
    }
  }

  /**
   * Cleans up the ephemeral visual badges from the DOM.
   */
  public async removeMarks(wc: WebContents): Promise<void> {
    if (!wc || wc.isDestroyed()) return;
    try {
      await wc.executeJavaScript(`
        (() => {
          const old = document.getElementById('mark-eleven-som-container');
          if (old) old.remove();
        })()
      `);
    } catch {}
  }

  /**
   * Gets mark metadata and current coordinates for a specific mark ID.
   */
  public async getMarkTarget(wc: WebContents, markId: number): Promise<{ mark: MarkItem; currentCenter: { x: number; y: number } } | null> {
    const cached = this.activeMarks.get(markId);

    // Query live coordinates from DOM in case page has scrolled slightly
    if (wc && !wc.isDestroyed()) {
      try {
        const liveInfo = await wc.executeJavaScript(`
          (() => {
            const el = document.querySelector('[data-mark-id="${markId}"]');
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
            };
          })()
        `);
        if (liveInfo) {
          return {
            mark: cached || {
              id: markId,
              tag: 'ELEMENT',
              text: '',
              rect: { x: liveInfo.x, y: liveInfo.y, width: 0, height: 0 },
              center: liveInfo,
            },
            currentCenter: liveInfo,
          };
        }
      } catch {}
    }

    if (cached) {
      return { mark: cached, currentCenter: cached.center };
    }

    return null;
  }

  /**
   * Returns list of currently buffered marks.
   */
  public getActiveMarks(): MarkItem[] {
    return Array.from(this.activeMarks.values());
  }
}
