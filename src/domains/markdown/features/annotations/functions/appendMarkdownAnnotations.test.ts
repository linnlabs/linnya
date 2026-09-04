import { describe, expect, it } from 'vitest';
import { appendMarkdownAnnotations } from './appendMarkdownAnnotations';

const annotation = {
  id: 'annotation-1',
  content: '建议补充依据',
  author: 'Reviewer',
  state: 'confirmed' as const,
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  resolvedAt: null,
  replies: [],
  meta: { source: 'review' as const, reviewRunId: 'review-1' },
};

const document = {
  type: 'doc' as const,
  content: [{
    type: 'rootBlock',
    attrs: { id: 'root-1', annotations: [] },
    content: [{
      type: 'baseBlock',
      attrs: { id: 'block-1', blockType: 'base' },
      content: [{ type: 'text', text: '正文' }],
    }],
  }],
};

describe('appendMarkdownAnnotations', () => {
  it('appends annotations without mutating the source document', () => {
    const updated = appendMarkdownAnnotations(document, [{
      blockId: 'root-1',
      annotation,
    }]);

    expect(updated.content[0]?.attrs?.annotations).toEqual([annotation]);
    expect(document.content[0]?.attrs?.annotations).toEqual([]);
  });

  it('allows annotations on an empty base block', () => {
    const emptyDocument = {
      ...document,
      content: [{
        ...document.content[0],
        content: [{
          type: 'baseBlock',
          attrs: { id: 'block-1', blockType: 'base' },
          content: [],
        }],
      }],
    };

    expect(appendMarkdownAnnotations(emptyDocument, [{
      blockId: 'root-1',
      annotation,
    }]).content[0]?.attrs?.annotations).toEqual([annotation]);
  });

  it('rejects missing targets and duplicate identities', () => {
    expect(() => appendMarkdownAnnotations(document, [{
      blockId: 'missing',
      annotation,
    }])).toThrow('目标块不存在');

    const withExisting = appendMarkdownAnnotations(document, [{
      blockId: 'root-1',
      annotation,
    }]);
    expect(() => appendMarkdownAnnotations(withExisting, [{
      blockId: 'root-1',
      annotation,
    }])).toThrow('ID 重复');
  });
});
