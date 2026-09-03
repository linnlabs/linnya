import { describe, expect, it, vi } from 'vitest'

import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import {
  blockEventToInlineProjection,
  blockEventsToInlineProjection,
  buildInlineNodesFromProjection,
} from './index'
import type { BlockEventLike } from './types'

describe('markdownRuntime inlineProjection', () => {
  it('keeps hardBreak as a first-class fragment while exposing newline spans', () => {
    const projection = blockEventToInlineProjection({
      block_type: 'BaseBlock',
      structured_content: [
        { type: 'text', text: '第一行', marks: [{ type: 'bold' }] },
        { type: 'hardBreak', marks: [{ type: 'bold' }] },
        { type: 'text', text: '第二行', marks: [{ type: 'bold' }] },
      ],
    })

    expect(projection.newlineMode).toBe('hardBreak')
    expect(projection.fragments.map((fragment) => fragment.type)).toEqual([
      'text',
      'hardBreak',
      'text',
    ])
    expect(projection.spans).toEqual([
      { text: '第一行\n第二行', marks: ['bold'] },
    ])

    const nodes = buildInlineNodesFromProjection(projection, workspaceMarkdownSchemaLite)
    expect(nodes.map((node) => node.toJSON())).toEqual([
      { type: 'text', text: '第一行', marks: [{ type: 'bold' }] },
      { type: 'hardBreak', marks: [{ type: 'bold' }] },
      { type: 'text', text: '第二行', marks: [{ type: 'bold' }] },
    ])
  })

  it('preserves inlineLatex in fragments and degrades to text spans for diff consumers', () => {
    const projection = blockEventToInlineProjection({
      block_type: 'BaseBlock',
      structured_content: [
        { type: 'text', text: '公式 ', marks: [] },
        { type: 'inlineLatex', attrs: { latexSource: 'E=mc^2' } },
      ],
    })

    expect(projection.fragments.map((fragment) => fragment.type)).toEqual([
      'text',
      'inlineLatex',
    ])
    expect(projection.spans).toEqual([
      { text: '公式 ', marks: [] },
      {
        text: '$E=mc^2$',
        marks: [],
        inlineAtom: {
          type: 'inlineLatex',
          latexSource: 'E=mc^2',
          textRepresentation: '$E=mc^2$',
          attrs: { latexSource: 'E=mc^2' },
        },
      },
    ])

    const nodes = buildInlineNodesFromProjection(projection, workspaceMarkdownSchemaLite)
    expect(nodes[0]?.toJSON()).toEqual({ type: 'text', text: '公式 ' })
    expect(nodes[1]?.type.name).toBe('inlineLatex')
    expect(nodes[1]?.attrs.latexSource).toBe('E=mc^2')
  })

  it('supports first-block fallback for future pending/autocomplete callers', () => {
    const onDroppedBlocks = vi.fn()
    const events: BlockEventLike[] = [
      {
        block_type: 'HeadingBlock',
        structured_content: [{ type: 'text', text: '标题', marks: [] }],
      },
      {
        block_type: 'BaseBlock',
        structured_content: [{ type: 'text', text: '段落', marks: [] }],
      },
    ]

    const projection = blockEventsToInlineProjection(events, {
      multiBlockMode: 'first-block',
      onDroppedBlocks,
    })

    expect(projection.plainText).toBe('标题')
    expect(projection.sourceBlockCount).toBe(1)
    expect(projection.droppedBlockCount).toBe(1)
    expect(onDroppedBlocks).toHaveBeenCalledWith({
      requestedBlockCount: 2,
      usedBlockCount: 1,
      droppedBlockCount: 1,
    })
  })
})
