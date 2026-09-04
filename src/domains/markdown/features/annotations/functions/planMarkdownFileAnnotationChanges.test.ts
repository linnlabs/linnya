import { describe, expect, it } from 'vitest';
import { encodeMarkdownAnnotationComment } from '@app/schemas';
import { planMarkdownBlocks } from '../../normalization';
import { flattenMarkdownDocumentBlocks } from '../../../shared';
import { planMarkdownFileAnnotationChanges } from './planMarkdownFileAnnotationChanges';

const annotation = {
  id: 'annotation-1',
  content: '原批注',
  author: 'User',
  state: 'confirmed' as const,
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  resolvedAt: null,
  replies: [],
  meta: { source: 'manual' as const },
};

const currentDocument = {
  type: 'doc' as const,
  content: [{
    type: 'rootBlock',
    attrs: { id: 'root-1', annotations: [annotation] },
    content: [{ type: 'paragraphBlock', content: [{ type: 'text', text: '正文' }] }],
  }],
};

const currentBlocks = flattenMarkdownDocumentBlocks(currentDocument);

describe('planMarkdownFileAnnotationChanges', () => {
  it('保留 canonical 批注，并把普通 comment 规划成新增', async () => {
    const planned = await planMarkdownBlocks(
      `正文\n\n${encodeMarkdownAnnotationComment(annotation)}\n\n<!-- 新批注 -->`
    );

    expect(planMarkdownFileAnnotationChanges({
      currentDocument,
      currentBlocks,
      annotationComments: planned.annotationComments,
    })).toEqual({
      creations: [{ blockId: 'root-1', content: '新批注' }],
      updates: [],
      deletions: [],
    });
  });

  it('以稳定 ID 识别 canonical 内容编辑', async () => {
    const edited = { ...annotation, content: '修改后的批注' };
    const planned = await planMarkdownBlocks(
      `正文\n\n${encodeMarkdownAnnotationComment(edited)}`
    );

    expect(planMarkdownFileAnnotationChanges({
      currentDocument,
      currentBlocks,
      annotationComments: planned.annotationComments,
    })).toEqual({
      creations: [],
      updates: [{ blockId: 'root-1', annotation: edited }],
      deletions: [],
    });
  });

  it('canonical comment 从 Markdown 消失时规划为删除', async () => {
    const planned = await planMarkdownBlocks('正文');
    expect(planMarkdownFileAnnotationChanges({
      currentDocument,
      currentBlocks,
      annotationComments: planned.annotationComments,
    })).toEqual({
      creations: [],
      updates: [],
      deletions: [{ blockId: 'root-1', annotationId: 'annotation-1' }],
    });
  });

  it('拒绝用手写 canonical 身份创建批注', async () => {
    const unknown = { ...annotation, id: 'annotation-unknown' };
    const planned = await planMarkdownBlocks(
      `正文\n\n${encodeMarkdownAnnotationComment(unknown)}`
    );
    expect(() => planMarkdownFileAnnotationChanges({
      currentDocument,
      currentBlocks,
      annotationComments: planned.annotationComments,
    })).toThrow('未知 canonical 批注');
  });
});
