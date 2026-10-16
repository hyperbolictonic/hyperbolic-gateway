/**
 * Kuang Grade Mark Eleven - Cortex Markdown Chunker
 *
 * Slices long webpage markdown into semantic, indexable chunks
 * preserving heading hierarchy and paragraph boundaries.
 */

export interface PageChunk {
  chunkIndex: number;
  content: string;
}

export function chunkMarkdown(markdown: string, maxChunkSize = 750, overlap = 100): PageChunk[] {
  if (!markdown || markdown.trim().length === 0) {
    return [];
  }

  const clean = markdown.replace(/\r\n/g, '\n').trim();
  if (clean.length <= maxChunkSize) {
    return [{ chunkIndex: 0, content: clean }];
  }

  // Split on double newlines (paragraphs) or markdown headers
  const paragraphs = clean.split(/(?=\n#{1,4}\s)|\n\n+/);
  const chunks: PageChunk[] = [];
  let currentChunk = '';
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (currentChunk.length + trimmed.length + 2 <= maxChunkSize) {
      currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed;
    } else {
      if (currentChunk) {
        chunks.push({ chunkIndex: chunkIndex++, content: currentChunk });
        // Preserve a bit of trailing overlap context
        const words = currentChunk.split(/\s+/);
        const overlapText = words.slice(-Math.min(15, words.length)).join(' ');
        currentChunk = overlapText ? `... ${overlapText}\n\n${trimmed}` : trimmed;
      } else {
        // Single paragraph larger than maxChunkSize, slice directly
        chunks.push({ chunkIndex: chunkIndex++, content: trimmed.slice(0, maxChunkSize) });
        currentChunk = trimmed.slice(maxChunkSize - overlap);
      }
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({ chunkIndex: chunkIndex++, content: currentChunk.trim() });
  }

  return chunks;
}

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}
