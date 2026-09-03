import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileWebCache } from '../shared/cache/adapters/fileWebCache';
import {
  DYNAMIC_WEB_DOCUMENT_CACHE_TTL_MS,
  RECENT_WEB_DOCUMENT_CACHE_TTL_MS,
  STABLE_WEB_DOCUMENT_CACHE_TTL_MS,
  resolveWebDocumentCacheTtlMs,
} from '../shared/cache/functions/cacheTtl';
import {
  createWebDocumentCacheKey,
  createWebSearchCacheKey,
} from '../shared/cache/functions/cacheKeys';
import { InFlightRequestCoalescer } from '../shared/cache/orchestration/InFlightRequestCoalescer';
import type { WebReadLadderResult } from '../webread/definitions/readLadder';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

function createLadderResult(params: {
  finalUrl?: string;
  contentType?: string;
  publishedAt?: string;
} = {}): WebReadLadderResult {
  const content = '可持久化的网页正文';
  return {
    initialProvider: 'local_http',
    selectedProvider: 'local_http',
    renderAttempted: false,
    escalated: false,
    readResult: {
      url: 'https://example.com/article',
      finalUrl: params.finalUrl ?? 'https://example.com/article',
      status: 200,
      contentType: params.contentType ?? 'text/html; charset=utf-8',
      title: '缓存文章',
      content,
      charCount: content.length,
      text: content,
      extractor: 'readability',
      renderMode: 'http',
      provider: 'local_http',
      truncated: false,
      rawLength: content.length,
      fetchedAt: '2026-07-18T00:00:00.000Z',
      contentHash: 'content-hash',
      qualityScore: 1,
      warnings: [],
      latencyMs: 12,
      ...(params.publishedAt ? { publishedAt: params.publishedAt } : {}),
    },
  };
}

describe('Web M4 缓存基础合同', () => {
  it('查询语义与 canonical URL 生成稳定且不碰撞的查找 key', () => {
    expect(createWebSearchCacheKey({
      query: '  Linnya   Web  ',
      provider: 'SERPER',
      topK: 10,
      recencyDays: 7,
    })).toBe(createWebSearchCacheKey({
      query: 'linnya web',
      provider: 'serper',
      topK: 10,
      recencyDays: 7,
    }));
    expect(createWebSearchCacheKey({
      query: 'linnya web',
      provider: 'serper',
      topK: 6,
      recencyDays: 7,
    })).not.toBe(createWebSearchCacheKey({
      query: 'linnya web',
      provider: 'serper',
      topK: 10,
      recencyDays: 7,
    }));
    const localRoute = { version: 1, providers: ['LOCAL_HTTP', 'managed_default'] };
    expect(createWebDocumentCacheKey({
      url: 'https://example.com/article/?utm_source=test#section',
      route: localRoute,
    })).toBe(createWebDocumentCacheKey({
      url: 'https://example.com/article',
      route: { version: 1, providers: ['local_http', 'managed_default'] },
    }));
    expect(createWebDocumentCacheKey({
      url: 'https://example.com/article',
      route: localRoute,
    })).not.toBe(createWebDocumentCacheKey({
      url: 'https://example.com/article',
      route: { version: 2, providers: ['local_http', 'local_render', 'managed_default'] },
    }));
  });

  it('文件缓存跨实例命中，过期后保留 stale 内容供条件请求复用', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya_web_cache_'));
    tempRoots.push(root);
    let now = 1_000;
    const first = new FileWebCache(root, { now: () => now });
    const value: WebReadLadderResult = {
      ...createLadderResult(),
      initialFailureKind: 'extraction_error',
      initialFailureStage: 'dom_canonicalization',
      escalationReason: 'extraction_error',
    };
    await first.writeDocument({ key: 'https://example.com/article', value, ttlMs: 500 });

    const second = new FileWebCache(root, { now: () => now });
    await expect(second.readDocument('https://example.com/article')).resolves.toMatchObject({
      state: 'fresh',
      value: {
        initialFailureKind: 'extraction_error',
        initialFailureStage: 'dom_canonicalization',
        escalationReason: 'extraction_error',
        readResult: { content: '可持久化的网页正文' },
      },
    });

    now = 1_501;
    await expect(second.readDocument('https://example.com/article')).resolves.toMatchObject({
      state: 'stale',
      value: { readResult: { contentHash: 'content-hash' } },
    });
  });

  it('文件 cache hit 保持常数级读取，p95 不超过 100ms', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya_web_cache_latency_'));
    tempRoots.push(root);
    const cache = new FileWebCache(root);
    await cache.writeDocument({
      key: 'https://example.com/latency-article',
      value: createLadderResult(),
      ttlMs: 60_000,
    });

    const samples: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      const startedAt = performance.now();
      const result = await cache.readDocument('https://example.com/latency-article');
      samples.push(performance.now() - startedAt);
      expect(result.state).toBe('fresh');
    }
    samples.sort((left, right) => left - right);
    const p95Index = Math.ceil(samples.length * 0.95) - 1;
    expect(samples[p95Index]).toBeLessThanOrEqual(100);
  });

  it('首页/Feed、近期页面和稳定文章使用不同新鲜度窗口', () => {
    const now = Date.parse('2026-07-18T12:00:00.000Z');
    expect(resolveWebDocumentCacheTtlMs(createLadderResult({
      finalUrl: 'https://example.com/',
    }), now)).toBe(DYNAMIC_WEB_DOCUMENT_CACHE_TTL_MS);
    expect(resolveWebDocumentCacheTtlMs(createLadderResult({
      contentType: 'application/rss+xml',
    }), now)).toBe(DYNAMIC_WEB_DOCUMENT_CACHE_TTL_MS);
    expect(resolveWebDocumentCacheTtlMs(createLadderResult({
      publishedAt: '2026-07-18T08:00:00.000Z',
    }), now)).toBe(RECENT_WEB_DOCUMENT_CACHE_TTL_MS);
    expect(resolveWebDocumentCacheTtlMs(createLadderResult(), now))
      .toBe(STABLE_WEB_DOCUMENT_CACHE_TTL_MS);
  });
});

describe('Web M4 in-flight 合并合同', () => {
  it('并发同 key 只执行一次，单个等待者取消不影响其他等待者', async () => {
    const coalescer = new InFlightRequestCoalescer<string>();
    const firstController = new AbortController();
    const secondController = new AbortController();
    let finishNetwork: ((value: string) => void) | undefined;
    let sharedSignal: AbortSignal | undefined;
    const execute = vi.fn((signal: AbortSignal) => new Promise<string>((resolve) => {
      sharedSignal = signal;
      finishNetwork = resolve;
    }));

    const first = coalescer.run('same-url', firstController.signal, execute);
    const second = coalescer.run('same-url', secondController.signal, execute);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError', kind: 'aborted' });
    expect(sharedSignal?.aborted).toBe(false);
    finishNetwork?.('正文');
    await expect(second).resolves.toEqual({ value: '正文', joinedExistingRequest: true });
  });

  it('失败的 Promise 会移出 map，下一次同 key 可以重新执行', async () => {
    const coalescer = new InFlightRequestCoalescer<string>();
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('retry success');

    await expect(coalescer.run('retry-key', undefined, execute)).rejects.toThrow('temporary failure');
    await expect(coalescer.run('retry-key', undefined, execute)).resolves.toEqual({
      value: 'retry success',
      joinedExistingRequest: false,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
