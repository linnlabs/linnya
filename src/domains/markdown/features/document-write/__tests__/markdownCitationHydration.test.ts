import { describe, expect, it, vi } from 'vitest';
import {
  admitMarkdownCitationHydration,
  buildMarkdownPendingCitationMetadata,
  buildMarkdownDocumentFromText,
} from '..';
import type { CitationSource } from '../../../../citation';
import type { MarkdownDocJson } from '../../normalization';

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
    )).rejects.toThrow('Invalid citation tokens');
    expect(resolveSources).not.toHaveBeenCalled();

    await expect(admitMarkdownCitationHydration(
      'Missing [@Abc234].',
      resolveSources,
    )).rejects.toThrow('Citation admission 内部缺少');
  });

  it('定位写法被拒后可按同一来源重试，代码中的语法讨论不接纳成引用', async () => {
    const resolveSources = vi.fn(async (): Promise<readonly CitationSource[]> => [{
      sourceType: 'web', ref: 'Abc234', url: 'https://example.com/report',
      title: 'Report', snippet: 'Persisted source snapshot',
    }]);
    await expect(admitMarkdownCitationHydration(
      '结论 [@Abc234, p. 5]。', resolveSources,
    )).rejects.toThrow('Put page or table locators outside the token');
    expect(resolveSources).not.toHaveBeenCalled();

    const admitted = await admitMarkdownCitationHydration(
      '结论 [@Abc234]（第5页）。语法示例 `[@ref, p. 5]`。', resolveSources,
    );
    expect(Object.keys(admitted)).toEqual(['Abc234']);
    expect(resolveSources).toHaveBeenCalledExactlyOnceWith(['Abc234']);
  });

  it('按同一批 canonical blocks 一次接纳来源，再分配 pending hydration', async () => {
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

  it('跨段未闭合反引号不再让 pending 引用漏接纳，代码示例仍不生成来源', async () => {
    const resolveSources = vi.fn(async (): Promise<readonly CitationSource[]> => [{
      sourceType: 'web', ref: 'Abc234', url: 'https://example.com/report',
      title: 'Report', snippet: 'Original snapshot',
    }]);
    const metadata = await buildMarkdownPendingCitationMetadata(
      '`[@Abc234]\n\n其他 `text`\n\n示例 `[@Def567]`\n\n```md\n[@bad]\n```',
      resolveSources,
    );
    expect(resolveSources).toHaveBeenCalledExactlyOnceWith(['Abc234']);
    expect([...metadata.values()]).toEqual([{
      citation_hydration: { Abc234: expect.objectContaining({ url: 'https://example.com/report' }) },
    }]);
    await expect(buildMarkdownPendingCitationMetadata('`[@bad]\n\n其他 `text`', resolveSources))
      .rejects.toThrow('Invalid citation tokens');
    await expect(buildMarkdownPendingCitationMetadata('`[@Def567]\n\n其他 `text`', async () => []))
      .rejects.toThrow('Citation admission 内部缺少');
  });

  it('创建文档时按标准 Markdown 链接接纳已读 Web 来源', async () => {
    const source: CitationSource = {
      sourceType: 'web',
      ref: 'Abc234',
      url: 'https://example.com/report',
      title: 'Official report',
      snippet: 'Report snapshot',
    };
    const document: MarkdownDocJson = {
      type: 'doc',
      content: [{
        type: 'rootBlock',
        attrs: { id: 'root-1' },
        content: [{
          type: 'baseBlock',
          attrs: { id: 'block-1' },
          content: [{
            type: 'text',
            text: 'Official report',
            marks: [{ type: 'link', attrs: { href: 'https://example.com/report/?utm_source=agent' } }],
          }],
        }],
      }],
    };

    const result = await buildMarkdownDocumentFromText({
      markdown: '[Official report](https://example.com/report/?utm_source=agent)',
      normalizer: { buildStructuredDocFromMarkdown: async () => document },
      resolveCitationSources: async () => [],
      resolveCitationSourcesByUrl: async urls => {
        expect(urls).toEqual(['https://example.com/report']);
        return [source];
      },
    });

    const inline = (result.content as MarkdownDocJson).content[0]?.content?.[0]?.content;
    expect(inline).toEqual([
      expect.objectContaining({
        type: 'citationNode',
        attrs: expect.objectContaining({ ref: 'Abc234', url: source.url }),
      }),
    ]);
  });

  it('为 pending revision 按 root block 保存标准链接的 citation hydration', async () => {
    const metaByMarkdown = await buildMarkdownPendingCitationMetadata(
      '结论见 [官方报告](https://example.com/report/?utm_source=agent).',
      async () => [],
      {
        collectLinkHrefs: async () => ['https://example.com/report/?utm_source=agent'],
        resolveSourcesByUrl: async urls => {
          expect(urls).toEqual(['https://example.com/report']);
          return [{
            sourceType: 'web',
            ref: 'Abc234',
            url: 'https://example.com/report',
            title: '官方报告',
            snippet: '报告快照',
          }];
        },
      },
    );

    expect([...metaByMarkdown.values()]).toEqual([
      {
        citation_link_hydration: {
          'https://example.com/report': {
            ref: 'Abc234',
            data: expect.objectContaining({
              sourceType: 'web',
              url: 'https://example.com/report',
            }),
          },
        },
      },
    ]);
  });
});
