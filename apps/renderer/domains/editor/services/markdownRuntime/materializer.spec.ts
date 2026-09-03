import { describe, expect, it } from 'vitest'

import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import { blockEventsToDocJson, buildTableRowsFromTableModel } from './index'

describe('markdownRuntime materializer', () => {
  it('materializes hardBreak and inlineLatex through the shared fragment interpreter', () => {
    const docJson = blockEventsToDocJson(
      [
        {
          block_type: 'BaseBlock',
          structured_content: [
            { type: 'text', text: '第一行', marks: [{ type: 'bold' }] },
            { type: 'hardBreak', marks: [{ type: 'bold' }] },
            { type: 'inlineLatex', attrs: { latexSource: 'x+y' } },
          ],
        },
      ],
      workspaceMarkdownSchemaLite
    )

    const content =
      (
        (docJson?.content?.[0] as { content?: Array<{ content?: unknown[] }> })?.content?.[0] as {
          content?: unknown[]
        }
      )?.content ?? []

    expect(content).toEqual([
      { type: 'text', text: '第一行', marks: [{ type: 'bold' }] },
      { type: 'hardBreak', marks: [{ type: 'bold' }] },
      expect.objectContaining({
        type: 'inlineLatex',
        attrs: expect.objectContaining({
          latexSource: 'x+y',
        }),
      }),
    ])
  })

  it('reuses the same fragment interpreter for table cell content', () => {
    const docJson = blockEventsToDocJson(
      [
        {
          block_type: 'TableBlock',
          attrs: {
            with_header_row: true,
            header: [
              {
                content: [
                  { type: 'text', text: '表头', marks: [{ type: 'bold' }] },
                  { type: 'hardBreak' },
                  { type: 'text', text: '删除线', marks: [{ type: 'strike' }] },
                  { type: 'inlineLatex', attrs: { latexSource: 'a/b' } },
                ],
              },
            ],
            rows: [],
          },
        },
      ],
      workspaceMarkdownSchemaLite
    )

    const headerContent =
      (
        (docJson?.content?.[0] as { content?: Array<{ content?: unknown[] }> })?.content?.[0] as {
          content?: Array<{ content?: Array<{ content?: Array<{ content?: unknown[] }> }> }>
        }
      )?.content?.[0]?.content?.[0]?.content?.[0]?.content ?? []

    expect(headerContent).toEqual([
      { type: 'text', text: '表头', marks: [{ type: 'bold' }] },
      { type: 'hardBreak' },
      { type: 'text', text: '删除线', marks: [{ type: 'strike' }] },
      expect.objectContaining({
        type: 'inlineLatex',
        attrs: expect.objectContaining({
          latexSource: 'a/b',
        }),
      }),
    ])

    expect(() => workspaceMarkdownSchemaLite.nodeFromJSON(docJson as never)).not.toThrow()
  })

  it('allows callers to hydrate table cell projection before node materialization', () => {
    const rows = buildTableRowsFromTableModel(
      {
        with_header_row: true,
        header: [{ content: [{ type: 'text', text: '表头', marks: [] }] }],
        rows: [],
      },
      workspaceMarkdownSchemaLite,
      {
        hydrateProjection: projection => ({
          ...projection,
          fragments: projection.fragments.flatMap(fragment =>
            fragment.type !== 'text'
              ? [fragment]
              : [
                  {
                    type: 'citationNode' as const,
                    attrs: {
                      sourceId: 'doc-1',
                      sourceType: 'knowledge_base',
                      citationId: 'c1',
                      ref: 'abc123',
                      title: 'Ref',
                      snippet: 'Snippet',
                      kbId: 'kb',
                      blockId: 'block-1',
                    },
                    citation: {
                      sourceId: 'doc-1',
                      sourceType: 'knowledge_base' as const,
                      ref: 'abc123',
                      title: 'Ref',
                      snippet: 'Snippet',
                      kbId: 'kb',
                      blockId: 'block-1',
                    },
                    marks: fragment.marks,
                    textRepresentation: '[@abc123]',
                  },
                ]
          ),
        }),
      }
    )

    expect(rows).not.toBeNull()
    const headerContent = rows?.[0]?.firstChild?.firstChild?.content?.toJSON() ?? []
    expect(headerContent).toEqual([
      {
        type: 'citationNode',
        attrs: expect.objectContaining({
          sourceId: 'doc-1',
          sourceType: 'knowledge_base',
          citationId: 'c1',
          blockId: 'block-1',
        }),
      },
    ])
  })
})
