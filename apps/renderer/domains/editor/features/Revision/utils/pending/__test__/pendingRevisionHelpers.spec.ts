import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'

import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import type { MarkdownInlineProjection } from '../../../../../services/markdownRuntime/types'

const { parsePendingMarkdownToInlineProjection } = vi.hoisted(() => ({
  parsePendingMarkdownToInlineProjection: vi.fn(),
}))

vi.mock('../pendingMarkdownRuntime', () => ({
  parsePendingMarkdownToInlineProjection,
  classifyPendingMarkdownTable: vi.fn(),
  classifyPendingMarkdownTopLevelBlock: vi.fn(),
}))

import {
  buildTableRowsFromMarkdown,
  buildTableRowsFromParsedTable,
  detectBlockType,
  resolvePendingMarkdownForSingleBlock,
} from '../pendingRevisionHelpers'
import {
  classifyPendingMarkdownTable,
  classifyPendingMarkdownTopLevelBlock,
} from '../pendingMarkdownRuntime'

function createSchemaOnlyEditor(): Editor {
  return { state: { schema: workspaceMarkdownSchemaLite } } as unknown as Editor
}

describe('detectBlockType', () => {
  it('recognizes standard fenced code blocks as codeBlock and preserves full multiline content', () => {
    const markdown = [
      '```python',
      '# 这是一个Python代码示例',
      'def hello_world():',
      '    print("Hello, World!")',
      '    return "批量插入测试成功"',
      '',
      '# 调用函数',
      'result = hello_world()',
      'print(result)',
      '```',
    ].join('\n')

    expect(detectBlockType(markdown)).toEqual({
      contentType: 'codeBlock',
      blockAttrs: { language: 'python' },
      cleanMarkdown: [
        '# 这是一个Python代码示例',
        'def hello_world():',
        '    print("Hello, World!")',
        '    return "批量插入测试成功"',
        '',
        '# 调用函数',
        'result = hello_world()',
        'print(result)',
      ].join('\n'),
    })
  })
})

describe('buildTableRowsFromParsedTable', () => {
  beforeEach(() => {
    parsePendingMarkdownToInlineProjection.mockReset()
    vi.mocked(classifyPendingMarkdownTable).mockReset()
    vi.mocked(classifyPendingMarkdownTopLevelBlock).mockReset()
  })

  it('materializes table cells through runtime inline projection', async () => {
    const headerProjection: MarkdownInlineProjection = {
      fragments: [{ type: 'text', text: '表头', marks: [{ type: 'bold' }] }],
      spans: [{ text: '表头', marks: ['bold'] }],
      plainText: '表头',
      newlineMode: 'hardBreak',
      sourceBlockCount: 1,
      droppedBlockCount: 0,
    }
    const bodyProjection: MarkdownInlineProjection = {
      fragments: [
        { type: 'text', text: '第一行', marks: [{ type: 'strike' }] },
        { type: 'hardBreak', marks: [] },
        {
          type: 'inlineLatex',
          attrs: { latexSource: 'x+y' },
          latexSource: 'x+y',
          textRepresentation: '$x+y$',
        },
      ],
      spans: [
        { text: '第一行', marks: ['strike'] },
        { text: '\n$x+y$', marks: [] },
      ],
      plainText: '第一行\n$x+y$',
      newlineMode: 'hardBreak',
      sourceBlockCount: 1,
      droppedBlockCount: 0,
    }

    parsePendingMarkdownToInlineProjection.mockResolvedValueOnce(headerProjection)
    parsePendingMarkdownToInlineProjection.mockResolvedValueOnce(bodyProjection)

    const { rows } = await buildTableRowsFromParsedTable(
      { state: { schema: workspaceMarkdownSchemaLite } } as any,
      {
        headerCells: ['**表头**'],
        alignments: [null],
        bodyRows: [['第一行  \n$x+y$']],
      }
    )

    expect(rows).toHaveLength(2)

    const headerContent = rows[0]?.firstChild?.firstChild?.content?.toJSON()
    expect(headerContent).toEqual([{ type: 'text', text: '表头', marks: [{ type: 'bold' }] }])

    const bodyContent = rows[1]?.firstChild?.firstChild?.content?.toJSON()
    expect(bodyContent).toEqual([
      { type: 'text', text: '第一行', marks: [{ type: 'strike' }] },
      { type: 'hardBreak' },
      expect.objectContaining({
        type: 'inlineLatex',
        attrs: expect.objectContaining({
          latexSource: 'x+y',
        }),
      }),
    ])

    const roundTripJson = workspaceMarkdownSchemaLite
      .nodeFromJSON({
        type: 'table',
        attrs: { id: 'table-1', blockType: 'table' },
        content: rows.map((row) => row.toJSON()),
      })
      .toJSON()

    expect(
      (((roundTripJson.content?.[1] as { content?: Array<{ content?: Array<{ content?: unknown[] }> }> })
        ?.content?.[0]?.content?.[0]?.content ?? []) as unknown[])
    ).toEqual([
      { type: 'text', text: '第一行', marks: [{ type: 'strike' }] },
      { type: 'hardBreak' },
      expect.objectContaining({
        type: 'inlineLatex',
        attrs: expect.objectContaining({
          latexSource: 'x+y',
        }),
      }),
    ])
  })

  it('prefers wasm table model and preserves link marks in table cells', async () => {
    vi.mocked(classifyPendingMarkdownTable).mockResolvedValue({
      status: 'table',
      model: {
        with_header_row: true,
        header: [
          {
            content: [
              {
                type: 'text',
                text: '文档链接',
                marks: [
                  {
                    type: 'link',
                    attrs: { href: 'https://example.com?a=1|2', title: 'Example' },
                  },
                ],
              },
            ],
          },
        ],
        rows: [
          {
            cells: [
              {
                content: [
                  {
                    type: 'text',
                    text: '访问这里',
                    marks: [{ type: 'link', attrs: { href: 'https://example.com/path' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    })

    const result = await buildTableRowsFromMarkdown(
      { state: { schema: workspaceMarkdownSchemaLite } } as any,
      '| 文档链接 |\n| --- |\n| [访问这里](https://example.com/path) |'
    )

    expect(result.source).toBe('wasm-table-model')
    expect(parsePendingMarkdownToInlineProjection).not.toHaveBeenCalled()

    const headerContent = result.rows[0]?.firstChild?.firstChild?.content?.toJSON()
    expect(headerContent).toEqual([
      {
        type: 'text',
        text: '文档链接',
        marks: [
          {
            type: 'link',
            attrs: { href: 'https://example.com?a=1|2', title: 'Example' },
          },
        ],
      },
    ])

    const bodyContent = result.rows[1]?.firstChild?.firstChild?.content?.toJSON()
    expect(bodyContent).toEqual([
      {
        type: 'text',
        text: '访问这里',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/path', title: null } }],
      },
    ])
  })

  it('does not silently fall back to pipe-table parsing when wasm sees meaningful surrounding blocks', async () => {
    vi.mocked(classifyPendingMarkdownTable).mockResolvedValue({
      status: 'mixed-with-meaningful-surroundings',
      totalBlocks: 2,
    })

    const result = await buildTableRowsFromMarkdown(
      { state: { schema: workspaceMarkdownSchemaLite } } as any,
      '说明文字\n\n| h |\n| --- |\n| c |'
    )

    expect(result).toEqual({
      rows: [],
      source: 'none',
    })
    expect(parsePendingMarkdownToInlineProjection).not.toHaveBeenCalled()
  })
})

describe('resolvePendingMarkdownForSingleBlock', () => {
  beforeEach(() => {
    parsePendingMarkdownToInlineProjection.mockReset()
    vi.mocked(classifyPendingMarkdownTable).mockReset()
    vi.mocked(classifyPendingMarkdownTopLevelBlock).mockReset()
  })

  it('bypasses the wasm runtime for safe single-line plain text pending blocks', async () => {
    const result = await resolvePendingMarkdownForSingleBlock(
      createSchemaOnlyEditor(),
      '这是一段没有 markdown 结构的普通 pending 文本',
      { operation: 'testResolve', blockId: 'plain-fast-path' }
    )

    expect(result).toEqual({
      kind: 'content-block',
      contentType: 'baseBlock',
      blockAttrs: {},
      cleanMarkdown: '这是一段没有 markdown 结构的普通 pending 文本',
      spans: [{ text: '这是一段没有 markdown 结构的普通 pending 文本', marks: [] }],
      source: 'plain-text-fast-path',
    })
    expect(classifyPendingMarkdownTopLevelBlock).not.toHaveBeenCalled()
    expect(parsePendingMarkdownToInlineProjection).not.toHaveBeenCalled()
  })

  it('treats inline hashes and bare brackets as plain text when they do not form markdown syntax', async () => {
    const markdown = '测试块 #1 — 用于验证 revision 全局统计的自动生成内容。 [AI修订 #1]'
    const result = await resolvePendingMarkdownForSingleBlock(
      createSchemaOnlyEditor(),
      markdown,
      { operation: 'testResolve', blockId: 'plain-fast-path-with-label' }
    )

    expect(result).toEqual({
      kind: 'content-block',
      contentType: 'baseBlock',
      blockAttrs: {},
      cleanMarkdown: markdown,
      spans: [{ text: markdown, marks: [] }],
      source: 'plain-text-fast-path',
    })
    expect(classifyPendingMarkdownTopLevelBlock).not.toHaveBeenCalled()
    expect(parsePendingMarkdownToInlineProjection).not.toHaveBeenCalled()
  })

  it('keeps possible inline markdown on the runtime path instead of guessing plain text', async () => {
    vi.mocked(classifyPendingMarkdownTopLevelBlock).mockResolvedValue({
      status: 'single-block',
      block: {
        contentType: 'baseBlock',
        blockAttrs: {},
        cleanMarkdown: '加粗文本',
        inlineProjection: {
          fragments: [{ type: 'text', text: '加粗文本', marks: [{ type: 'bold' }] }],
          spans: [{ text: '加粗文本', marks: ['bold'] }],
          plainText: '加粗文本',
          newlineMode: 'hardBreak',
          sourceBlockCount: 1,
          droppedBlockCount: 0,
        },
        sourceBlockType: 'BaseBlock',
      },
    })

    const result = await resolvePendingMarkdownForSingleBlock(
      createSchemaOnlyEditor(),
      '**加粗文本**',
      { operation: 'testResolve', blockId: 'bold-runtime' }
    )

    expect(result).toEqual({
      kind: 'content-block',
      contentType: 'baseBlock',
      blockAttrs: {},
      cleanMarkdown: '加粗文本',
      spans: [{ text: '加粗文本', marks: ['bold'] }],
      source: 'runtime-single-block',
    })
    expect(classifyPendingMarkdownTopLevelBlock).toHaveBeenCalledWith('**加粗文本**', {
      operation: 'testResolve',
      blockId: 'bold-runtime',
    })
  })

  it('keeps links on the runtime path because brackets and parentheses form markdown syntax', async () => {
    vi.mocked(classifyPendingMarkdownTopLevelBlock).mockResolvedValue({
      status: 'single-block',
      block: {
        contentType: 'baseBlock',
        blockAttrs: {},
        cleanMarkdown: '链接',
        inlineProjection: {
          fragments: [
            {
              type: 'text',
              text: '链接',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
          spans: [{ text: '链接', marks: ['link'] }],
          plainText: '链接',
          newlineMode: 'hardBreak',
          sourceBlockCount: 1,
          droppedBlockCount: 0,
        },
        sourceBlockType: 'BaseBlock',
      },
    })

    const result = await resolvePendingMarkdownForSingleBlock(
      createSchemaOnlyEditor(),
      '[链接](https://example.com)',
      { operation: 'testResolve', blockId: 'link-runtime' }
    )

    expect(result.source).toBe('runtime-single-block')
    expect(classifyPendingMarkdownTopLevelBlock).toHaveBeenCalledWith('[链接](https://example.com)', {
      operation: 'testResolve',
      blockId: 'link-runtime',
    })
  })

  it('prefers runtime single-block classification for heading content', async () => {
    vi.mocked(classifyPendingMarkdownTopLevelBlock).mockResolvedValue({
      status: 'single-block',
      block: {
        contentType: 'headingBlock',
        blockAttrs: { level: 2 },
        cleanMarkdown: '标题 $x+y$',
        inlineProjection: {
          fragments: [],
          spans: [
            { text: '标题 ', marks: [] },
            {
              text: '$x+y$',
              marks: [],
              inlineAtom: {
                type: 'inlineLatex',
                latexSource: 'x+y',
                textRepresentation: '$x+y$',
                attrs: { latexSource: 'x+y' },
              },
            },
          ],
          plainText: '标题 $x+y$',
          newlineMode: 'hardBreak',
          sourceBlockCount: 1,
          droppedBlockCount: 0,
        },
        sourceBlockType: 'HeadingBlock',
      },
    })

    const result = await resolvePendingMarkdownForSingleBlock(
      { state: { schema: workspaceMarkdownSchemaLite } } as any,
      '## 标题 $x+y$',
      { operation: 'testResolve', blockId: 'heading-runtime' }
    )

    expect(result).toEqual({
      kind: 'content-block',
      contentType: 'headingBlock',
      blockAttrs: { level: 2 },
      cleanMarkdown: '标题 $x+y$',
      spans: [
        { text: '标题 ', marks: [] },
        {
          text: '$x+y$',
          marks: [],
          inlineAtom: {
            type: 'inlineLatex',
            latexSource: 'x+y',
            textRepresentation: '$x+y$',
            attrs: { latexSource: 'x+y' },
          },
        },
      ],
      source: 'runtime-single-block',
    })
    expect(parsePendingMarkdownToInlineProjection).not.toHaveBeenCalled()
  })

  it('returns a dedicated table-block resolution instead of masquerading as baseBlock', async () => {
    vi.mocked(classifyPendingMarkdownTopLevelBlock).mockResolvedValue({
      status: 'table',
      model: {
        with_header_row: true,
        header: [{ content: [{ type: 'text', text: '表头', marks: [] }] }],
        rows: [{ cells: [{ content: [{ type: 'text', text: '正文', marks: [] }] }] }],
      },
    })

    const result = await resolvePendingMarkdownForSingleBlock(
      { state: { schema: workspaceMarkdownSchemaLite } } as any,
      '| h |\n| --- |\n| c |',
      { operation: 'testResolve', blockId: 'table-runtime' }
    )

    expect(result.kind).toBe('table-block')
    expect(result.source).toBe('runtime-single-block')
    if (result.kind !== 'table-block') {
      throw new Error('expected table-block resolution')
    }
    expect(result.tableRowsResult.source).toBe('wasm-table-model')
    expect(result.tableRowsResult.rows).toHaveLength(2)
  })

  it('falls back to heuristic detection when runtime reports unsupported single-block types', async () => {
    vi.mocked(classifyPendingMarkdownTopLevelBlock).mockResolvedValue({
      status: 'unsupported-single-block',
      blockType: 'HorizontalRuleBlock',
    })
    parsePendingMarkdownToInlineProjection.mockResolvedValue({
      fragments: [{ type: 'text', text: '---', marks: [] }],
      spans: [{ text: '---', marks: [] }],
      plainText: '---',
      newlineMode: 'hardBreak',
      sourceBlockCount: 1,
      droppedBlockCount: 0,
    })

    const result = await resolvePendingMarkdownForSingleBlock(
      { state: { schema: workspaceMarkdownSchemaLite } } as any,
      '---',
      { operation: 'testResolve', blockId: 'hr-fallback' }
    )

    expect(result).toEqual({
      kind: 'content-block',
      contentType: 'baseBlock',
      blockAttrs: {},
      cleanMarkdown: '---',
      spans: [{ text: '---', marks: [] }],
      source: 'heuristic-fallback',
    })
    expect(parsePendingMarkdownToInlineProjection).toHaveBeenCalledWith('---', {
      operation: 'testResolve',
      blockId: 'hr-fallback',
    })
  })
})
