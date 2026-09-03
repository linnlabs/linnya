import { describe, expect, it } from 'vitest';
import { remapWorkspaceCitationRefs } from './remapWorkspaceCitationRefs';

describe('remapWorkspaceCitationRefs', () => {
  it('只改写 read_file 投影视图，不修改 Editor 持久化来源事实', async () => {
    const persistedSources = [
      {
        sourceType: 'knowledge_base' as const,
        ref: 'Abc234',
        docId: 'doc-1',
        blockId: 'block-1',
        docTitle: '报告',
        snippet: '原始快照',
      },
    ];
    const projection = await remapWorkspaceCitationRefs({
      sources: persistedSources,
      diagnostics: [
        {
          code: 'excerpt_unavailable',
          message: 'Citation [@Abc234] 没有摘录。',
          marker: '[@Abc234]',
          ref: 'Abc234',
        },
      ],
      allocator: {
        async allocate() {
          return ['Def567'];
        },
      },
    });

    expect(persistedSources[0]?.ref).toBe('Abc234');
    expect(projection.sources[0]?.ref).toBe('Def567');
    expect(projection.diagnostics[0]).toMatchObject({
      ref: 'Def567',
      marker: '[@Def567]',
      message: 'Citation [@Def567] 没有摘录。',
    });
    expect(projection.remapText('正文 [@Abc234]')).toBe('正文 [@Def567]');
    expect(
      projection.remapText(
        ['正文 [@Abc234]', '`[@Abc234]`', '```md', '[@Abc234]', '```'].join('\n')
      )
    ).toBe(['正文 [@Def567]', '`[@Abc234]`', '```md', '[@Abc234]', '```'].join('\n'));
    expect(
      projection.remapDocumentData({
        documentId: 'workspace-document-1',
        docType: 'markdown',
        documentName: '报告',
        truncatedByChars: false,
        totalTextLength: 9,
        nextOffset: null,
        presentation: { kind: 'text', text: '正文 [@Abc234]' },
      }).presentation
    ).toEqual({ kind: 'text', text: '正文 [@Def567]' });
  });
});
