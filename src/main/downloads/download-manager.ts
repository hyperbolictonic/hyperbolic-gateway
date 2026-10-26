import fs from 'node:fs';
import path from 'node:path';
import type { Session, DownloadItem, WebContents } from 'electron';
import { cortex } from '../cortex/cortex-db.js';
import { dataPath } from '../data-paths.js';

export interface DownloadRecord {
  id: string;
  filename: string;
  savePath: string;
  mimeType: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  url: string;
  startTime: number;
  completedTime?: number;
}

export class DownloadManager {
  private downloadsDir: string;
  private records: Map<string, DownloadRecord> = new Map();
  private onDownloadCompleteCallbacks: Array<(record: DownloadRecord) => void> = [];

  constructor() {
    this.downloadsDir = dataPath('downloads');
    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }
  }

  public attachToSession(session: Session) {
    session.on('will-download', (event, item: DownloadItem, webContents: WebContents) => {
      const id = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const filename = item.getFilename();
      const savePath = path.join(this.downloadsDir, filename);

      item.setSavePath(savePath);

      const record: DownloadRecord = {
        id,
        filename,
        savePath,
        mimeType: item.getMimeType(),
        totalBytes: item.getTotalBytes(),
        receivedBytes: 0,
        state: 'progressing',
        url: item.getURL(),
        startTime: Date.now(),
      };

      this.records.set(id, record);

      item.on('updated', (evt, state) => {
        record.receivedBytes = item.getReceivedBytes();
        record.state = state === 'progressing' ? 'progressing' : 'interrupted';
      });

      item.once('done', async (evt, state) => {
        record.completedTime = Date.now();
        record.receivedBytes = item.getReceivedBytes();
        record.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';

        if (record.state === 'completed') {
          // Automatic ingestion of document into LanceDB Cortex
          await this.ingestDownloadedDocument(record).catch(() => {});

          for (const cb of this.onDownloadCompleteCallbacks) {
            cb(record);
          }
        }
      });
    });
  }

  public onDownloadComplete(callback: (record: DownloadRecord) => void) {
    this.onDownloadCompleteCallbacks.push(callback);
  }

  public getDownloads(): DownloadRecord[] {
    return Array.from(this.records.values()).sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  }

  public getDownload(filenameOrId: string): DownloadRecord | undefined {
    for (const record of this.records.values()) {
      if (record.id === filenameOrId || record.filename === filenameOrId) {
        return record;
      }
    }
    // Check if file exists on disk in downloads folder
    const diskPath = path.join(this.downloadsDir, filenameOrId);
    if (fs.existsSync(diskPath)) {
      const stat = fs.statSync(diskPath);
      return {
        id: `disk_${filenameOrId}`,
        filename: filenameOrId,
        savePath: diskPath,
        mimeType: 'application/octet-stream',
        totalBytes: stat.size,
        receivedBytes: stat.size,
        state: 'completed',
        url: `file://${diskPath}`,
        startTime: stat.birthtimeMs,
        completedTime: stat.mtimeMs,
      };
    }
    return undefined;
  }

  public async readDocumentContent(filenameOrId: string): Promise<{ filename: string; content: string; estimatedTokens: number; extension: string }> {
    const record = this.getDownload(filenameOrId);
    if (!record || !fs.existsSync(record.savePath)) {
      throw new Error(`Downloaded file not found: ${filenameOrId}`);
    }

    const ext = path.extname(record.filename).toLowerCase();
    const rawBuffer = fs.readFileSync(record.savePath);
    let parsedMarkdown = '';

    if (ext === '.csv' || ext === '.tsv') {
      parsedMarkdown = this.parseCsvToMarkdown(rawBuffer.toString('utf8'), ext === '.tsv' ? '\t' : ',');
    } else if (ext === '.json') {
      try {
        const obj = JSON.parse(rawBuffer.toString('utf8'));
        parsedMarkdown = `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``;
      } catch {
        parsedMarkdown = rawBuffer.toString('utf8');
      }
    } else if (ext === '.pdf') {
      parsedMarkdown = this.extractPdfText(rawBuffer);
    } else {
      parsedMarkdown = rawBuffer.toString('utf8');
    }

    const estimatedTokens = Math.ceil(parsedMarkdown.length / 4);
    return {
      filename: record.filename,
      content: parsedMarkdown,
      estimatedTokens,
      extension: ext,
    };
  }

  private parseCsvToMarkdown(raw: string, delimiter = ','): string {
    const lines = raw.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return '_Empty CSV/TSV table_';

    const parseRow = (line: string): string[] => {
      // Split preserving basic quotes
      const cells: string[] = [];
      let current = '';
      let insideQuote = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && (i === 0 || line[i - 1] !== '\\')) {
          insideQuote = !insideQuote;
        } else if (char === delimiter && !insideQuote) {
          cells.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current.trim().replace(/^"|"$/g, ''));
      return cells;
    };

    const header = parseRow(lines[0]);
    const separator = header.map(() => '---');
    const rows = lines.slice(1, 100).map((l) => parseRow(l)); // cap at 100 rows for token efficiency

    let md = `| ${header.join(' | ')} |\n| ${separator.join(' | ')} |\n`;
    for (const r of rows) {
      md += `| ${r.join(' | ')} |\n`;
    }

    if (lines.length > 101) {
      md += `\n_...[${lines.length - 101} additional rows truncated for token efficiency]_\n`;
    }

    return md;
  }

  private extractPdfText(buffer: Buffer): string {
    const str = buffer.toString('binary');
    // Extract plain text stream segments from PDF binary
    const textSegments: string[] = [];
    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
    let match: RegExpExecArray | null;

    while ((match = streamRegex.exec(str)) !== null) {
      const streamData = match[1];
      // Find BT (Begin Text) ... ET (End Text) blocks
      const textMatches = streamData.match(/\((.*?)\)\s*Tj/g);
      if (textMatches) {
        for (const tm of textMatches) {
          const clean = tm.replace(/^\(|\)\s*Tj$/g, '').trim();
          if (clean) textSegments.push(clean);
        }
      }
    }

    if (textSegments.length > 0) {
      return textSegments.join(' ');
    }

    // Fallback: search for readable printable ascii substrings
    const ascii = buffer.toString('utf8').replace(/[^\x20-\x7E\r\n\t]/g, ' ');
    const readable = ascii.split(/\s{2,}/).filter((s) => s.length > 8 && /[a-zA-Z]/.test(s));
    return readable.slice(0, 200).join('\n') || '_PDF document binary (contains non-extractable text streams or scanned images)_';
  }

  private async ingestDownloadedDocument(record: DownloadRecord) {
    try {
      const doc = await this.readDocumentContent(record.id);
      await cortex.indexPage(
        record.url,
        `[Download] ${record.filename}`,
        `# Downloaded Document: ${record.filename}\n\n${doc.content}`
      );
    } catch {
      // Ignore ingestion failures on non-textual files
    }
  }
}
