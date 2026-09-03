import { describe, expect, it } from 'vitest';

import { attachCitationNodesToDocJson } from '../citationNodeHydration';
import { validateMarkdownDocJson } from '../schemaLite';
import type { MarkdownDocJson, ProseMirrorJsonNode } from '../types';

function buildDoc(content: ProseMirrorJsonNode[]): MarkdownDocJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'rootBlock',
        attrs: { id: 'root-1' },
        content: [
          {
            type: 'baseBlock',
            attrs: { id: 'block-1', blockType: 'base' },
            content,
          },
        ],
      },
    ],
  };
}

function inlineContent(doc: MarkdownDocJson): ProseMirrorJsonNode[] {
  return doc.content[0]?.content?.[0]?.content ?? [];
}

describe('attachCitationNodesToDocJson', () => {
  it('Schema 规范化保留稳定来源身份和离线快照', () => {
    const doc = buildDoc([
      {
        type: 'citationNode',
        attrs: {
          citationId: 'citation-1',
          ref: 'Abc234',
          sourceType: 'knowledge_base',
          sourceId: 'doc-1',
          kbId: 'kb-1',
          blockId: 'block-1',
          title: 'Doc 1',
          snippet: 'First excerpt',
          snippets: ['First excerpt', 'Second excerpt'],
        },
      },
    ]);

    expect(inlineContent(validateMarkdownDocJson(doc))[0]).toMatchObject({
      type: 'citationNode',
      attrs: {
        citationId: 'citation-1',
        ref: 'Abc234',
        sourceId: 'doc-1',
        kbId: 'kb-1',
        blockId: 'block-1',
        title: 'Doc 1',
        snippet: 'First excerpt',
        snippets: ['First excerpt', 'Second excerpt'],
      },
    });
  });

  it('把 Markdown 单条和聚合语法投影为相邻的原子 CitationNode', () => {
    const result = attachCitationNodesToDocJson(
      buildDoc([{ type: 'text', text: '结论[@Abc234; @Def567]。' }]),
      {
        Abc234: {
          docId: 'doc-1',
          blockId: 'block-1',
          title: 'Doc 1',
          snippet: 'Snippet 1',
          kbId: 'kb-1',
          sourceType: 'knowledge_base',
        },
        Def567: {
          url: 'https://example.com/article',
          title: 'Article',
          snippet: 'Snippet 2',
          sourceType: 'web',
        },
      }
    );

    const content = inlineContent(result);
    expect(content).toHaveLength(4);
    expect(content[0]).toMatchObject({ type: 'text', text: '结论' });
    expect(content[1]).toMatchObject({
      type: 'citationNode',
      attrs: {
        ref: 'Abc234',
        sourceType: 'knowledge_base',
        sourceId: 'doc-1',
        blockId: 'block-1',
        title: 'Doc 1',
        snippet: 'Snippet 1',
      },
    });
    expect(content[2]).toMatchObject({
      type: 'citationNode',
      attrs: {
        ref: 'Def567',
        sourceType: 'web',
        sourceId: 'https://example.com/article',
        url: 'https://example.com/article',
      },
    });
    expect(content[3]).toMatchObject({ type: 'text', text: '。' });
  });

  it('跨 Markdown parser 拆分的相邻文本节点识别 citation token', () => {
    const parsedDoc = buildDoc([
      { type: 'text', text: '结论 ' },
      { type: 'text', text: '[' },
      { type: 'text', text: '@Abc234' },
      { type: 'text', text: ']' },
      { type: 'text', text: '。' },
    ]);
    const originalParserOutput = JSON.stringify(parsedDoc);
    const result = attachCitationNodesToDocJson(parsedDoc, {
      Abc234: {
        url: 'https://example.com/report',
        title: 'Report',
        snippet: 'Evidence snapshot',
        sourceType: 'web',
      },
    });

    expect(inlineContent(result)).toEqual([
      { type: 'text', text: '结论 ' },
      expect.objectContaining({
        type: 'citationNode',
        attrs: expect.objectContaining({ ref: 'Abc234' }),
      }),
      { type: 'text', text: '。' },
    ]);
    expect(JSON.stringify(parsedDoc)).toBe(originalParserOutput);
  });

  it('保留 CitationNode 外层格式，并忽略 inline code 与 fenced code 中的示例', () => {
    const inlineCode = buildDoc([
      { type: 'text', text: '粗体[@Abc234]', marks: [{ type: 'bold' }] },
      { type: 'text', text: '代码[@Abc234]', marks: [{ type: 'code' }] },
    ]);
    const hydratedInline = attachCitationNodesToDocJson(inlineCode, {
      Abc234: {
        docId: 'doc-1',
        blockId: 'block-1',
        title: 'Doc 1',
        snippet: 'Snippet 1',
        sourceType: 'knowledge_base',
      },
    });

    expect(inlineContent(hydratedInline)[1]).toMatchObject({
      type: 'citationNode',
      marks: [{ type: 'bold' }],
    });
    expect(inlineContent(hydratedInline)[2]).toMatchObject({
      type: 'text',
      text: '代码[@Abc234]',
      marks: [{ type: 'code' }],
    });

    const codeDoc: MarkdownDocJson = {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root-code' },
          content: [
            {
              type: 'codeBlock',
              attrs: { id: 'code-1', blockType: 'code', language: 'md' },
              content: [{ type: 'text', text: '示例 [@Abc234]' }],
            },
          ],
        },
      ],
    };
    const hydratedCode = attachCitationNodesToDocJson(codeDoc, {
      Abc234: {
        docId: 'doc-1',
        blockId: 'block-1',
        title: 'Doc 1',
        snippet: 'Snippet 1',
      },
    });
    const codeContent = hydratedCode.content[0]?.content?.[0]?.content ?? [];
    expect(codeContent).toEqual([{ type: 'text', text: '示例 [@Abc234]' }]);
    expect(JSON.stringify(hydratedCode)).not.toContain('citationNode');
  });

  it('缺少 hydration 的 ref 保留 canonical Markdown 文本，不伪造引用节点', () => {
    const result = attachCitationNodesToDocJson(
      buildDoc([{ type: 'text', text: '[@Abc234; @Def567]' }]),
      {
        Abc234: {
          docId: 'doc-1',
          blockId: 'block-1',
          title: 'Doc 1',
          snippet: 'Snippet 1',
        },
      }
    );

    expect(inlineContent(result)).toEqual([
      expect.objectContaining({
        type: 'citationNode',
        attrs: expect.objectContaining({ ref: 'Abc234' }),
      }),
      { type: 'text', text: '[@Def567]' },
    ]);
  });
});
