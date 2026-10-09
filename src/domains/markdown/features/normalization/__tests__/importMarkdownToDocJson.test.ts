import { describe, expect, it } from 'vitest';

import { importMarkdownToDocJson } from '../importMarkdownToDocJson';
import type { WasmBlockEventLike } from '../types';

describe('importMarkdownToDocJson', () => {
  it('binds canonical and plain HTML comments to the preceding root block', async () => {
    const canonical = {
      id: 'annotation-existing',
      content: '保留身份',
      author: 'Reviewer',
      state: 'confirmed' as const,
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      resolvedAt: null,
      replies: [],
      meta: { source: 'manual' as const }
    };
    const fakeParser = async (): Promise<WasmBlockEventLike[]> => [
      { block_type: 'BaseBlock', raw_content_fallback: '正文' },
      {
        block_type: 'HtmlComment',
        raw_content_fallback: `<!-- linnya-annotation:v1\n${JSON.stringify(canonical)}\n-->`
      },
      { block_type: 'HtmlComment', raw_content_fallback: '<!-- 普通批注 -->' }
    ];

    const result = await importMarkdownToDocJson('ignored', fakeParser);
    const annotations = result.docJson?.content[0]?.attrs?.annotations;

    expect(result.docJson?.content).toHaveLength(1);
    expect(annotations).toEqual([
      canonical,
      expect.objectContaining({
        id: expect.stringMatching(/^annotation-[0-9a-f]{8}$/i),
        content: '普通批注',
        author: 'User',
        state: 'confirmed',
        meta: { source: 'manual' }
      })
    ]);
  });

  it('rejects an annotation comment without a target block', async () => {
    const fakeParser = async (): Promise<WasmBlockEventLike[]> => [
      { block_type: 'HtmlComment', raw_content_fallback: '<!-- orphan -->' }
    ];

    await expect(importMarkdownToDocJson('ignored', fakeParser))
      .rejects.toThrow('前没有可绑定的目标块');
  });

  it('round-trips an annotation bound to an empty root block', async () => {
    const fakeParser = async (): Promise<WasmBlockEventLike[]> => [
      {
        block_type: 'HtmlComment',
        raw_content_fallback: '<!-- linnya-annotation-anchor:v1 empty-block -->',
      },
      { block_type: 'HtmlComment', raw_content_fallback: '<!-- 空块批注 -->' },
    ];

    const result = await importMarkdownToDocJson('ignored', fakeParser);

    expect(result.docJson?.content).toHaveLength(1);
    expect(result.docJson?.content[0]?.content?.[0]?.type).toBe('baseBlock');
    expect(result.docJson?.content[0]?.content?.[0]?.content ?? []).toEqual([]);
    expect(result.docJson?.content[0]?.attrs?.annotations).toEqual([
      expect.objectContaining({ content: '空块批注', state: 'confirmed' }),
    ]);
  });

  it('can convert block events into validated doc json', async () => {
    const fakeParser = async (): Promise<WasmBlockEventLike[]> => [
      {
        block_type: 'HeadingBlock',
        level: 2,
        structured_content: [{ type: 'text', text: '章节标题' }]
      },
      {
        block_type: 'ListItemBlock',
        list_type: 'bullet',
        list_level: 1,
        structured_content: [{ type: 'text', text: '列表项内容' }]
      },
      {
        block_type: 'LatexBlock',
        raw_content_fallback: 'E = mc^2'
      },
      {
        block_type: 'TableBlock',
        attrs: {
          with_header_row: true,
          header: [
            { content: [{ type: 'text', text: '列1' }] },
            { content: [{ type: 'text', text: '列2' }] }
          ],
          rows: [
            {
              cells: [
                { content: [{ type: 'text', text: 'A1' }] },
                { content: [{ type: 'text', text: 'B1' }] }
              ]
            }
          ]
        }
      }
    ];

    const result = await importMarkdownToDocJson('# demo', fakeParser);

    expect(result.blockEvents).toHaveLength(4);
    expect(result.docJson?.type).toBe('doc');
    expect(result.docJson?.content).toHaveLength(4);
    expect(result.docJson?.content[0]?.type).toBe('rootBlock');
    expect(result.docJson?.content[0]?.attrs?.id).toMatch(/^root-[0-9a-f]{8}$/i);
    expect(result.docJson?.content[0]?.content?.[0]?.type).toBe('headingBlock');
    expect(result.docJson?.content[1]?.content?.[0]?.type).toBe('listItemBlock');
    expect(result.docJson?.content[2]?.content?.[0]?.type).toBe('latexBlock');
    expect(result.docJson?.content[3]?.content?.[0]?.type).toBe('table');
  });

  it('collapses repeated emphasis marks emitted around a link', async () => {
    const result = await importMarkdownToDocJson(
      '*[*研究记录*](sea-datacenters-ordinary-notes-20260922)*'
    );

    expect(result.docJson?.content[0]?.content?.[0]?.content).toEqual([
      {
        type: 'text',
        text: '研究记录',
        marks: [
          { type: 'italic' },
          {
            type: 'link',
            attrs: { href: 'sea-datacenters-ordinary-notes-20260922', title: null },
          },
        ],
      },
    ]);
  });

  it('returns null doc for empty markdown', async () => {
    const result = await importMarkdownToDocJson('   ');
    expect(result.docJson).toBeNull();
    expect(result.blockEvents).toEqual([]);
  });

  it('preserves hardBreak fragments in inline content', async () => {
    const fakeParser = async (): Promise<WasmBlockEventLike[]> => [
      {
        block_type: 'ParagraphBlock',
        structured_content: [
          { type: 'text', text: '第一行', marks: [{ type: 'bold' }] },
          { type: 'hardBreak', marks: [{ type: 'bold' }] },
          { type: 'text', text: '第二行', marks: [{ type: 'bold' }] }
        ]
      }
    ];

    const result = await importMarkdownToDocJson('第一行  \n第二行', fakeParser);

    const content = result.docJson?.content[0]?.content?.[0]?.content;
    expect(content).toEqual([
      { type: 'text', text: '第一行', marks: [{ type: 'bold' }] },
      { type: 'hardBreak', marks: [{ type: 'bold' }] },
      { type: 'text', text: '第二行', marks: [{ type: 'bold' }] }
    ]);
  });

  it('normalizes numbered headings without reinterpreting parser block boundaries', async () => {
    const fakeParser = async (): Promise<WasmBlockEventLike[]> => [
      {
        block_type: 'HeadingBlock',
        level: 2,
        raw_content_fallback: '1. 基本段落',
        structured_content: [{ type: 'text', text: '基本段落' }]
      },
      { block_type: 'CodeBlock', language: 'text', raw_content_fallback: '```\n# literal' }
    ];
    const result = await importMarkdownToDocJson('ignored', fakeParser);
    expect(result.blockEvents).toHaveLength(2);
    expect(result.docJson?.content[0]?.content?.[0]?.content).toEqual([
      { type: 'text', text: '1. 基本段落' }
    ]);
    expect(result.docJson?.content[1]?.content?.[0]?.content).toEqual([
      { type: 'text', text: '```\n# literal' }
    ]);
  });
});
