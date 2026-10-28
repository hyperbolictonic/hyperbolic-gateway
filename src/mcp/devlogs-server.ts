import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { APP_VERSION } from '../shared/version.js';

const MAX_BYTES = 1_048_576;
const MAX_RESULTS = 200;
const LOG_NAME = /^[a-zA-Z0-9._-]+\.log$/;

if (process.env.HB_DEV_LOGS !== '1') {
  process.stderr.write('hb-devlogs is disabled. Set HB_DEV_LOGS=1 in a development MCP configuration.\n');
  process.exit(2);
}

const LOG_DIR = path.resolve(
  process.env.HB_DEVLOGS_DIR || path.join(process.env.HB_DATA_DIR || path.join(process.cwd(), 'data'), 'logs'),
);

function redact(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1<redacted>')
    .replace(/\b[a-f0-9]{64}\b/gi, '<redacted-token>')
    .replace(/((?:client_secret|secret|password|token|authorization)["'\s:=]+)[^\s"']+/gi, '$1<redacted>');
}

function resolveLog(name: string): string {
  if (!LOG_NAME.test(name)) throw new Error('Log name must be a simple *.log filename.');
  const directory = fs.realpathSync(LOG_DIR);
  const candidate = fs.realpathSync(path.join(directory, name));
  if (!candidate.startsWith(directory + path.sep)) throw new Error('Log path escapes the log directory.');
  if (!fs.statSync(candidate).isFile()) throw new Error('Log target is not a regular file.');
  return candidate;
}

function availableLogs(): Array<{ name: string; bytes: number; modified: string }> {
  try {
    return fs
      .readdirSync(LOG_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LOG_NAME.test(entry.name))
      .map((entry) => {
        const file = path.join(LOG_DIR, entry.name);
        const stat = fs.statSync(file);
        return { name: entry.name, bytes: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  } catch {
    return [];
  }
}

function readSlice(file: string, start: number, maxBytes: number): { text: string; end: number; truncated: boolean } {
  const stat = fs.statSync(file);
  const offset = Math.max(0, Math.min(start, stat.size));
  const length = Math.min(maxBytes, stat.size - offset);
  if (length <= 0) return { text: '', end: offset, truncated: false };
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, offset);
  } finally {
    fs.closeSync(fd);
  }
  return {
    text: buffer.toString('utf8'),
    end: offset + length,
    truncated: offset + length < stat.size,
  };
}

function readTail(file: string, tailLines: number, maxBytes: number): { text: string; end: number; truncated: boolean } {
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxBytes);
  const slice = readSlice(file, start, maxBytes);
  const lines = slice.text.split(/\r?\n/);
  return {
    text: lines.slice(-tailLines).join('\n'),
    end: stat.size,
    truncated: start > 0 || lines.length > tailLines,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const server = new McpServer({ name: 'hb-devlogs', version: APP_VERSION });

server.tool(
  'list_logs',
  'List allowlisted development log files, sizes, and modification times.',
  {},
  async () => {
    const logs = availableLogs();
    if (!logs.length) {
      return { content: [{ type: 'text' as const, text: `No log files found in ${LOG_DIR}.` }] };
    }
    const lines = logs.map((log) => `- ${log.name} — ${formatBytes(log.bytes)} — ${log.modified}`);
    return { content: [{ type: 'text' as const, text: `# Development logs\n\nDirectory: \`${LOG_DIR}\`\n\n${lines.join('\n')}` }] };
  },
);

server.tool(
  'read_log',
  'Read an allowlisted development log. Use tail for the last lines, or since_offset/next_offset to follow new output. Secrets are redacted.',
  {
    name: z.string().describe('Log filename, for example remote-server.log'),
    tail: z.coerce.number().int().min(1).max(2000).optional().describe('Number of trailing lines when since_offset is omitted (default 200)'),
    since_offset: z.coerce.number().int().min(0).optional().describe('Byte offset returned by a previous call; reads newer content'),
    grep: z.string().optional().describe('Only return lines containing this literal text'),
    case_sensitive: z.boolean().optional().describe('Use case-sensitive grep (default false)'),
    max_bytes: z.coerce.number().int().min(1024).max(MAX_BYTES).optional().describe('Maximum bytes to read (default 262144)'),
  },
  async ({ name, tail, since_offset, grep, case_sensitive, max_bytes }) => {
    try {
      const file = resolveLog(name);
      const limit = max_bytes ?? 262_144;
      const slice =
        since_offset !== undefined
          ? readSlice(file, since_offset, limit)
          : readTail(file, tail ?? 200, limit);
      let text = slice.text;
      if (grep) {
        const needle = case_sensitive ? grep : grep.toLowerCase();
        text = text
          .split(/\r?\n/)
          .filter((line) => (case_sensitive ? line : line.toLowerCase()).includes(needle))
          .join('\n');
      }
      const body = redact(text).slice(0, limit);
      const header = `# ${name}\n\nbytes=${slice.end} truncated=${slice.truncated} next_offset=${slice.end}\n\n`;
      return { content: [{ type: 'text' as const, text: `${header}${body || '(no matching lines)'}` }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `[devlogs] ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  },
);

server.tool(
  'search_logs',
  'Search allowlisted development logs with a literal query. Returns file and line references; secrets are redacted.',
  {
    query: z.string().min(1).describe('Literal text to find'),
    name: z.string().optional().describe('Limit to one log filename'),
    case_sensitive: z.boolean().optional().describe('Use case-sensitive matching (default false)'),
    max_results: z.coerce.number().int().min(1).max(MAX_RESULTS).optional().describe('Maximum matching lines (default 50)'),
  },
  async ({ query, name, case_sensitive, max_results }) => {
    try {
      const logs = name ? [name] : availableLogs().map((log) => log.name);
      const needle = case_sensitive ? query : query.toLowerCase();
      const results: string[] = [];
      for (const logName of logs) {
        const file = resolveLog(logName);
        const slice = readTail(file, 2000, 262_144);
        for (const [index, line] of slice.text.split(/\r?\n/).entries()) {
          const haystack = case_sensitive ? line : line.toLowerCase();
          if (!haystack.includes(needle)) continue;
          results.push(`${logName}:${index + 1}: ${redact(line)}`);
          if (results.length >= (max_results ?? 50)) break;
        }
        if (results.length >= (max_results ?? 50)) break;
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: results.length ? `# Log search\n\n${results.join('\n')}` : `No matches for "${query}".`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `[devlogs] ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  },
);

const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  process.stderr.write(`[hb-devlogs] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
