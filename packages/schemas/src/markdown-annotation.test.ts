import { describe, expect, it } from 'vitest';
import {
  admitMarkdownAnnotationComment,
  decodeMarkdownAnnotationComment,
  encodeMarkdownAnnotationComment,
  parseMarkdownAnnotationComment,
} from './markdown-annotation';

const annotation = {
  id: 'annotation-1',
  content: 'avoid <!-- and --> with <script>',
  author: 'Reviewer',
  state: 'confirmed' as const,
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  resolvedAt: null,
  replies: [],
  meta: { source: 'manual' as const },
};

describe('Markdown Annotation comment profile', () => {
  it('用合法 HTML comment 无损编码 canonical Annotation', () => {
    const encoded = encodeMarkdownAnnotationComment(annotation);

    expect(encoded).toContain('<!-- linnya-annotation:v1\n');
    expect(encoded).toContain('\\u003cscript\\u003e');
    expect(encoded.slice(4, -3)).not.toContain('-->');
    expect(decodeMarkdownAnnotationComment(encoded)).toEqual(annotation);
  });

  it('把普通 HTML comment 解析为无身份 draft', () => {
    expect(parseMarkdownAnnotationComment('<!-- 建议补充依据。 -->')).toEqual({
      kind: 'plain',
      draft: { content: '建议补充依据。' },
    });
  });

  it('只在 admission 边界为普通 comment 分配业务身份', () => {
    expect(admitMarkdownAnnotationComment('<!-- 建议补充依据。 -->', {
      id: 'annotation-imported',
      author: 'User',
      timestamp: '2026-09-04T01:02:03.000Z',
    })).toEqual({
      id: 'annotation-imported',
      content: '建议补充依据。',
      author: 'User',
      state: 'confirmed',
      createdAt: '2026-09-04T01:02:03.000Z',
      updatedAt: '2026-09-04T01:02:03.000Z',
      resolvedAt: null,
      replies: [],
      meta: { source: 'manual' },
    });
    expect(admitMarkdownAnnotationComment(
      encodeMarkdownAnnotationComment(annotation),
      {
        id: 'ignored',
        author: 'Ignored',
        timestamp: '2026-09-04T01:02:03.000Z',
      },
    )).toEqual(annotation);
  });

  it('拒绝未知 Linnya profile 和额外字段', () => {
    expect(() => parseMarkdownAnnotationComment('<!-- linnya-annotation:v2\n{}\n-->'))
      .toThrow('不支持的 profile');
    expect(() => encodeMarkdownAnnotationComment({ ...annotation, unexpected: true }))
      .toThrow();
  });
});
