import { describe, expect, it } from 'vitest';
import { importMarkdownToDocJson } from '../importMarkdownToDocJson';
import { flattenMarkdownDocumentBlocks, serializeMarkdownBlocks } from '../../../shared/markdownBlockProjection';
import type { ProseMirrorJsonNode } from '../types';
import { serializeRootBlockToMarkdown } from '../markdownJsonSerializer';
import { importPendingMarkdownRootBlock } from '../../pending-revisions';

const project = (nodes: readonly ProseMirrorJsonNode[]) => serializeMarkdownBlocks(flattenMarkdownDocumentBlocks({ type: 'doc', content: nodes }));
const semantics = (node: ProseMirrorJsonNode): unknown => ({
  type: node.type, text: node.text, marks: node.marks,
  attrs: node.attrs && Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== 'id')),
  content: node.content?.map(semantics),
});

describe('Markdown canonical projection round-trip', () => {
  it.each([
    ['paragraph', 'Paragraph with **bold**, $x^2$ and `code`.'],
    ['heading', '## Heading'],
    ['quote', '> quoted\n> second line'],
    ['bullet', '- item'],
    ['ordered', '3) item'],
    ['code', '````text\n```\n# literal heading\n````'],
    ['table', '| A | B |\n| --- | ---: |\n| one | two |'],
    ['horizontal rule', '---'],
    ['formula', '$$\n\\frac{x^2}{y} + 1\n$$'],
    ['image', '![Synthetic](linnya-image://synthetic-image)'],
    ['chart', '```linnya-chart\n{"chartType":"bar","categories":["A"],"series":[{"name":"S","values":[1]}]}\n```'],
  ])('%s 单块序列化后仍经接受/写入共用导入器解析为一个同类型块', async (_name, markdown) => {
    const document = (await importMarkdownToDocJson(markdown)).docJson;
    if (!document) throw new Error('Missing root block');
    for (const root of document.content) {
      const canonical = serializeRootBlockToMarkdown(root);
      const reimported = await importPendingMarkdownRootBlock(canonical);
      expect(reimported?.content?.[0]?.type).toBe(root.content?.[0]?.type);
      expect(reimported && serializeRootBlockToMarkdown(reimported)).toBe(canonical);
    }
  });
  it('keeps ordinary prose readable while retaining literal Markdown and inline code', async () => {
    const markdown = 'Clause 202(c), foo_bar, price > cost and C# all remain prose.\n\n\\# Literal heading\n\n\\*not emphasis\\* and **real emphasis**; literal \\~foo\\~ and \\~\\~bar\\~\\~; `` code ` literal ``.';
    const first = (await importMarkdownToDocJson(markdown)).docJson;
    if (!first) throw new Error('Missing parsed document');
    const output = project(first.content);
    expect(output).toContain('Clause 202(c), foo_bar, price > cost and C#');
    const second = (await importMarkdownToDocJson(output)).docJson;
    expect(second && semantics(second)).toEqual(semantics(first));
    expect(second && project(second.content)).toBe(output);
  });
  it('retains ordered starts, marker choice and table alignment through repeated import', async () => {
    const markdown = '0) zero\n3) three\n4) four\n\nInterruption.\n7. seven\n8. eight\n\n- dash\n+ plus\n* star\n\n| Name | Amount | Center |\n| :--- | ---: | :---: |\n| a | 12 | c |';
    const first = (await importMarkdownToDocJson(markdown)).docJson;
    if (!first) throw new Error('Missing parsed document');
    const output = project(first.content);
    expect(output).toContain('0) zero\n3) three\n4) four');
    expect(output).toContain('4) four');
    expect(output).toContain('7. seven');
    expect(output).toContain('8. eight');
    expect(output).toContain('- dash');
    expect(output).toContain('+ plus');
    expect(output).toContain('* star');
    expect(output).toContain('| :--- | ---: | :---: |');
    const second = (await importMarkdownToDocJson(output)).docJson;
    expect(second && semantics(second)).toEqual(semantics(first));
    expect(second && project(second.content)).toBe(output);
  });
});
