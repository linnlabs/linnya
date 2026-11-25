import { describe, expect, it, vi } from 'vitest';
import { WebReadResultSchema } from '@app/schemas';
import type { ToolContext } from '../../types';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../domains/citation';
import { createCitationRefAllocatorFixture } from '../../../domains/citation/testkit/citationRefAllocatorFixture';
import { MemoryWebCache } from '../shared/cache/adapters/memoryWebCache';
import { createWebCacheRuntime } from '../shared/cache/webCacheFactory';
import type { WebEvidenceWriter } from '../shared/ports/webEvidenceWriter';
import type { WebPageRenderer } from '../webread/definitions/webPageRenderer';
import { createWebReadResult } from '../webread/functions/createWebReadResult';
import { runReadWebPage } from '../webread/orchestration/readWebPage';
import { LocalRenderProvider } from '../webread/providers/localRender';
import type { WebReadParams, WebReadProvider } from '../webread/providers/types';

function createContext(): ToolContext {
  const context: ToolContext = {
    conversationId: 'phase1a-regression-conversation',
    turnId: 'phase1a-regression-turn',
    research: { instanceId: 'phase1a-regression-instance' },
  };
  attachCitationSequence(context, { offset: 0 });
  attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
  return context;
}

describe('Phase 1A web_read 回归', () => {
  it('SPA hash 路由不同公告不能共享缓存正文或引用', async () => {
    const noticeAUrl = 'https://gov.example.test/#/notice/a';
    const noticeBUrl = 'https://gov.example.test/#/notice/b';
    const cacheRuntime = createWebCacheRuntime(new MemoryWebCache());
    const evidenceWriter: WebEvidenceWriter = {
      save: vi.fn(async () => ({ bundleId: '0123456789abcdef' })),
    };

    const httpProvider: WebReadProvider = {
      name: 'local_http',
      read: vi.fn(async (params: WebReadParams) =>
        createWebReadResult({
          url: params.url,
          finalUrl: params.url,
          status: 200,
          contentType: 'text/html; charset=utf-8',
          title: 'Gov Portal SPA',
          content: '',
          contentFormat: 'markdown',
          extractor: 'readability',
          renderMode: 'http',
          provider: 'local_http',
          rawLength: 320,
          qualityScore: 0,
          warnings: ['empty_content', 'js_shell'],
          latencyMs: 3,
        }),
      ),
    };

    const renderRead = vi.fn(async (params: WebReadParams) => {
      const isNoticeB = params.url.includes('#/notice/b');
      const body = isNoticeB
        ? `Notice B body.\n\nNOTICE_B_UNIQUE_FACT: Fiscal Circular 2026-02.\n\n${'Detail B paragraph. '.repeat(25)}`
        : `Notice A body.\n\nNOTICE_A_UNIQUE_FACT: Personnel Notice 2026-01.\n\n${'Detail A paragraph. '.repeat(25)}`;
      return createWebReadResult({
        url: params.url,
        finalUrl: params.url,
        status: 200,
        contentType: 'text/html; charset=utf-8',
        title: isNoticeB ? 'Notice B' : 'Notice A',
        content: body,
        contentFormat: 'markdown',
        extractor: 'readability',
        renderMode: 'js',
        provider: 'local_render',
        rawLength: body.length,
        qualityScore: 1,
        warnings: [],
        latencyMs: 5,
      });
    });
    const renderProvider: WebReadProvider = { name: 'local_render', read: renderRead };
    const context = createContext();
    const deps = {
      provider: httpProvider,
      renderProvider,
      managedProvider: null,
      cacheRuntime,
      evidenceWriter,
    };

    const rawA = await runReadWebPage({ url: noticeAUrl }, context, deps);
    const rawB = await runReadWebPage({ url: noticeBUrl }, context, deps);
    const rawFindB = await runReadWebPage(
      { url: noticeBUrl, find: 'NOTICE_B_UNIQUE_FACT' },
      context,
      deps,
    );

    const parsedA = WebReadResultSchema.parse(JSON.parse(rawA));
    const parsedB = WebReadResultSchema.parse(JSON.parse(rawB));
    const parsedFindB = WebReadResultSchema.parse(JSON.parse(rawFindB));

    expect(renderRead).toHaveBeenCalledTimes(2);
    expect(parsedB.observation).toContain('NOTICE_B_UNIQUE_FACT');
    expect(parsedB.observation).not.toContain('NOTICE_A_UNIQUE_FACT');
    expect(parsedB.data.citations.citations[0].ref).not.toBe(
      parsedA.data.citations.citations[0].ref,
    );
    expect(parsedFindB.data.find?.hit_count).toBeGreaterThanOrEqual(1);
    expect(parsedFindB.observation).toContain('NOTICE_B_UNIQUE_FACT');
  });

  it('渲染端返回长 403 错误页时不得作为成功正文写入 Evidence', async () => {
    const renderer: WebPageRenderer = {
      async render() {
        return {
          html: `<!doctype html><html><head><title>403 Forbidden</title></head><body><article><h1>Access Denied</h1><p>${'Forbidden error details from upstream gateway. '.repeat(40)}</p></article></body></html>`,
          finalUrl: 'https://blocked.example.test/doc',
          mainResponse: { status: 403, headers: {} },
        };
      },
    };
    const provider = new LocalRenderProvider({ renderer });
    await expect(provider.read({ url: 'https://blocked.example.test/doc' })).rejects.toMatchObject({
      kind: 'http_403',
    });
  });
});
