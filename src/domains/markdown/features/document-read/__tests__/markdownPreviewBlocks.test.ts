import { describe, expect, it } from 'vitest';
import type { PendingRevision } from '../../pending-revisions';
import type { FlattenedMarkdownBlock } from '../../../shared/markdownBlockProjection';
import { buildMarkdownPreviewBlocks } from '../functions/markdownPreviewBlocks';
import { buildMarkdownPendingDiffs } from '../functions/markdownPendingDiffs';

const baseBlock: FlattenedMarkdownBlock = {
  index: 1,
  blockId: 'workspace-block-1',
  ref: '#ABC234',
  text: '原文',
};

function pending(params: {
  readonly operation: PendingRevision['operation'];
  readonly markdown: string;
  readonly metaOperation?: 'insert' | 'update' | 'delete';
}): PendingRevision {
  return {
    id: 'pending-1',
    document_node_id: 'document-1',
    target_block_id: baseBlock.blockId,
    new_markdown: params.markdown,
    source: 'ai',
    operation: params.operation,
    meta_json: params.metaOperation ? JSON.stringify({ operation: params.metaOperation }) : null,
    created_at: 1,
    updated_at: null,
  };
}

function missingInsertPending(): PendingRevision {
  return {
    id: 'pending-missing-insert',
    document_node_id: 'document-1',
    target_block_id: 'workspace-block-missing',
    new_markdown: '不应被读取层补造',
    source: 'ai',
    operation: 'insert',
    meta_json: JSON.stringify({ operation: 'insert', anchorBlockId: baseBlock.blockId }),
    created_at: 2,
    updated_at: null,
  };
}

describe('buildMarkdownPreviewBlocks operation identity', () => {
  it('优先使用 pending.operation，delete 不依赖 meta_json 或空字符串旁路', () => {
    expect(
      buildMarkdownPreviewBlocks({
        baseBlocks: [baseBlock],
        pendings: [pending({ operation: 'delete', markdown: '历史异常残留文本' })],
      })
    ).toEqual([]);
  });

  it('正式 update 不被旧 meta_json 的 delete 语义覆盖', () => {
    expect(
      buildMarkdownPreviewBlocks({
        baseBlocks: [baseBlock],
        pendings: [
          pending({
            operation: 'update',
            markdown: '修订稿',
            metaOperation: 'delete',
          }),
        ],
      })
    ).toEqual([{ ...baseBlock, text: '修订稿' }]);
  });

  it('目标块实体缺失时不根据旧 anchor 元数据猜测并补造 insert 块', () => {
    expect(
      buildMarkdownPreviewBlocks({
        baseBlocks: [baseBlock],
        pendings: [missingInsertPending()],
      })
    ).toEqual([baseBlock]);
  });

  it('pending diff 不让 citation ref 绕过正文窗口进入 Agent 结果', () => {
    const diffs = buildMarkdownPendingDiffs({
      baseBlocks: [{ ...baseBlock, text: '原文 [@ABC234]' }],
      pendings: [pending({
        operation: 'update',
        markdown: '修订稿 \\[@ABC235\\]',
      })],
    });

    expect(diffs).toEqual([expect.objectContaining({
      newText: '修订稿 【citation】',
    })]);
    expect(JSON.stringify(diffs)).not.toContain('[@ABC234]');
    expect(JSON.stringify(diffs)).not.toContain('[@ABC235]');
  });
});
