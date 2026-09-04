import { Schema } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { createMarkdownSerializer } from './markdownSerializer';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      content: 'baseBlock',
      attrs: { annotations: { default: [] } },
    },
    baseBlock: { group: 'block', content: 'inline*' },
    bibliographyBlock: { group: 'block', atom: true },
    imageBlock: {
      group: 'block',
      atom: true,
      attrs: {
        alt: { default: null },
        width: { default: null },
        height: { default: null },
      },
    },
  },
  marks: {
    link: {
      attrs: {
        href: { default: '' },
        title: { default: null },
      },
    },
  },
});

describe('markdownSerializer', () => {
  it('uses language-neutral default labels when no domain labels are provided', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.bibliographyBlock.create(),
      schema.nodes.imageBlock.create({ width: 320 }),
    ]);

    const markdown = createMarkdownSerializer().serialize(doc);

    expect(markdown).toContain('## References');
    expect(markdown).toContain('[Image: Image, width 320px]');
    expect(markdown).not.toMatch(/[\u4e00-\u9fff]/u);
  });

  it('preserves the Workspace Markdown link contract on export', () => {
    const link = schema.marks.link.create({
      href: 'https://example.com/docs',
      title: '示例文档',
    });
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.baseBlock.create(null, [schema.text('链接', [link])]),
    ]);

    expect(createMarkdownSerializer().serialize(doc)).toBe(
      '[链接](https://example.com/docs "示例文档")'
    );
  });

  it('exports document-owned annotations after their root block', () => {
    const annotation = {
      id: 'annotation-1',
      content: '建议补充依据',
      author: 'Reviewer',
      state: 'confirmed',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      resolvedAt: null,
      replies: [],
      meta: { source: 'manual' },
    };
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.rootBlock.create(
        { annotations: [annotation] },
        schema.nodes.baseBlock.create(null, schema.text('正文')),
      ),
    ]);

    const markdown = createMarkdownSerializer().serialize(doc);
    expect(markdown).toContain('正文\n\n<!-- linnya-annotation:v1\n');
    expect(markdown).toContain('"id":"annotation-1"');
  });

  it('exports an invisible Markdown anchor before annotations on an empty text block', () => {
    const annotation = {
      id: 'annotation-1',
      content: 'orphan',
      author: 'User',
      state: 'confirmed',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      resolvedAt: null,
      replies: [],
      meta: { source: 'manual' },
    }
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { annotations: [annotation] },
          content: [{ type: 'baseBlock' }],
        },
      ],
    })

    const markdown = createMarkdownSerializer().serialize(doc)
    expect(markdown).toContain('<!-- linnya-annotation-anchor:v1 empty-block -->')
    expect(markdown).toContain('<!-- linnya-annotation:v1\n')
  })
});
