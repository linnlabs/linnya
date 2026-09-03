import { describe, expect, it } from 'vitest'

import { buildInlineNodesFromProjection } from '../../../../../services/markdownRuntime'
import type { MarkdownInlineProjection } from '../../../../../services/markdownRuntime/types'
import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import { attachCitationHydrationToProjection } from '../citationHydrationHelper'

describe('citationHydrationHelper projection hydration', () => {
  it('保留 hardBreak/inlineLatex/格式，并把 Markdown token 投影为 CitationNode atom', () => {
    const projection: MarkdownInlineProjection = {
      fragments: [
        { type: 'text', text: '前文', marks: [{ type: 'bold' }] },
        { type: 'hardBreak', marks: [{ type: 'bold' }] },
        { type: 'text', text: '[@Abc234]', marks: [{ type: 'italic' }] },
        {
          type: 'inlineLatex',
          attrs: { latexSource: 'x+y' },
          latexSource: 'x+y',
          textRepresentation: '$x+y$',
        },
        { type: 'text', text: '结尾', marks: [] },
      ],
      spans: [
        { text: '前文\n', marks: ['bold'] },
        { text: '[@Abc234]', marks: ['italic'] },
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
        { text: '结尾', marks: [] },
      ],
      plainText: '前文\n[@Abc234]$x+y$结尾',
      newlineMode: 'hardBreak',
      sourceBlockCount: 1,
      droppedBlockCount: 0,
    }

    const hydrated = attachCitationHydrationToProjection(projection, {
      Abc234: {
        docId: 'doc-1',
        blockId: 'block-1',
        title: '文献标题',
        snippet: '文献片段',
        kbId: 'kb-1',
      },
    })

    expect(hydrated.fragments).toEqual([
      { type: 'text', text: '前文', marks: [{ type: 'bold' }] },
      { type: 'hardBreak', marks: [{ type: 'bold' }] },
      expect.objectContaining({
        type: 'citationNode',
        attrs: expect.objectContaining({
          ref: 'Abc234',
          sourceType: 'knowledge_base',
          sourceId: 'doc-1',
          title: '文献标题',
          snippet: '文献片段',
          kbId: 'kb-1',
          blockId: 'block-1',
        }),
        citation: expect.objectContaining({ ref: 'Abc234', sourceId: 'doc-1' }),
        marks: [{ type: 'italic' }],
        textRepresentation: '[@Abc234]',
      }),
      expect.objectContaining({
        type: 'inlineLatex',
        latexSource: 'x+y',
      }),
      { type: 'text', text: '结尾', marks: [] },
    ])

    expect(hydrated.spans).toEqual([
      { text: '前文\n', marks: ['bold'] },
      {
        text: '[@Abc234]',
        marks: ['italic'],
        citation: expect.objectContaining({
          ref: 'Abc234',
          sourceType: 'knowledge_base',
          sourceId: 'doc-1',
          title: '文献标题',
          blockId: 'block-1',
        }),
        inlineAtom: {
          type: 'citation',
          citation: expect.objectContaining({
            ref: 'Abc234',
            sourceId: 'doc-1',
            blockId: 'block-1',
          }),
          textRepresentation: '[@Abc234]',
        },
      },
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
      { text: '结尾', marks: [] },
    ])

    const nodes = buildInlineNodesFromProjection(hydrated, workspaceMarkdownSchemaLite)
    expect(nodes.map(node => node.type.name)).toEqual([
      'text',
      'hardBreak',
      'citationNode',
      'inlineLatex',
      'text',
    ])
    expect(nodes[2]?.marks.map(mark => mark.type.name)).toEqual(['italic'])
    expect(nodes[2]?.attrs).toMatchObject({
      ref: 'Abc234',
      sourceId: 'doc-1',
      blockId: 'block-1',
    })
    expect(nodes[3]?.attrs.latexSource).toBe('x+y')
  })

  it('复用 Citation domain 语法：不水合 code mark 内的引用示例', () => {
    const projection: MarkdownInlineProjection = {
      fragments: [{ type: 'text', text: '示例 [@Abc234]', marks: [{ type: 'code' }] }],
      spans: [{ text: '示例 [@Abc234]', marks: ['code'] }],
      plainText: '示例 [@Abc234]',
      newlineMode: 'hardBreak',
      sourceBlockCount: 1,
      droppedBlockCount: 0,
    }

    expect(
      attachCitationHydrationToProjection(projection, {
        Abc234: {
          docId: 'doc-1',
          blockId: 'block-1',
          title: '文献标题',
          snippet: '文献片段',
        },
      })
    ).toEqual(projection)
  })
})
