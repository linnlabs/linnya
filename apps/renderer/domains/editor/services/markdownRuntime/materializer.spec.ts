import { Schema } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'

import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import {
  blockEventToRootBlockNode,
  blockEventsToDocJson,
  blockEventsToRootBlockNodes,
  buildTableRowsFromTableModel,
} from './index'

/** 能表达段落、但没有 horizontalRuleBlock 的最小 Schema。 */
const schemaWithoutHorizontalRule = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    rootBlock: { content: 'baseBlock', attrs: { id: { default: '' } } },
    baseBlock: {
      content: 'inline*',
      attrs: { id: { default: '' }, blockType: { default: 'base' } },
    },
    text: { group: 'inline' },
  },
})

function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'id')
        .map(([key, entry]) => [key, withoutIds(entry)])
    )
  }
  return value
}

describe('markdownRuntime materializer', () => {
  it('folds HTML comments into the preceding root block annotations', () => {
    const docJson = blockEventsToDocJson(
      [
        { block_type: 'BaseBlock', raw_content_fallback: '正文' },
        { block_type: 'HtmlComment', raw_content_fallback: '<!-- 需要补充依据 -->' },
      ],
      workspaceMarkdownSchemaLite
    )

    const root = docJson?.content[0] as {
      attrs?: { annotations?: Array<Record<string, unknown>> }
    }
    expect(docJson?.content).toHaveLength(1)
    expect(root.attrs?.annotations).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^annotation-[0-9a-f]{8}$/i),
        content: '需要补充依据',
        author: 'User',
        state: 'confirmed',
      }),
    ])
  })

  it('materializes an empty annotation anchor as its own root block', () => {
    const docJson = blockEventsToDocJson(
      [
        {
          block_type: 'HtmlComment',
          raw_content_fallback: '<!-- linnya-annotation-anchor:v1 empty-block -->',
        },
        { block_type: 'HtmlComment', raw_content_fallback: '<!-- 空块批注 -->' },
      ],
      workspaceMarkdownSchemaLite
    )

    const root = docJson?.content[0] as {
      content?: Array<{ type?: string; content?: unknown[] }>
      attrs?: { annotations?: Array<Record<string, unknown>> }
    }
    expect(docJson?.content).toHaveLength(1)
    expect(root.content?.[0]).toMatchObject({ type: 'baseBlock' })
    expect(root.content?.[0]?.content ?? []).toEqual([])
    expect(root.attrs?.annotations?.[0]).toMatchObject({ content: '空块批注' })
  })

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

  describe('horizontal rule', () => {
    it('materializes HorizontalRuleBlock as rootBlock -> horizontalRuleBlock in both the document and single-block paths', () => {
      const docJson = blockEventsToDocJson(
        [
          { block_type: 'BaseBlock', raw_content_fallback: '前文' },
          { block_type: 'HorizontalRuleBlock' },
          { block_type: 'BaseBlock', raw_content_fallback: '后文' },
        ],
        workspaceMarkdownSchemaLite
      )

      const roots = (docJson?.content ?? []) as Array<{
        type: string
        content?: Array<{ type: string; attrs?: Record<string, unknown>; content?: unknown[] }>
      }>
      expect(roots.map(root => [root.type, root.content?.[0]?.type])).toEqual([
        ['rootBlock', 'baseBlock'],
        ['rootBlock', 'horizontalRuleBlock'],
        ['rootBlock', 'baseBlock'],
      ])
      expect(roots[1]?.content).toHaveLength(1)
      expect(roots[1]?.content?.[0]).toMatchObject({
        type: 'horizontalRuleBlock',
        attrs: { blockType: 'horizontalRule' },
      })
      expect(roots[1]?.content?.[0]?.content).toBeUndefined()

      const single = blockEventToRootBlockNode(
        { block_type: 'HorizontalRuleBlock' },
        workspaceMarkdownSchemaLite
      )
      expect(single?.type.name).toBe('rootBlock')
      expect(single?.firstChild?.type.name).toBe('horizontalRuleBlock')
      expect(single?.textContent).toBe('')
      // 同一个事件在两条路径得到同一份结构，只有块身份不同。
      expect(withoutIds(single?.toJSON())).toEqual(withoutIds(roots[1]))

      const batch = blockEventsToRootBlockNodes(
        [{ block_type: 'HorizontalRuleBlock' }],
        workspaceMarkdownSchemaLite
      )
      expect(batch).toHaveLength(1)
      expect(withoutIds(batch[0]?.toJSON())).toEqual(withoutIds(roots[1]))
    })

    it('fails explicitly instead of degrading to an empty paragraph when the schema has no horizontalRuleBlock', () => {
      const event = { block_type: 'HorizontalRuleBlock' }

      expect(() => blockEventsToDocJson([event], schemaWithoutHorizontalRule)).toThrow('水平分割线')
      expect(() => blockEventToRootBlockNode(event, schemaWithoutHorizontalRule)).toThrow('水平分割线')
      expect(() => blockEventsToRootBlockNodes([event], schemaWithoutHorizontalRule)).toThrow('水平分割线')
    })
  })
})
