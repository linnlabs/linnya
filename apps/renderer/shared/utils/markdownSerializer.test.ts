import { Schema } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { createMarkdownSerializer } from './markdownSerializer';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
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
    audioBlock: {
      group: 'block',
      atom: true,
      attrs: {
        src: { default: null },
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
      schema.nodes.audioBlock.create(),
    ]);

    const markdown = createMarkdownSerializer().serialize(doc);

    expect(markdown).toContain('## References');
    expect(markdown).toContain('[Image: Image, width 320px]');
    expect(markdown).toContain('[Empty audio block]');
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
});
