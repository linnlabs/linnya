import { beforeEach, describe, expect, it, vi } from 'vitest'

const { parseMarkdownToBlockEvents } = vi.hoisted(() => ({
  parseMarkdownToBlockEvents: vi.fn(),
}))

vi.mock('../../../../../services/markdownRuntime', async () => {
  const actual = await vi.importActual<typeof import('../../../../../services/markdownRuntime')>(
    '../../../../../services/markdownRuntime'
  )

  return {
    ...actual,
    parseMarkdownToBlockEvents,
  }
})

import {
  classifyPendingMarkdownTopLevelBlock,
  classifyPendingMarkdownTable,
  parsePendingMarkdownToSpans,
  parsePendingMarkdownToTableModel,
} from '../pendingMarkdownRuntime'

describe('pendingMarkdownRuntime', () => {
  beforeEach(() => {
    parseMarkdownToBlockEvents.mockReset()
  })

  it('uses runtime inline projection for inlineLatex and hardBreak', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([
      {
        block_type: 'BaseBlock',
        structured_content: [
          { type: 'text', text: '第一行', marks: [{ type: 'bold' }] },
          { type: 'hardBreak', marks: [{ type: 'bold' }] },
          { type: 'inlineLatex', attrs: { latexSource: 'x+y' } },
        ],
      },
    ])

    await expect(
      parsePendingMarkdownToSpans('ignored', {
        operation: 'testPendingRuntime',
        blockId: 'block-1',
      })
    ).resolves.toEqual([
      { text: '第一行\n', marks: ['bold'] },
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
    ])
  })

  it('falls back to plain text spans when wasm returns no blocks', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([])

    await expect(
      parsePendingMarkdownToSpans('plain fallback', {
        operation: 'testPendingRuntime',
      })
    ).resolves.toEqual([{ text: 'plain fallback', marks: [] }])
  })

  it('consumes only the first block for pending single-block parsing', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([
      {
        block_type: 'HeadingBlock',
        structured_content: [{ type: 'text', text: '标题', marks: [] }],
      },
      {
        block_type: 'BaseBlock',
        structured_content: [{ type: 'text', text: '段落', marks: [] }],
      },
    ])

    await expect(
      parsePendingMarkdownToSpans('multi block', {
        operation: 'testPendingRuntime',
        blockId: 'block-2',
      })
    ).resolves.toEqual([{ text: '标题', marks: [] }])
  })

  it('extracts table model from a single TableBlock event', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([
      {
        block_type: 'TableBlock',
        attrs: {
          with_header_row: true,
          header: [{ content: [{ type: 'text', text: '表头', marks: [] }] }],
          rows: [{ cells: [{ content: [{ type: 'text', text: '正文', marks: [] }] }] }],
        },
      },
    ])

    await expect(
      parsePendingMarkdownToTableModel('| h |\n| - |\n| c |', {
        operation: 'testPendingRuntime',
        blockId: 'table-1',
      })
    ).resolves.toEqual({
      with_header_row: true,
      header: [{ content: [{ type: 'text', text: '表头', marks: [] }] }],
      rows: [{ cells: [{ content: [{ type: 'text', text: '正文', marks: [] }] }] }],
    })
  })

  it('accepts a single TableBlock surrounded by ignorable empty events', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([
      {
        block_type: 'BaseBlock',
        raw_content_fallback: '   ',
      },
      {
        block_type: 'TableBlock',
        attrs: {
          with_header_row: true,
          header: [{ content: [{ type: 'text', text: '表头', marks: [] }] }],
          rows: [{ cells: [{ content: [{ type: 'text', text: '正文', marks: [] }] }] }],
        },
      },
      {
        block_type: 'BaseBlock',
        structured_content: [{ type: 'hardBreak' }],
      },
    ])

    await expect(
      parsePendingMarkdownToTableModel('| h |\n| - |\n| c |', {
        operation: 'testPendingRuntime',
        blockId: 'table-ignorable',
      })
    ).resolves.toEqual({
      with_header_row: true,
      header: [{ content: [{ type: 'text', text: '表头', marks: [] }] }],
      rows: [{ cells: [{ content: [{ type: 'text', text: '正文', marks: [] }] }] }],
    })
  })

  it('rejects table mode when surrounding blocks carry meaningful content', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([
      {
        block_type: 'BaseBlock',
        raw_content_fallback: '说明文字',
      },
      {
        block_type: 'TableBlock',
        attrs: {
          with_header_row: true,
          header: [{ content: [{ type: 'text', text: '表头', marks: [] }] }],
          rows: [{ cells: [{ content: [{ type: 'text', text: '正文', marks: [] }] }] }],
        },
      },
    ])

    await expect(
      parsePendingMarkdownToTableModel('说明文字\n\n| h |\n| - |\n| c |', {
        operation: 'testPendingRuntime',
        blockId: 'table-meaningful',
      })
    ).resolves.toBeNull()
  })

  it('reports mixed table shape explicitly for callers that need to avoid pipe fallback guessing', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([
      {
        block_type: 'BaseBlock',
        raw_content_fallback: '说明文字',
      },
      {
        block_type: 'TableBlock',
        attrs: {
          with_header_row: true,
          header: [{ content: [{ type: 'text', text: '表头', marks: [] }] }],
          rows: [{ cells: [{ content: [{ type: 'text', text: '正文', marks: [] }] }] }],
        },
      },
    ])

    await expect(
      classifyPendingMarkdownTable('说明文字\n\n| h |\n| - |\n| c |', {
        operation: 'testPendingRuntime',
        blockId: 'table-mixed-status',
      })
    ).resolves.toEqual({
      status: 'mixed-with-meaningful-surroundings',
      totalBlocks: 2,
    })
  })

  it('classifies a single heading block into canonical pending block metadata', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([
      {
        block_type: 'HeadingBlock',
        level: 2,
        structured_content: [
          { type: 'text', text: '标题 ', marks: [] },
          { type: 'inlineLatex', attrs: { latexSource: 'x+y' } },
        ],
      },
    ])

    await expect(
      classifyPendingMarkdownTopLevelBlock('## 标题 $x+y$', {
        operation: 'testTopLevelClassifier',
        blockId: 'heading-1',
      })
    ).resolves.toEqual({
      status: 'single-block',
      block: {
        contentType: 'headingBlock',
        blockAttrs: { level: 2 },
        cleanMarkdown: '标题 $x+y$',
        inlineProjection: expect.objectContaining({
          plainText: '标题 $x+y$',
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
        }),
        sourceBlockType: 'HeadingBlock',
      },
    })
  })

  it('classifies a pure table as top-level table content', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([
      {
        block_type: 'TableBlock',
        attrs: {
          with_header_row: true,
          header: [{ content: [{ type: 'text', text: '表头', marks: [] }] }],
          rows: [{ cells: [{ content: [{ type: 'text', text: '正文', marks: [] }] }] }],
        },
      },
    ])

    await expect(
      classifyPendingMarkdownTopLevelBlock('| h |\n| - |\n| c |', {
        operation: 'testTopLevelClassifier',
        blockId: 'table-top-level',
      })
    ).resolves.toEqual({
      status: 'table',
      model: {
        with_header_row: true,
        header: [{ content: [{ type: 'text', text: '表头', marks: [] }] }],
        rows: [{ cells: [{ content: [{ type: 'text', text: '正文', marks: [] }] }] }],
      },
    })
  })

  it('reports multiple meaningful blocks instead of guessing a top-level canonical block', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([
      {
        block_type: 'HeadingBlock',
        structured_content: [{ type: 'text', text: '标题', marks: [] }],
      },
      {
        block_type: 'BaseBlock',
        structured_content: [{ type: 'text', text: '段落', marks: [] }],
      },
    ])

    await expect(
      classifyPendingMarkdownTopLevelBlock('## 标题\n\n段落', {
        operation: 'testTopLevelClassifier',
        blockId: 'multi-1',
      })
    ).resolves.toEqual({
      status: 'multiple-meaningful-blocks',
      totalBlocks: 2,
      blockTypes: ['HeadingBlock', 'BaseBlock'],
    })
  })

  it('reports unsupported single-block types so callers can fall back heuristically', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([
      {
        block_type: 'HorizontalRuleBlock',
      },
    ])

    await expect(
      classifyPendingMarkdownTopLevelBlock('---', {
        operation: 'testTopLevelClassifier',
        blockId: 'hr-1',
      })
    ).resolves.toEqual({
      status: 'unsupported-single-block',
      blockType: 'HorizontalRuleBlock',
    })
  })
})
