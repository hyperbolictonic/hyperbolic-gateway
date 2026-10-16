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

    // Ensure links retain clean syntax
    this.turndown.addRule('cleanLinks', {
      filter: 'a',
      replacement: (content, node) => {
        const element = node as HTMLAnchorElement;
        const href = element.getAttribute('href');
        if (!href || href.startsWith('javascript:') || !content.trim()) {
          return content;
        }
        return `[${content.trim()}](${href})`;
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
    const htmlToConvert = parsed?.content || doc.body?.innerHTML || rawHtml;

    // Downsample HTML to clean GFM Markdown
    const rawMarkdown = this.turndown.turndown(htmlToConvert);

    // Clean multiple consecutive blank lines
    const compactedMarkdown = rawMarkdown.replace(/\n{3,}/g, '\n\n').trim();

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
