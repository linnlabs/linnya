import { describe, expect, it } from 'vitest';
import { importMarkdownToDocJson } from '../importMarkdownToDocJson';
import { flattenMarkdownDocumentBlocks, serializeMarkdownBlocks } from '../../../shared/markdownBlockProjection';
import type { ProseMirrorJsonNode } from '../types';

const project = (nodes: readonly ProseMirrorJsonNode[]) => serializeMarkdownBlocks(flattenMarkdownDocumentBlocks({ type: 'doc', content: nodes }));
const semantics = (node: ProseMirrorJsonNode): unknown => ({
  type: node.type, text: node.text, marks: node.marks,
  attrs: node.attrs && Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== 'id')),
  content: node.content?.map(semantics),
});

describe('Markdown canonical projection round-trip', () => {
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
