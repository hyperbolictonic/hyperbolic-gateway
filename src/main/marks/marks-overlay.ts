import type { WebContents } from 'electron';

export interface MarkItem {
  id: number;
  tag: string;
  type?: string;
  text: string;
  role?: string;
  /** Accessibility / widget state flags, e.g. "disabled,expanded=false,checked,required". */
  state?: string;
  /** Current value of form controls (never populated for password inputs). */
  value?: string;
  rect: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
}

export class MarksOverlay {
  private activeMarks: Map<number, MarkItem> = new Map();

  /**
   * Scans the active WebContents DOM for visible interactive elements,
   * injects neon visual badges ([1], [2], [3]...), and returns structured mark metadata.
   *
   * Detection layers:
   *  1. Semantic HTML + ARIA roles (button, link, combobox, option, menuitem, switch, ...).
   *  2. ARIA state attributes (aria-haspopup, aria-expanded) for custom widgets.
   *  3. A `cursor: pointer` heuristic for framework-built clickable <div>/<span> widgets
   *     that carry no role at all (outermost pointer element only).
   * Elements covered by something else (modals, open dropdown panels) are skipped via an
   * elementFromPoint occlusion check, and elements inside open popups are numbered first so
   * dropdown options are never crowded out by the 99-mark cap.
   * Labels use the accessible-name algorithm (aria-label, aria-labelledby, <label>, text, alt...).
   */
  public async injectMarks(wc: WebContents): Promise<MarkItem[]> {
    if (!wc || wc.isDestroyed()) return [];

    const script = `
      (() => {
        // Clear stale marks from previous scans so data-mark-id lookups can never collide
        document.querySelectorAll('[data-mark-id]').forEach((n) => n.removeAttribute('data-mark-id'));

        // Remove existing overlay if present
        const old = document.getElementById('mark-eleven-som-container');
        if (old) old.remove();

        const container = document.createElement('div');
        container.id = 'mark-eleven-som-container';
        container.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;';
        document.documentElement.appendChild(container);

        const SEMANTIC = 'a[href], button, input:not([type="hidden"]), select, textarea, details, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="option"], [role="treeitem"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="slider"], [role="spinbutton"], [role="searchbox"], [role="textbox"], [aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded], [onclick], [tabindex="0"]';
        const POPUP = '[role="listbox"], [role="menu"], [role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open], [role="tooltip"], [data-radix-popper-content-wrapper], [data-radix-portal], .MuiPopover-root, .MuiMenu-root, .ant-select-dropdown, .select2-dropdown';
        const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();

        const isVisible = (el, rect) => {
          if (rect.width < 6 || rect.height < 6) return false;
          if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
          if (rect.right < 0 || rect.left > window.innerWidth) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          if (el.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
          return true;
        };

        // Accessible-name computation (simplified)
        const accName = (el) => {
          let n = clean(el.getAttribute('aria-label'));
          if (n) return n;
          const lb = el.getAttribute('aria-labelledby');
          if (lb) {
            n = clean(lb.split(/\\s+/).map((id) => {
              const t = document.getElementById(id);
              return t ? (t.innerText || t.textContent || '') : '';
            }).join(' '));
            if (n) return n;
          }
          if (el.labels && el.labels.length) {
            n = clean(Array.from(el.labels).map((l) => l.innerText || l.textContent || '').join(' '));
            if (n) return n;
          }
          n = clean(el.innerText);
          if (n) return n;
          const isPassword = (el.getAttribute('type') || '').toLowerCase() === 'password';
          for (const attr of ['placeholder', 'title', 'alt', 'name']) {
            n = clean(el.getAttribute(attr));
            if (n) return n;
          }
          if (!isPassword) {
            n = clean(el.getAttribute('value'));
            if (n) return n;
          }
          const inner = el.querySelector('img[alt], svg title, [aria-label]');
          if (inner) {
            n = clean(inner.getAttribute('alt') || inner.getAttribute('aria-label') || inner.textContent);
            if (n) return n;
          }
          return '';
        };

        // ARIA / widget state flags
        const stateOf = (el) => {
          const s = [];
          const a = (name) => el.getAttribute(name);
          if (el.disabled || a('aria-disabled') === 'true') s.push('disabled');
          if (a('aria-expanded') !== null) s.push('expanded=' + a('aria-expanded'));
          if (el.checked === true || a('aria-checked') === 'true') s.push('checked');
          else if (a('aria-checked') === 'mixed') s.push('checked=mixed');
          if (a('aria-selected') === 'true') s.push('selected');
          if (a('aria-pressed') !== null) s.push('pressed=' + a('aria-pressed'));
          if (a('aria-current') && a('aria-current') !== 'false') s.push('current');
          if (el.required || a('aria-required') === 'true') s.push('required');
          if (a('aria-invalid') === 'true') s.push('invalid');
          if (a('aria-haspopup') && a('aria-haspopup') !== 'false') s.push('haspopup=' + a('aria-haspopup'));
          if (el.readOnly) s.push('readonly');
          return s.join(',');
        };

        const valueOf = (el) => {
          const tag = el.tagName.toUpperCase();
          if ((el.getAttribute('type') || '').toLowerCase() === 'password') return undefined;
          let v;
          if (tag === 'SELECT') {
            const opt = el.options && el.options[el.selectedIndex];
            v = opt ? opt.text : '';
          } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
            const t = (el.getAttribute('type') || 'text').toLowerCase();
            if (t === 'checkbox' || t === 'radio' || t === 'button' || t === 'submit') return undefined;
            v = el.value;
          } else if (el.getAttribute('aria-valuenow') !== null) {
            v = el.getAttribute('aria-valuenow');
          } else {
            return undefined;
          }
          v = clean(v);
          return v ? v.slice(0, 50) : undefined;
        };

        // 1. Gather candidates (semantic first, then cursor:pointer heuristic)
        const seen = new Set();
        const candidates = [];
        for (const el of document.querySelectorAll(SEMANTIC)) {
          seen.add(el);
          candidates.push(el);
        }
        let scanned = 0;
        for (const el of document.querySelectorAll('div, span, li, td, img, svg, label, i, p')) {
          if (++scanned > 4000) break;
          if (seen.has(el) || el.id === 'mark-eleven-som-container' || el.closest('#mark-eleven-som-container')) continue;
          if (el.closest(SEMANTIC)) continue; // already covered by a semantic ancestor
          const style = window.getComputedStyle(el);
          if (style.cursor !== 'pointer') continue;
          const parent = el.parentElement;
          if (parent && window.getComputedStyle(parent).cursor === 'pointer') continue; // outermost only
          seen.add(el);
          candidates.push(el);
        }

        // 2. Filter (visibility + occlusion) and classify
        const items = [];
        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          if (!isVisible(el, rect)) continue;
          const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
          const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
          const hit = document.elementFromPoint(cx, cy);
          if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) continue; // covered by something else
          items.push({ el, rect, popup: !!el.closest(POPUP) });
        }

        // 3. Popup contents first (stable sort keeps DOM order within each group)
        items.sort((a, b) => (a.popup === b.popup ? 0 : a.popup ? -1 : 1));

        const marks = [];
        let markId = 1;
        for (const { el, rect } of items) {
          const label = accName(el).slice(0, 50);
          const state = stateOf(el);
          const value = valueOf(el);
          const disabled = state.split(',').includes('disabled');

          el.setAttribute('data-mark-id', String(markId));

          // Create badge element
          const badge = document.createElement('div');
          badge.className = 'mark-eleven-badge';
          badge.textContent = String(markId);
          badge.style.cssText = \`
            position: fixed;
            top: \${Math.max(0, rect.top)}px;
            left: \${Math.max(0, rect.left)}px;
            background: \${disabled ? '#a1a1aa' : '#eab308'};
            color: #09090b;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11px;
            font-weight: 800;
            line-height: 1;
            padding: 2px 4px;
            border-radius: 3px;
            box-shadow: 0 0 6px rgba(0, 0, 0, 0.9), 0 0 10px rgba(234, 179, 8, 0.6);
            border: 1px solid \${disabled ? '#71717a' : '#ca8a04'};
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
            border: 1px dashed \${disabled ? 'rgba(161, 161, 170, 0.7)' : 'rgba(234, 179, 8, 0.7)'};
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
            state: state || undefined,
            value,
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
          if (markId > 99) break; // Limit to 99 most relevant elements to keep tokens minimal
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
