import { describe, expect, it } from 'vitest';

import { importMarkdownToDocJson } from '../importMarkdownToDocJson';
import type { WasmBlockEventLike } from '../types';

describe('importMarkdownToDocJson', () => {
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

  it('normalizes numbered headings and malformed fenced code sequences before doc conversion', async () => {
    const fakeParser = async (): Promise<WasmBlockEventLike[]> => [
      {
        block_type: 'HeadingBlock',
        level: 2,
        raw_content_fallback: '1. 基本段落',
        structured_content: [{ type: 'text', text: '基本段落' }]
      },
      {
        block_type: 'BaseBlock',
        raw_content_fallback: '```python\ndef hello_world():\n    print(\"hello\")',
        structured_content: [
          { type: 'text', text: 'def hello_world():\n    print("hello")' }
        ]
      },
      {
        block_type: 'HeadingBlock',
        level: 1,
        raw_content_fallback: '调用函数',
        structured_content: [{ type: 'text', text: '调用函数' }]
      },
      {
        block_type: 'BaseBlock',
        raw_content_fallback: 'print(hello_world())\n```',
        structured_content: [{ type: 'text', text: 'print(hello_world())' }]
      }
    ];

    const result = await importMarkdownToDocJson('ignored', fakeParser);

    expect(result.blockEvents).toEqual([
      {
        block_type: 'HeadingBlock',
        level: 2,
        raw_content_fallback: '1. 基本段落',
        structured_content: [
          { type: 'text', text: '1. ' },
          { type: 'text', text: '基本段落' }
        ]
      },
      {
        block_type: 'CodeBlock',
        language: 'python',
        raw_content_fallback: [
          'def hello_world():',
          '    print("hello")',
          '',
          '# 调用函数',
          '',
          'print(hello_world())'
        ].join('\n')
      }
    ]);

    const headingContent = result.docJson?.content[0]?.content?.[0]?.content;
    expect(headingContent).toEqual([
      { type: 'text', text: '1. ' },
      { type: 'text', text: '基本段落' }
    ]);
    expect(result.docJson?.content[1]?.content?.[0]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'python' },
      content: [
        {
          type: 'text',
          text: [
            'def hello_world():',
            '    print("hello")',
            '',
            '# 调用函数',
            '',
            'print(hello_world())'
          ].join('\n')
        }
      ]
    });
  });
});
