import { describe, expect, it, vi } from 'vitest';
import {
  admitMarkdownCitationHydration,
  buildMarkdownPendingCitationMetadata,
} from '..';
import type { CitationSource } from '../../../../citation';

describe('Markdown document write citation hydration', () => {
  it('把 Citation 公开来源投影为 Markdown Mark hydration', async () => {
    const resolveSources = vi.fn(async (): Promise<readonly CitationSource[]> => [{
      sourceType: 'knowledge_base',
      ref: 'Abc234',
      docId: 'doc-1',
      blockId: 'block-1',
      kbId: 'kb-1',
      title: 'Knowledge title',
      snippet: 'Knowledge snapshot',
    }, {
      sourceType: 'web',
      ref: 'Def567',
      url: 'https://example.com/article',
      title: 'Web title',
      snippet: 'Web snapshot',
      authors: ['Author'],
      publishedAt: '2026-08-09',
      containerTitle: 'Example',
    }]);

    await expect(admitMarkdownCitationHydration(
      'Knowledge [@Abc234] and Web [@Def567].',
      resolveSources,
    )).resolves.toEqual({
      Abc234: {
        sourceType: 'knowledge_base',
        docId: 'doc-1',
        blockId: 'block-1',
        kbId: 'kb-1',
        title: 'Knowledge title',
        snippet: 'Knowledge snapshot',
      },
      Def567: {
        sourceType: 'web',
        url: 'https://example.com/article',
        title: 'Web title',
        snippet: 'Web snapshot',
        authors: ['Author'],
        date: '2026-08-09',
        containerTitle: 'Example',
      },
    });
    expect(resolveSources).toHaveBeenCalledWith(['Abc234', 'Def567']);
  });

  it('格式损坏或来源未命中时 fail-fast，不生成普通文本 fallback', async () => {
    const resolveSources = vi.fn(async (): Promise<readonly CitationSource[]> => []);

    await expect(admitMarkdownCitationHydration(
      'Mixed [@Abc234; @bad].',
      resolveSources,
    )).rejects.toThrow('引用格式不合法');
    expect(resolveSources).not.toHaveBeenCalled();

    await expect(admitMarkdownCitationHydration(
      'Missing [@Abc234].',
      resolveSources,
    )).rejects.toThrow('Citation admission 内部缺少');
  });

  it('一次接纳整份目标 Markdown，再按 pending block 分配 hydration', async () => {
    const resolveSources = vi.fn(async (): Promise<readonly CitationSource[]> => [{
      sourceType: 'knowledge_base',
      ref: 'Abc234',
      docId: 'doc-1',
      blockId: 'block-1',
      title: 'Knowledge title',
      snippet: 'Knowledge snapshot',
    }, {
      sourceType: 'web',
      ref: 'Def567',
      url: 'https://example.com/article',
      title: 'Web title',
      snippet: 'Web snapshot',
    }]);

    const metaByMarkdown = await buildMarkdownPendingCitationMetadata(
      'First [@Abc234].\n\nSecond [@Def567].',
      resolveSources,
    );

    expect(resolveSources).toHaveBeenCalledTimes(1);
    expect(resolveSources).toHaveBeenCalledWith(['Abc234', 'Def567']);
    expect([...metaByMarkdown.values()]).toEqual([
      { citation_hydration: { Abc234: expect.objectContaining({ docId: 'doc-1' }) } },
      { citation_hydration: { Def567: expect.objectContaining({ url: 'https://example.com/article' }) } },
    ]);
  });
});
