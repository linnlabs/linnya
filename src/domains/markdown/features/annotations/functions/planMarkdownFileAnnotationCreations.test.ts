import { describe, expect, it } from 'vitest';
import { planMarkdownBlocks } from '../../normalization';
import { flattenMarkdownDocumentBlocks } from '../../../shared';
import { planMarkdownFileAnnotationCreations } from './planMarkdownFileAnnotationCreations';

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

describe('planMarkdownFileAnnotationCreations', () => {
  it('保留 canonical 批注，并把普通 comment 规划成同一目标块的创建草稿', async () => {
    const canonical = JSON.stringify(annotation).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    const planned = await planMarkdownBlocks(
      `正文\n\n<!-- linnya-annotation:v1\n${canonical}\n-->\n\n<!-- 新批注 -->`
    );

    expect(planMarkdownFileAnnotationCreations({
      currentDocument,
      currentBlocks: flattenMarkdownDocumentBlocks(currentDocument),
      annotationComments: planned.annotationComments,
    })).toEqual([{ blockId: 'root-1', content: '新批注' }]);
  });

  it('拒绝借 file-style write 修改已有 canonical 批注', async () => {
    const planned = await planMarkdownBlocks('正文');
    expect(() => planMarkdownFileAnnotationCreations({
      currentDocument,
      currentBlocks: flattenMarkdownDocumentBlocks(currentDocument),
      annotationComments: planned.annotationComments,
    })).toThrow('只能原样保留');
  });
});
