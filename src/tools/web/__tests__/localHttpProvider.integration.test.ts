import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResolvedWebHost } from '../shared/urlPolicy';
import { MemoryWebCache } from '../shared/cache/adapters/memoryWebCache';
import { createWebCacheRuntime } from '../shared/cache/webCacheFactory';
import { STABLE_WEB_DOCUMENT_CACHE_TTL_MS } from '../shared/cache/functions/cacheTtl';
import { runReadWebPage } from '../webread/orchestration/readWebPage';
import { LocalHttpProvider } from '../webread/providers/localHttp';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../domains/citation';
import { createCitationRefAllocatorFixture } from '../../../domains/citation/testkit/citationRefAllocatorFixture';

describe('LocalHttpProvider 本地真实 HTTP 集成', () => {
  let server: Server;
  let port = 0;
  let requestCount = 0;
  let etagRequestCount = 0;
  let latestIfNoneMatch: string | undefined;
  let negotiatedIfNoneMatch: string | undefined;
  let negotiatedRequests = 0;
  let malformedGovernmentHtml = '';

  beforeAll(async () => {
    malformedGovernmentHtml = await readFile(
      new URL('./fixtures/html/malformed-government-template.html', import.meta.url),
      'utf-8'
    );
    server = createServer((request, response) => {
      requestCount += 1;
      if (request.url === '/negotiated') {
        negotiatedRequests += 1;
        negotiatedIfNoneMatch = request.headers['if-none-match'];
        const markdown = request.headers.accept?.includes('text/markdown') === true;
        const etag = markdown ? '"md-v1"' : '"html-v1"';
        if (negotiatedIfNoneMatch === etag) {
          response.writeHead(304, { ETag: etag, Vary: 'Accept' });
          response.end();
          return;
        }
        response.writeHead(200, { 'Content-Type': markdown ? 'text/markdown' : 'text/html', ETag: etag, Vary: 'Accept' });
        response.end(markdown ? '# Source data\n\n[Original](https://example.com/data)\n\n~~113 GW~~ → 83 GW' : '<p>HTML variant</p>');
        return;
      }
      if (request.url === '/redirect-content') {
        response.writeHead(302, { Location: '/reports/current' });
        response.end();
        return;
      }
      if (request.url === '/reports/current') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`<article><h1>Revised calculation</h1><p>${'Published calculation. '.repeat(30)}</p>
          <p><a href="data.csv">Original data</a>: <del>113 GW</del> 83 GW</p>
          <pre><code>if ready:\n    output = 83</code></pre></article>`);
        return;
      }
      if (request.url === '/etag') {
        etagRequestCount += 1;
        const header = request.headers['if-none-match'];
        latestIfNoneMatch = Array.isArray(header) ? header.join(', ') : header;
        if (latestIfNoneMatch === '"article-v1"') {
          response.writeHead(304, { ETag: '"article-v1"' });
          response.end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          ETag: '"article-v1"',
          'Last-Modified': 'Fri, 17 Jul 2026 12:00:00 GMT',
        });
        response.end(
          `<!doctype html><html><head><title>Conditional Article</title></head><body><article><h1>Conditional Article</h1><p>${'条件请求复用的正文。'.repeat(50)}</p></article></body></html>`
        );
        return;
      }
      if (request.url === '/plain') {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('纯文本页面内容');
        return;
      }
      if (request.url === '/pdf') {
        response.writeHead(200, { 'Content-Type': 'application/pdf' });
        response.end('%PDF-provider-fixture');
        return;
      }
      if (request.url === '/semantic') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(
          `<!doctype html><html><head><title>Semantic App</title></head><body><main><h1>Semantic App Content</h1><textarea readonly>${'语义主区域正文。'.repeat(100)}</textarea></main></body></html>`
        );
        return;
      }
      if (request.url === '/malformed-government-template') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(malformedGovernmentHtml);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        `<!doctype html><html lang="zh-CN"><head><title>Provider Article</title></head><body><article><h1>Provider Article</h1><p>${'本地 provider 正文内容。'.repeat(40)}</p></article></body></html>`
      );
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Provider 测试服务未返回 TCP 地址。');
    port = address.port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  });

  const resolveFixtureHost = async (url: URL): Promise<ResolvedWebHost> => ({
    hostname: url.hostname,
    addresses: [{ address: '127.0.0.1', family: 4 }],
  });

  it('真实贯通 GET 抓取、HTML 抽取和统一 Provider 结果', async () => {
    const provider = new LocalHttpProvider({ resolveHost: resolveFixtureHost });
    const result = await provider.read({ url: `http://provider.test:${port}/article` });
    expect(result).toMatchObject({
      title: 'Provider Article',
      extractor: 'readability',
      renderMode: 'http',
      contentType: 'text/html; charset=utf-8',
      qualityScore: 1,
    });
    expect(result.content).toContain('本地 provider 正文内容');
  });

  it('文本类型直接读取，二进制类型返回明确的不支持终态', async () => {
    const provider = new LocalHttpProvider({ resolveHost: resolveFixtureHost });
    const text = await provider.read({ url: `http://provider.test:${port}/plain` });
    expect(text).toMatchObject({ extractor: 'raw_text', content: '纯文本页面内容' });
    await expect(provider.read({ url: `http://provider.test:${port}/pdf` })).rejects.toMatchObject({
      kind: 'unsupported_mime',
      message: 'WebRead 暂不支持 PDF，请改用对应的 HTML 页面或其他文本来源。',
    });
  });

  it('协商 Markdown 后按实际 MIME 返回，条件请求只复用同一表示的正文', async () => {
    const provider = new LocalHttpProvider({ resolveHost: resolveFixtureHost });
    const url = `http://provider.test:${port}/negotiated`;
    const first = await provider.read({ url });
    expect(first).toMatchObject({ contentType: 'text/markdown', etag: '"md-v1"', extractor: 'raw_text' });
    expect(first.markdown).toBe(first.content);
    expect(first.content).toContain('~~113 GW~~');
    const second = await provider.read({ url, revalidation: { etag: first.etag, cachedResult: first } });
    expect(second.content).toBe(first.content);
    expect(negotiatedIfNoneMatch).toBe('"md-v1"');
    expect(negotiatedRequests).toBe(2);
  });

  it('不支持协商的 HTML 在重定向后仍保留正文语义，并用最终地址解析来源链接', async () => {
    const provider = new LocalHttpProvider({ resolveHost: resolveFixtureHost });
    const result = await provider.read({ url: `http://provider.test:${port}/redirect-content` });
    expect(result.finalUrl).toBe(`http://provider.test:${port}/reports/current`);
    expect(result.markdown).toBe(result.content);
    expect(result.content).toContain(`[Original data](http://provider.test:${port}/reports/data.csv)`);
    expect(result.content).toContain('~~113 GW~~');
    expect(result.content).toContain('if ready:\n    output = 83');
  });

  it('Readability 遗漏应用正文时，通过同一 HTTP 链路返回语义 DOM 结果', async () => {
    const provider = new LocalHttpProvider({ resolveHost: resolveFixtureHost });
    const result = await provider.read({ url: `http://provider.test:${port}/semantic` });
    expect(result).toMatchObject({
      extractor: 'semantic_dom',
      renderMode: 'http',
      title: 'Semantic App Content',
    });
    expect(result.content).toContain('语义主区域正文');
  });

  it('真实 HTTP 链路可读取浏览器容错但根结构不规范的政策页面', async () => {
    const provider = new LocalHttpProvider({ resolveHost: resolveFixtureHost });
    const result = await provider.read({
      url: `http://provider.test:${port}/malformed-government-template`,
    });

    expect(result).toMatchObject({
      extractor: 'readability',
      renderMode: 'http',
      title: '浏览器可容错的政策正文',
      warnings: [],
    });
    expect(result.content).toContain(
      '标准 HTML 解析器应当把提前关闭根元素之后的正文重新归入唯一的文档主体'
    );
  });

  it('调用方已取消时不发出 HTTP 请求', async () => {
    const controller = new AbortController();
    controller.abort();
    const before = requestCount;
    const provider = new LocalHttpProvider({ resolveHost: resolveFixtureHost });
    await expect(
      provider.read({
        url: `http://provider.test:${port}/article`,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(requestCount).toBe(before);
  });

  it('URL 缓存过期后用 ETag 条件请求，304 复用正文且只请求一次', async () => {
    let now = 1_000;
    const runtime = createWebCacheRuntime(new MemoryWebCache({ now: () => now }));
    const provider = new LocalHttpProvider({ resolveHost: resolveFixtureHost });
    const evidenceWriter = {
      save: vi.fn().mockResolvedValue({ bundleId: '0123456789abcdef' }),
    };
    const dependencies = { provider, evidenceWriter, cacheRuntime: runtime };
    const context = {
      conversationId: 'etag-cache-conversation',
      turnId: 'etag-cache-turn',
      research: { instanceId: 'etag-cache-instance' },
    };
    attachCitationSequence(context, { offset: 0 });
    attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
    const url = `http://provider.test:${port}/etag`;

    const firstRaw = await runReadWebPage({ url }, context, dependencies);
    now += STABLE_WEB_DOCUMENT_CACHE_TTL_MS + 1;
    const secondRaw = await runReadWebPage({ url }, context, dependencies);
    const first: unknown = JSON.parse(firstRaw);
    const second: unknown = JSON.parse(secondRaw);
    const firstData = readData(first);
    const secondData = readData(second);

    expect(firstData['cacheStatus']).toBe('miss');
    expect(secondData['cacheStatus']).toBe('revalidated');
    expect(secondData).not.toHaveProperty('contentText');
    expect(secondData['charCount']).toBe(firstData['charCount']);
    expect(secondRaw).toContain('条件请求复用的正文');
    expect(etagRequestCount).toBe(2);
    expect(latestIfNoneMatch).toBe('"article-v1"');
  });
});

function readData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('工具结果不是对象');
  const data = value['data'];
  if (!isRecord(data)) throw new Error('工具 data 不是对象');
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
