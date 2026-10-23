import test from 'node:test';
import assert from 'node:assert/strict';
import { Crawler } from '../src/main/crawl/crawler.ts';

function deferredPage(url, links = []) {
  return { title: url, markdown: `# ${url}\n\ncontent`, links, status: 200 };
}

test('respects crawl concurrency and page budget', async () => {
  let active = 0;
  let maxActive = 0;
  const crawled = [];
  const crawler = new Crawler({
    renderPage: async (url) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      crawled.push(url);
      active--;
      if (url.endsWith('/')) return deferredPage(url, ['https://example.test/a', 'https://example.test/b', 'https://example.test/c']);
      return deferredPage(url);
    },
    tryLlm: async () => null,
    beforePage: () => undefined,
  });

  const result = await crawler.crawl({
    startUrl: 'https://example.test/',
    maxDepth: 1,
    maxPages: 3,
    concurrency: 3,
    delayMs: 0,
    preferLlm: false,
  });

  assert.equal(result.pageCount, 3);
  assert.ok(maxActive >= 2, `expected parallel fetches, maxActive=${maxActive}`);
  assert.equal(result.pages[0].url, 'https://example.test/');
  assert.equal(crawled.length, 3);
});

test('preferLlm uses the markdown path instead of rendering', async () => {
  let renders = 0;
  const crawler = new Crawler({
    tryLlm: async () => ({ content: '# Markdown\n\ncontent', via: 'net.fetch' }),
    renderPage: async (url) => {
      renders++;
      return deferredPage(url);
    },
  });

  const result = await crawler.crawl({
    startUrl: 'https://example.test/doc',
    maxDepth: 0,
    maxPages: 1,
    preferLlm: true,
  });

  assert.equal(result.pageCount, 1);
  assert.equal(result.pages[0].via, 'llm');
  assert.equal(renders, 0);
});

test('beforePage can skip a cooled-down host', async () => {
  let rendered = false;
  const crawler = new Crawler({
    beforePage: () => {
      const error = new Error('cooldown');
      error.code = 'RESEARCH_COOLDOWN';
      throw error;
    },
    renderPage: async (url) => {
      rendered = true;
      return deferredPage(url);
    },
  });

  const result = await crawler.crawl({
    startUrl: 'https://example.test/cooling',
    maxDepth: 0,
    maxPages: 1,
  });

  assert.equal(rendered, false);
  assert.equal(result.pageCount, 1);
  assert.match(result.pages[0].error || '', /cooldown/);
});
