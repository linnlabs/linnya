import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../types';
import { MemoryWebCache } from '../shared/cache/adapters/memoryWebCache';
import { createWebCacheRuntime } from '../shared/cache/webCacheFactory';
import type { WebCachePort } from '../shared/cache/ports/webCache';
import type { WebEvidenceWriter } from '../shared/ports/webEvidenceWriter';
import { runReadWebPage } from '../webread/orchestration/readWebPage';
import type { WebReadConfigReader } from '../webread/ports/webReadConfigReader';
import { installWebReadConfigReader } from '../webread/ports/webReadConfigReader';
import type { WebReadProvider, WebReadResult } from '../webread/providers/types';
import { WebSearchTool } from '../websearch/WebSearchTool';
import type { WebSearchProvider } from '../websearch/providers/types';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../domains/citation';
import { createCitationRefAllocatorFixture } from '../../../domains/citation/testkit/citationRefAllocatorFixture';

function createContext(): ToolContext {
  const context: ToolContext = {
    conversationId: 'cache-business-conversation',
    turnId: 'cache-business-turn',
    research: { instanceId: 'cache-business-instance' },
  };
  attachCitationSequence(context, { offset: 2 });
  attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
  return context;
}

function createEvidenceWriter(delayMs: number = 0): WebEvidenceWriter & {
  save: ReturnType<typeof vi.fn>;
} {
  return {
    save: vi.fn(async () => {
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      return { bundleId: '0123456789abcdef' };
    }),
  };
}

function createReadResult(content: string): WebReadResult {
  return {
    url: 'https://example.com/cache-article',
    finalUrl: 'https://example.com/cache-article',
    status: 200,
    contentType: 'text/html; charset=utf-8',
    title: 'Cache Article',
    content,
    charCount: content.length,
    text: content,
    extractor: 'readability',
    renderMode: 'http',
    provider: 'local_http',
    truncated: false,
    rawLength: content.length,
    fetchedAt: '2026-07-18T00:00:00.000Z',
    contentHash: 'cache-article-hash',
    qualityScore: 1,
    warnings: [],
    latencyMs: 5,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readData(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error('工具结果不是对象');
  }
  const data = parsed['data'];
  if (!isRecord(data)) {
    throw new Error('工具结果缺少 data');
  }
  return data;
}

describe('Web M4 缓存业务链路', () => {
  it('相同搜索查询第二次命中缓存，不再调用 Provider', async () => {
    const runtime = createWebCacheRuntime(new MemoryWebCache());
    const provider: WebSearchProvider = {
      name: 'fixture_search',
      search: vi.fn().mockResolvedValue([
        {
          query: 'cache query',
          provider: 'fixture_search',
          rank: 1,
          url: 'https://example.com/result',
          canonicalUrl: 'https://example.com/result',
          title: 'Cached Result',
          snippet: 'search cache content',
          cached: false,
          latencyMs: 8,
        },
      ]),
    };
    const writer = createEvidenceWriter();
    const tool = new WebSearchTool({ provider, evidenceWriter: writer, cacheRuntime: runtime });

    const first = readData(await tool.run({ query: 'Cache   Query', top_k: 6 }, createContext()));
    const second = readData(await tool.run({ query: 'cache query', top_k: 6 }, createContext()));

    expect(first['cacheStatus']).toBe('miss');
    expect(second['cacheStatus']).toBe('hit');
    expect(provider.search).toHaveBeenCalledTimes(1);
  });

  it('URL cache hit 不发网络，并按每次调用的 limit 裁剪完整缓存', async () => {
    const runtime = createWebCacheRuntime(new MemoryWebCache());
    const fullContent = 'A'.repeat(5_000);
    const provider: WebReadProvider = {
      name: 'local_http',
      read: vi.fn().mockResolvedValue(createReadResult(fullContent)),
    };
    const writer = createEvidenceWriter();
    const dependencies = { provider, evidenceWriter: writer, cacheRuntime: runtime };

    const first = readData(
      await runReadWebPage(
        { url: 'https://example.com/cache-article', maxChars: 1_000 },
        createContext(),
        dependencies
      )
    );
    const second = readData(
      await runReadWebPage(
        { url: 'https://example.com/cache-article', maxChars: 4_000 },
        createContext(),
        dependencies
      )
    );

    expect(first['cacheStatus']).toBe('miss');
    expect(first['charCount']).toBe(1_000);
    expect(second['cacheStatus']).toBe('hit');
    expect(second['charCount']).toBe(4_000);
    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(provider.read).toHaveBeenCalledWith(expect.objectContaining({ maxChars: 50_000 }));
  });

  it('相同 URL 只要渲染层身份不同就不会串用正文缓存', async () => {
    const runtime = createWebCacheRuntime(new MemoryWebCache());
    const firstProvider: WebReadProvider = {
      name: 'local_http',
      read: vi.fn().mockResolvedValue(createReadResult('路由 A 正文'.repeat(100))),
    };
    const secondProvider: WebReadProvider = {
      name: 'local_http',
      read: vi.fn().mockResolvedValue(createReadResult('路由 B 正文'.repeat(100))),
    };
    const firstRenderProvider: WebReadProvider = {
      name: 'render_a',
      read: vi.fn(async () => createReadResult('不应读取的渲染 A 正文')),
    };
    const secondRenderProvider: WebReadProvider = {
      name: 'render_b',
      read: vi.fn(async () => createReadResult('不应读取的渲染 B 正文')),
    };
    const writer = createEvidenceWriter();

    const first = readData(
      await runReadWebPage({ url: 'https://example.com/cache-article' }, createContext(), {
        provider: firstProvider,
        renderProvider: firstRenderProvider,
        evidenceWriter: writer,
        cacheRuntime: runtime,
      })
    );
    const second = readData(
      await runReadWebPage({ url: 'https://example.com/cache-article' }, createContext(), {
        provider: secondProvider,
        renderProvider: secondRenderProvider,
        evidenceWriter: writer,
        cacheRuntime: runtime,
      })
    );

    expect(first['cacheStatus']).toBe('miss');
    expect(second['cacheStatus']).toBe('miss');
    expect(firstProvider.read).toHaveBeenCalledTimes(1);
    expect(secondProvider.read).toHaveBeenCalledTimes(1);
    expect(firstRenderProvider.read).not.toHaveBeenCalled();
    expect(secondRenderProvider.read).not.toHaveBeenCalled();
  });

  it('只改 Key 值继续命中缓存，切换 Reader 身份则自然 miss', async () => {
    const runtime = createWebCacheRuntime(new MemoryWebCache());
    const provider: WebReadProvider = {
      name: 'local_http',
      read: vi.fn(async () => createReadResult('配置身份正文'.repeat(100))),
    };
    const common = {
      provider,
      renderProvider: null,
      evidenceWriter: createEvidenceWriter(),
      cacheRuntime: runtime,
    };

    const first = readData(
      await runReadWebPage({ url: 'https://example.com/cache-article' }, createContext(), {
        ...common,
        config: { renderEnabled: false, managedReader: 'metaso_reader', byokKey: 'key-a' },
      })
    );
    const changedKey = readData(
      await runReadWebPage({ url: 'https://example.com/cache-article' }, createContext(), {
        ...common,
        config: { renderEnabled: false, managedReader: 'metaso_reader', byokKey: 'key-b' },
      })
    );
    const changedReader = readData(
      await runReadWebPage({ url: 'https://example.com/cache-article' }, createContext(), {
        ...common,
        config: { renderEnabled: false, managedReader: 'jina_reader', byokKey: 'key-c' },
      })
    );

    expect(first['cacheStatus']).toBe('miss');
    expect(changedKey['cacheStatus']).toBe('hit');
    expect(changedReader['cacheStatus']).toBe('miss');
    expect(provider.read).toHaveBeenCalledTimes(2);
  });

  it('一次工具读取只从配置 port 捕获一次快照', async () => {
    const read = vi.fn(() => ({ renderEnabled: false, managedReader: 'metaso_reader' }) as const);
    const configReader: WebReadConfigReader = {
      read,
      readSettings: () => ({
        renderEnabled: false,
        managedReader: 'metaso_reader',
        slots: {},
      }),
    };
    const uninstall = installWebReadConfigReader(configReader);
    try {
      await runReadWebPage({ url: 'https://example.com/cache-article' }, createContext(), {
        provider: {
          name: 'local_http',
          read: async () => createReadResult('单次配置快照正文'.repeat(100)),
        },
        evidenceWriter: createEvidenceWriter(),
        cacheRuntime: createWebCacheRuntime(new MemoryWebCache()),
      });
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      uninstall();
    }
  });

  it('旧的 URL-only 缓存不会挡住新三层读取路由', async () => {
    const cache = new MemoryWebCache();
    const runtime = createWebCacheRuntime(cache);
    const oldResult = createReadResult('旧缓存正文');
    await cache.writeDocument({
      key: 'https://example.com/cache-article',
      ttlMs: 60_000,
      value: {
        readResult: oldResult,
        initialProvider: 'local_http',
        selectedProvider: 'local_http',
        renderAttempted: false,
        escalated: false,
      },
    });
    const provider: WebReadProvider = {
      name: 'local_http',
      read: vi.fn().mockResolvedValue(createReadResult('新路由正文'.repeat(100))),
    };

    const data = readData(
      await runReadWebPage({ url: 'https://example.com/cache-article' }, createContext(), {
        provider,
        renderProvider: null,
        evidenceWriter: createEvidenceWriter(),
        cacheRuntime: runtime,
      })
    );

    expect(data['cacheStatus']).toBe('miss');
    expect(provider.read).toHaveBeenCalledTimes(1);
  });

  it('渲染正文沿统一工具链写入 Evidence，并暴露真实路由状态', async () => {
    const runtime = createWebCacheRuntime(new MemoryWebCache());
    const httpResult: WebReadResult = {
      ...createReadResult('JS shell'),
      qualityScore: 0.2,
      warnings: ['js_shell'],
    };
    const renderedContent = '渲染后可引用的完整正文。'.repeat(100);
    const renderedResult: WebReadResult = {
      ...createReadResult(renderedContent),
      title: 'Rendered Cache Article',
      content: renderedContent,
      text: renderedContent,
      charCount: renderedContent.length,
      rawLength: renderedContent.length,
      contentHash: 'rendered-content-hash',
      renderMode: 'js',
      provider: 'local_render',
    };
    const provider: WebReadProvider = {
      name: 'local_http',
      read: vi.fn(async () => httpResult),
    };
    const renderProvider: WebReadProvider = {
      name: 'local_render',
      read: vi.fn(async () => renderedResult),
    };
    const managedProvider: WebReadProvider = {
      name: 'managed_fixture',
      read: vi.fn(async () => createReadResult('不应调用的托管正文')),
    };
    const writer = createEvidenceWriter();

    const data = readData(
      await runReadWebPage({ url: 'https://example.com/cache-article' }, createContext(), {
        provider,
        renderProvider,
        managedProvider,
        evidenceWriter: writer,
        cacheRuntime: runtime,
      })
    );

    expect(data).toMatchObject({
      provider: 'local_render',
      renderMode: 'js',
      renderAttempted: true,
      escalated: false,
      cacheStatus: 'miss',
    });
    expect(renderProvider.read).toHaveBeenCalledTimes(1);
    expect(managedProvider.read).not.toHaveBeenCalled();
    expect(writer.save).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ contentText: renderedContent })],
      })
    );
  });

  it('并发同 URL 只抓取一次，并在同一执行作用域只写一次 Evidence', async () => {
    const runtime = createWebCacheRuntime(new MemoryWebCache());
    const provider: WebReadProvider = {
      name: 'local_http',
      read: vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return createReadResult('并发抓取正文'.repeat(100));
      }),
    };
    const writer = createEvidenceWriter(20);
    const dependencies = { provider, evidenceWriter: writer, cacheRuntime: runtime };
    const context = createContext();

    const [firstRaw, secondRaw] = await Promise.all([
      runReadWebPage({ url: 'https://example.com/cache-article' }, context, dependencies),
      runReadWebPage({ url: 'https://example.com/cache-article' }, context, dependencies),
    ]);
    const statuses = [readData(firstRaw)['cacheStatus'], readData(secondRaw)['cacheStatus']];

    expect(statuses).toContain('miss');
    expect(statuses).toContain('coalesced');
    expect(provider.read).toHaveBeenCalledTimes(1);
    expect(writer.save).toHaveBeenCalledTimes(1);
  });

  it('缓存写入不可用时保留搜索结果，并显式标记 bypass', async () => {
    const unavailableCache: WebCachePort = {
      namespace: 'unavailable-cache',
      readSearch: async () => ({ state: 'miss' }),
      writeSearch: async () => {
        throw new Error('cache disk unavailable');
      },
      readDocument: async () => ({ state: 'miss' }),
      writeDocument: async () => {
        throw new Error('cache disk unavailable');
      },
    };
    const provider: WebSearchProvider = {
      name: 'fixture_search',
      search: vi.fn().mockResolvedValue([
        {
          query: 'cache unavailable',
          provider: 'fixture_search',
          rank: 1,
          url: 'https://example.com/result',
          canonicalUrl: 'https://example.com/result',
          title: 'Live Result',
          snippet: 'network result remains available',
          cached: false,
          latencyMs: 2,
        },
      ]),
    };
    const tool = new WebSearchTool({
      provider,
      evidenceWriter: createEvidenceWriter(),
      cacheRuntime: createWebCacheRuntime(unavailableCache),
    });

    const data = readData(
      await tool.run({ query: 'cache unavailable', top_k: 6 }, createContext())
    );
    expect(data['cacheStatus']).toBe('bypass');
    expect(data['resultCount']).toBe(1);
  });
});
