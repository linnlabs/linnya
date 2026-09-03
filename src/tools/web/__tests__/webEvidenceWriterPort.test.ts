import { describe, expect, it, vi } from 'vitest';
import { WebSearchTool } from '../websearch/WebSearchTool';
import { runReadWebPage } from '../webread/orchestration/readWebPage';
import type { WebEvidenceWriter } from '../shared/ports/webEvidenceWriter';
import type { WebReadProvider } from '../webread/providers/types';
import type { WebSearchProvider } from '../websearch/providers/types';
import type { ToolContext } from '../../types';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../domains/citation';
import { createCitationRefAllocatorFixture } from '../../../domains/citation/testkit/citationRefAllocatorFixture';

function createWriter(): WebEvidenceWriter & { save: ReturnType<typeof vi.fn> } {
  return {
    save: vi.fn().mockResolvedValue({ bundleId: '0123456789abcdef' }),
  };
}

function createContext(): ToolContext {
  const context: ToolContext = { conversationId: 'port_conv', turnId: 'port_turn' };
  attachCitationSequence(context, { offset: 0 });
  attachCitationRefAllocator(context, createCitationRefAllocatorFixture());
  return context;
}

describe('WebEvidenceWriterPort', () => {
  it('web_search 只通过窄 port 写搜索结果 Evidence', async () => {
    const provider: WebSearchProvider = {
      name: 'fake_search',
      search: vi.fn().mockResolvedValue([
        {
          title: 'Port Search Result',
          url: 'https://example.com/article',
          canonicalUrl: 'https://example.com/article',
          snippet: 'search evidence snippet',
          query: 'port contract',
          provider: 'fake_search',
          rank: 1,
          cached: false,
          latencyMs: 1,
        },
      ]),
    };
    const writer = createWriter();

    const output = await new WebSearchTool({ provider, evidenceWriter: writer }).run(
      { query: 'port contract', top_k: 6 },
      createContext()
    );

    expect(writer.save).toHaveBeenCalledTimes(1);
    expect(writer.save).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'port contract',
        items: [
          expect.objectContaining({
            captureKind: 'web_search_result',
            contentText: 'search evidence snippet',
          }),
        ],
      })
    );
    expect(output).toContain('0123456789abcdef');
  });

  it('readWebPage 只通过窄 port 写页面正文 Evidence', async () => {
    const provider: WebReadProvider = {
      name: 'fake_read',
      read: vi.fn().mockResolvedValue({
        title: 'Port Page',
        url: 'https://example.com/article',
        finalUrl: 'https://example.com/article',
        status: 200,
        contentType: 'text/plain',
        content: 'full page evidence',
        charCount: 18,
        text: 'full page evidence',
        extractor: 'raw_text',
        renderMode: 'http',
        provider: 'fake_read',
        truncated: false,
        rawLength: 18,
        fetchedAt: '2026-07-18T00:00:00.000Z',
        contentHash: 'port-content-hash',
        warnings: [],
        latencyMs: 1,
      }),
    };
    const writer = createWriter();

    const output = await runReadWebPage({ url: 'https://example.com/article' }, createContext(), {
      provider,
      evidenceWriter: writer,
    });

    expect(writer.save).toHaveBeenCalledTimes(1);
    expect(writer.save).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'https://example.com/article',
        items: [
          expect.objectContaining({
            captureKind: 'web_page',
            contentText: 'full page evidence',
          }),
        ],
      })
    );
    expect(output).toContain('0123456789abcdef');
  });
});
