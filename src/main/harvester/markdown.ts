import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import type { HarvestedConstruct } from '../../shared/types.js';

export class ConstructHarvester {
  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
    });

    // Strip unhelpful noise tags
    this.turndown.remove(['script', 'style', 'noscript', 'iframe', 'canvas', 'svg'] as any);

    // Ensure links retain clean syntax, with [#ID] badge prefix if marked
    this.turndown.addRule('cleanLinks', {
      filter: 'a',
      replacement: (content, node) => {
        const element = node as HTMLAnchorElement;
        const href = element.getAttribute('href');
        const markId = element.getAttribute('data-mark-id');
        const markPrefix = markId ? `[#${markId}] ` : '';
        if (!href || href.startsWith('javascript:') || !content.trim()) {
          return markPrefix + content;
        }
        return `${markPrefix}[${content.trim()}](${href})`;
      },
    });

    // Annotate buttons with [#ID]
    this.turndown.addRule('markedButtons', {
      filter: 'button',
      replacement: (content, node) => {
        const element = node as HTMLButtonElement;
        const markId = element.getAttribute('data-mark-id');
        const text = content.trim() || element.getAttribute('aria-label') || element.getAttribute('title') || 'Button';
        return markId ? `[#${markId}] <button>${text}</button>` : `<button>${text}</button>`;
      },
    });

    // Annotate input/select/textarea controls with [#ID]
    this.turndown.addRule('markedInputs', {
      filter: ['input', 'select', 'textarea'],
      replacement: (_content, node) => {
        const element = node as HTMLElement;
        const markId = element.getAttribute('data-mark-id');
        const tag = element.tagName.toLowerCase();
        const type = element.getAttribute('type') || 'text';
        const name = element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.getAttribute('name') || '';
        const value = (element as any).value || element.getAttribute('value') || '';
        const labelStr = name ? ` "${name}"` : '';
        const valStr = value ? ` value="${value}"` : '';
        const prefix = markId ? `[#${markId}] ` : '';
        return `${prefix}<${tag} type="${type}"${labelStr}${valStr}>`;
      },
    });
  }

  /**
   * Downsamples raw active DOM HTML into an ultra-clean, token-efficient Markdown construct with front-matter.
   */
  public harvest(rawHtml: string, currentUrl: string, fallbackTitle?: string): HarvestedConstruct {
    const dom = new JSDOM(rawHtml, { url: currentUrl });
    const doc = dom.window.document;

    // Use Mozilla Readability to isolate article content and strip sidebars/ads
    const reader = new Readability(doc);
    const parsed = reader.parse();

    const title = parsed?.title || doc.title || fallbackTitle || 'Untitled Matrix Node';

    // Strip heavy non-content tags before converting to markdown
    const tagsToRemove = ['script', 'style', 'svg', 'noscript', 'iframe', 'canvas', 'template'];
    tagsToRemove.forEach(tag => {
      doc.querySelectorAll(tag).forEach(el => el.remove());
    });

    // Detect if Readability over-pruned an aggregator/portal page (e.g. Google News, Skyscanner, search listings)
    const bodyTextLen = doc.body?.textContent?.trim().length || 0;
    const readabilityTextLen = parsed?.textContent?.trim().length || 0;
    const isAggregatorOrPortal = readabilityTextLen < 250 || (bodyTextLen > 600 && readabilityTextLen < bodyTextLen * 0.35);

    const htmlToConvert = (!isAggregatorOrPortal && parsed?.content) ? parsed.content : (doc.body?.innerHTML || rawHtml);

    // Downsample HTML to clean GFM Markdown
    const rawMarkdown = this.turndown.turndown(htmlToConvert);

    // Clean multiple consecutive blank lines
    let compactedMarkdown = rawMarkdown.replace(/\n{3,}/g, '\n\n').trim();
    const MAX_CONSTRUCT_CHARS = 25000;
    if (compactedMarkdown.length > MAX_CONSTRUCT_CHARS) {
      compactedMarkdown = compactedMarkdown.slice(0, MAX_CONSTRUCT_CHARS) + '\n\n... [Construct downsampled: showing first 25000 characters to preserve context]';
    }

    // Approximate token count (~4 characters per token heuristic)
    const estimatedTokens = Math.ceil(compactedMarkdown.length / 4);
    const timestamp = new Date().toISOString();

    // Envelope Front-Matter
    const envelope = [
      '---',
      'designation: "KUANG_GRADE_MARK_ELEVEN_CONSTRUCT"',
      `source_url: "${currentUrl}"`,
      `title: "${title.replace(/"/g, '\\"')}"`,
      `harvested_at: "${timestamp}"`,
      `raw_bytes: ${rawHtml.length}`,
      `construct_bytes: ${compactedMarkdown.length}`,
      `estimated_tokens: ${estimatedTokens}`,
      'compression_ratio: "' + ((compactedMarkdown.length / (rawHtml.length || 1)) * 100).toFixed(1) + '%"',
      '---',
      '',
      `# ${title}`,
      '',
      compactedMarkdown,
    ].join('\n');

    return {
      url: currentUrl,
      title,
      timestamp,
      rawHtmlLength: rawHtml.length,
      markdownLength: envelope.length,
      estimatedTokens,
      content: envelope,
    };
  }
}
