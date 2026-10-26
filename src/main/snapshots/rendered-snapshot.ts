import fs from 'node:fs';
import path from 'node:path';
import { WebContents } from 'electron';
import TurndownService from 'turndown';
import { dataPath } from '../data-paths.js';

export interface RenderedSnapshotOptions {
  format?: 'ax_tree' | 'markdown' | 'html' | 'unrendered_html';
  waitUntilIdleMs?: number;
  pierceShadowDom?: boolean;
  saveToDisk?: boolean;
  forceRerender?: boolean;
}

export interface RenderedSnapshotResult {
  format: 'ax_tree' | 'markdown' | 'html' | 'unrendered_html';
  url: string;
  title: string;
  timestamp: number;
  content: string;
  filePath?: string;
  stats: {
    nodeCount?: number;
    byteLength: number;
    estimatedTokens: number;
  };
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Clean up noisy tags from snapshot markdown
turndown.remove(['script', 'style', 'noscript']);

export class RenderedSnapshotEngine {
  /**
   * Captures a rendered or unrendered point-in-time snapshot of the given WebContents.
   */
  public static async capture(
    wc: WebContents,
    options: RenderedSnapshotOptions = {}
  ): Promise<RenderedSnapshotResult> {
    const format = options.format || 'ax_tree';
    const waitIdle = options.waitUntilIdleMs !== undefined ? options.waitUntilIdleMs : 400;
    const url = wc.getURL();
    const title = wc.getTitle();
    const timestamp = Date.now();

    // Force re-render / repaint if requested (non-destructive double-RAF to flush layout/compositor)
    if (options.forceRerender) {
      await wc.executeJavaScript(`
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
          });
        })
      `).catch(() => {});
    }

    // 1. Wait for render / hydration idle
    if (waitIdle > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitIdle));
    }

    let content = '';
    let nodeCount = 0;

    switch (format) {
      case 'unrendered_html': {
        // Raw, pre-mutation unrendered HTML source
        content = await wc.executeJavaScript('document.documentElement.outerHTML');
        break;
      }

      case 'ax_tree': {
        const axResult = await this.captureAxTree(wc);
        content = axResult.outline;
        nodeCount = axResult.nodeCount;
        break;
      }

      case 'markdown': {
        const renderedHtml = await this.captureRenderedHtml(wc, options.pierceShadowDom ?? true);
        content = turndown.turndown(renderedHtml);
        break;
      }

      case 'html':
      default: {
        content = await this.captureRenderedHtml(wc, options.pierceShadowDom ?? true);
        break;
      }
    }

    const byteLength = Buffer.byteLength(content, 'utf8');
    const estimatedTokens = Math.ceil(byteLength / 4);

    let filePath: string | undefined;
    if (options.saveToDisk) {
      const snapshotsDir = dataPath('snapshots');
      if (!fs.existsSync(snapshotsDir)) {
        fs.mkdirSync(snapshotsDir, { recursive: true });
      }
      const ext = format === 'html' ? 'html' : format === 'markdown' ? 'md' : 'txt';
      const safeName = `snapshot_${timestamp}_${encodeURIComponent(title.slice(0, 30)).replace(/%/g, '')}.${ext}`;
      filePath = path.join(snapshotsDir, safeName);
      fs.writeFileSync(filePath, content, 'utf8');
    }

    return {
      format,
      url,
      title,
      timestamp,
      content,
      filePath,
      stats: {
        nodeCount: nodeCount || undefined,
        byteLength,
        estimatedTokens,
      },
    };
  }

  /**
   * Captures the full Accessibility Tree via Chrome DevTools Protocol (CDP)
   * and distills it into an ultra-clean, token-efficient semantic outline.
   */
  private static async captureAxTree(wc: WebContents): Promise<{ outline: string; nodeCount: number }> {
    let attachedLocally = false;
    if (!wc.debugger.isAttached()) {
      try {
        wc.debugger.attach('1.3');
        attachedLocally = true;
      } catch {
        // Fallback to JS-based AX extractor if debugger cannot be attached
        return this.captureJsAxFallback(wc);
      }
    }

    try {
      await wc.debugger.sendCommand('Accessibility.enable');
      const res: any = await wc.debugger.sendCommand('Accessibility.getFullAXTree', {});
      const nodes: any[] = res?.nodes || [];

      if (!nodes || nodes.length === 0) {
        return this.captureJsAxFallback(wc);
      }

      const distilled = this.distillAxNodes(nodes);
      return {
        outline: distilled,
        nodeCount: nodes.length,
      };
    } catch {
      return this.captureJsAxFallback(wc);
    } finally {
      if (attachedLocally && wc.debugger.isAttached()) {
        try {
          await wc.debugger.sendCommand('Accessibility.disable');
          wc.debugger.detach();
        } catch {}
      }
    }
  }

  /**
   * Converts raw CDP AXNode list into a clean, indented semantic hierarchy.
   */
  private static distillAxNodes(nodes: any[]): string {
    const lines: string[] = [];
    const significantRoles = new Set([
      'button', 'link', 'combobox', 'searchbox', 'textbox', 'checkbox', 'radio',
      'menuitem', 'option', 'tab', 'heading', 'navigation', 'main', 'article',
      'dialog', 'alertdialog', 'alert', 'row', 'gridcell', 'cell', 'table', 'treeitem'
    ]);

    for (const node of nodes) {
      if (node.ignored) continue;
      const role = node.role?.value || '';
      const name = node.name?.value || '';
      const value = node.value?.value || '';
      const description = node.description?.value || '';

      // Skip non-significant structural containers with no text
      if (!significantRoles.has(role) && !name && !value) {
        continue;
      }

      const flags: string[] = [];
      if (node.properties) {
        for (const prop of node.properties) {
          const pName = prop.name;
          const pVal = prop.value?.value;
          if (pVal === true) flags.push(pName);
          else if (pVal && pVal !== false && typeof pVal !== 'object') flags.push(`${pName}="${pVal}"`);
        }
      }

      const parts: string[] = [];
      parts.push(`[${role.toUpperCase()}]`);
      if (name) parts.push(`"${name.replace(/\n+/g, ' ').trim()}"`);
      if (value) parts.push(`{value="${String(value).trim()}"}`);
      if (flags.length > 0) parts.push(`(${flags.join(', ')})`);
      if (description && description !== name) parts.push(`— ${description.slice(0, 80)}`);

      lines.push(parts.join(' '));
    }

    return lines.slice(0, 250).join('\n');
  }

  /**
   * Client-side JS fallback for extracting accessibility outline if CDP is unavailable.
   */
  private static async captureJsAxFallback(wc: WebContents): Promise<{ outline: string; nodeCount: number }> {
    const js = `
      (() => {
        const interactive = document.querySelectorAll('button, a, input, select, textarea, [role], h1, h2, h3, [tabindex]');
        const lines = [];
        let count = 0;
        for (const el of interactive) {
          if (count++ > 200) break;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          const tag = el.tagName;
          const role = el.getAttribute('role') || tag.toLowerCase();
          const name = el.getAttribute('aria-label') || el.innerText?.slice(0, 60)?.trim() || el.getAttribute('placeholder') || '';
          const val = el.value || el.getAttribute('aria-valuenow') || '';
          const expanded = el.getAttribute('aria-expanded');
          const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

          const parts = ['[' + role.toUpperCase() + ']'];
          if (name) parts.push('"' + name.replace(/\\n+/g, ' ') + '"');
          if (val) parts.push('{value="' + val + '"}');
          if (expanded !== null) parts.push('(expanded=' + expanded + ')');
          if (disabled) parts.push('(disabled)');

          lines.push(parts.join(' '));
        }
        return { outline: lines.join('\\n'), nodeCount: interactive.length };
      })()
    `;
    const res = await wc.executeJavaScript(js);
    return res || { outline: 'No interactive elements found', nodeCount: 0 };
  }

  /**
   * Injects JS to extract rendered DOM with Shadow DOM piercer and form values baked in.
   */
  private static async captureRenderedHtml(wc: WebContents, pierceShadow: boolean): Promise<string> {
    const script = `
      (() => {
        function serialize(root) {
          const clone = root.cloneNode(true);

          // Bake live input values into attributes so they survive HTML serialization
          const liveInputs = root.querySelectorAll('input, textarea, select');
          const cloneInputs = clone.querySelectorAll('input, textarea, select');
          for (let i = 0; i < liveInputs.length; i++) {
            const live = liveInputs[i];
            const target = cloneInputs[i];
            if (!target) continue;
            if (live.type === 'checkbox' || live.type === 'radio') {
              if (live.checked) target.setAttribute('checked', '');
              else target.removeAttribute('checked');
            } else if (live.value) {
              target.setAttribute('value', live.value);
            }
          }

          ${pierceShadow ? `
          // Expand Shadow Roots into inline custom templates
          const allWithShadow = root.querySelectorAll('*');
          for (const el of allWithShadow) {
            if (el.shadowRoot) {
              const shadowHtml = el.shadowRoot.innerHTML;
              const shadowWrapper = document.createElement('div');
              shadowWrapper.setAttribute('data-shadow-root', 'open');
              shadowWrapper.innerHTML = shadowHtml;
              const selector = el.id ? '#' + el.id : el.tagName.toLowerCase();
              const match = clone.querySelector(selector);
              if (match) match.appendChild(shadowWrapper);
            }
          }
          ` : ''}

          return clone.innerHTML;
        }

        return serialize(document.body || document.documentElement);
      })()
    `;
    return (await wc.executeJavaScript(script)) || '';
  }
}
