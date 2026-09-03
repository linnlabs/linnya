import { describe, expect, it } from 'vitest';
import type { PendingRevision } from '../../pending-revisions';
import { buildMarkdownCitationReadProjection } from '../orchestration/buildMarkdownCitationReadProjection';

function citationRoot(params: {
  readonly blockId: string;
  readonly citationId: string;
  readonly ref: string;
  readonly docId: string;
  readonly sourceBlockId: string;
}) {
  return {
    type: 'rootBlock',
    attrs: { id: params.blockId },
    content: [
      {
        type: 'baseBlock',
        content: [
          {
            type: 'citationNode',
            attrs: {
              citationId: params.citationId,
              sourceType: 'knowledge_base',
              sourceId: params.docId,
              blockId: params.sourceBlockId,
              title: params.docId,
              snippet: `snapshot-${params.docId}`,
              ref: params.ref,
            },
          },
        ],
      },
    ],
  };
}

function pending(params: {
  readonly blockId: string;
  readonly markdown: string;
  readonly hydration?: Readonly<Record<string, unknown>>;
}): PendingRevision {
  return {
    id: `pending-${params.blockId}`,
    document_node_id: 'document-1',
    target_block_id: params.blockId,
    new_markdown: params.markdown,
    source: 'ai',
    operation: 'update',
    meta_json: JSON.stringify({
      operation: 'update',
      ...(params.hydration ? { citation_hydration: params.hydration } : {}),
    }),
    created_at: 1,
    updated_at: null,
  };
}

describe('buildMarkdownCitationReadProjection', () => {
  const content = {
    type: 'doc',
    content: [
      citationRoot({
        blockId: 'workspace-block-1',
        citationId: 'base-citation-1',
        ref: 'ABC234',
        docId: 'old-doc',
        sourceBlockId: 'old-source-block',
      }),
      citationRoot({
        blockId: 'workspace-block-2',
        citationId: 'base-citation-2',
        ref: 'ABC236',
        docId: 'kept-doc',
        sourceBlockId: 'kept-source-block',
      }),
    ],
  };

  it('preview 只接纳当前可见的 pending/base facts，并让正文 token 与 sources 一致', () => {
    const result = buildMarkdownCitationReadProjection({
      content,
      viewMode: 'preview',
      pendings: [
        pending({
          blockId: 'workspace-block-1',
          markdown: '**更新** [@ABC235]\n\n`示例 [@ABC235]`',
          hydration: {
            ABC235: {
              docId: 'new-doc',
              blockId: 'new-source-block',
              title: 'New source',
              snippet: 'new snapshot',
              sourceType: 'knowledge_base',
            },
          },
        }),
      ],
    });

    expect(
      result.citationProjection.sources.map(source =>
        source.sourceType === 'manual' ? source.bodyToken : source.ref
      )
    ).toEqual(['ABC235', 'ABC236']);
    expect(result.viewBlocks.map(block => block.text)).toEqual([
      '**更新** [@ABC235]\n\n`示例 [@ABC235]`',
      '[@ABC236]',
    ]);
    expect(result.viewBlocks[0]?.text).not.toContain('ABC234');
  });

  it('original 视图完全忽略 pending facts，仍投影持久化 CitationNode', () => {
    const result = buildMarkdownCitationReadProjection({
      content,
      viewMode: 'original',
      pendings: [
        pending({
          blockId: 'workspace-block-1',
          markdown: '更新 [@ABC235]',
          hydration: {
            ABC235: {
              docId: 'new-doc',
              blockId: 'new-source-block',
              title: 'New',
              snippet: 'New',
            },
          },
        }),
      ],
    });

    expect(
      result.citationProjection.sources.map(source =>
        source.sourceType === 'manual' ? source.bodyToken : source.ref
      )
    ).toEqual(['ABC234', 'ABC236']);
    expect(result.viewBlocks.map(block => block.text)).toEqual(['[@ABC234]', '[@ABC236]']);
  });

  it('pending token 缺少 hydration 时输出 invalid marker 和诊断，不保留伪 canonical token', () => {
    const result = buildMarkdownCitationReadProjection({
      content,
      viewMode: 'preview',
      pendings: [
        pending({
          blockId: 'workspace-block-1',
          markdown: '损坏引用 [@ABC235]',
        }),
      ],
    });

    expect(result.viewBlocks[0]?.text).toMatch(/^损坏引用 【invalid citation:[0-9a-f]{10}】$/);
    expect(result.viewBlocks[0]?.text).not.toContain('[@ABC235]');
    expect(result.citationProjection.diagnostics).toEqual([
      expect.objectContaining({ code: 'invalid_citation' }),
    ]);
  });
});
