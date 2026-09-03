import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'

import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import {
  applyTableInsertInTr,
  applyTableUpdateWithHistoryInTr,
  applyTableUpdateWithHistory,
  replaceRootBlockWithTable,
  replaceRootBlockWithTableInTr,
} from '../pendingTableBlockApplier'

function createMockEditor(docNode: ReturnType<typeof workspaceMarkdownSchemaLite.node>) {
  let state = EditorState.create({
    schema: workspaceMarkdownSchemaLite,
    doc: docNode,
  })

  const editor: any = {
    state,
    view: {
      dispatch(tr: any) {
        state = state.apply(tr)
        editor.state = state
      },
    },
  }

  return editor
}

function createBaseDoc() {
  return workspaceMarkdownSchemaLite.node('doc', null, [
    workspaceMarkdownSchemaLite.node(
      'rootBlock',
      { id: 'block-1' },
      [
        workspaceMarkdownSchemaLite.node('baseBlock', { id: 'base-1', blockType: 'base' }, [
          workspaceMarkdownSchemaLite.text('old content'),
        ]),
      ]
    ),
  ])
}

function createTableRows() {
  const schema = workspaceMarkdownSchemaLite
  const makeCellContent = (text: string) =>
    schema.node('tableCellContentBlock', { id: `cell-${text}`, blockType: 'tableCellContent' }, [
      schema.text(text),
    ])

  return [
    schema.node('tableRow', null, [
      schema.node('tableHeader', { colwidth: [150] }, [makeCellContent('表头')]),
    ]),
    schema.node('tableRow', null, [
      schema.node('tableCell', { colwidth: [150] }, [makeCellContent('正文')]),
    ]),
  ]
}

describe('pendingTableBlockApplier', () => {
  it('replaces an existing rootBlock content with a table block', () => {
    const editor = createMockEditor(createBaseDoc())

    const result = replaceRootBlockWithTable(editor, 0, createTableRows())

    expect(result).toEqual({ success: true })
    const json = editor.state.doc.toJSON()
    expect((json.content?.[0] as any)?.type).toBe('rootBlock')
    expect((json.content?.[0] as any)?.attrs).toEqual(
      expect.objectContaining({ id: 'block-1' })
    )
    expect((json.content?.[0] as any)?.content?.[0]).toEqual(
      expect.objectContaining({
        type: 'table',
        attrs: expect.objectContaining({ blockType: 'table', withHeaderRow: true }),
      })
    )
  })

  it('supports table replacement and insert marking inside an existing transaction', () => {
    const editor = createMockEditor(createBaseDoc())
    const tr = editor.state.tr

    const result = applyTableInsertInTr(tr, 0, createTableRows(), 'rev-tr-1')

    expect(result).toEqual({
      success: true,
      newTableBlockPos: 0,
      diffStats: { insertCount: 4, deleteCount: 0 },
    })

    const docJson = tr.doc.toJSON()
    expect((docJson.content?.[0] as any)?.content?.[0]?.type).toBe('table')
    expect(
      (((docJson.content?.[0] as any)?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.marks) ?? [])[0]
    ).toEqual(
      expect.objectContaining({
        type: 'revisionMark',
        attrs: expect.objectContaining({ revisionId: 'rev-tr-1' }),
      })
    )
  })

  it('replaces a table rootBlock inside an existing transaction without dispatch', () => {
    const editor = createMockEditor(createBaseDoc())
    const tr = editor.state.tr

    const result = replaceRootBlockWithTableInTr(tr, 0, createTableRows())

    expect(result).toEqual({ success: true })
    expect((tr.doc.toJSON().content?.[0] as any)?.content?.[0]?.type).toBe('table')
  })

  it('applies table update with history block and insert marks on the new table', () => {
    const editor = createMockEditor(createBaseDoc())

    const result = applyTableUpdateWithHistory(
      editor,
      0,
      createTableRows(),
      'rev-1',
      'history-block-1'
    )

    expect(result.success).toBe(true)
    expect(result.newTableBlockPos).toBeTypeOf('number')
    expect(result.diffStats).toEqual({ insertCount: 4, deleteCount: 0 })
    expect(editor.state.doc.childCount).toBe(2)

    const json = editor.state.doc.toJSON()
    expect((json.content?.[0] as any)?.attrs?.id).toBe('history-block-1')
    expect((json.content?.[1] as any)?.content?.[0]?.type).toBe('table')
    expect(
      (((json.content?.[1] as any)?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.marks) ?? [])[0]
    ).toEqual(
      expect.objectContaining({
        type: 'revisionMark',
        attrs: expect.objectContaining({ revisionId: 'rev-1' }),
      })
    )
  })

  it('supports table update with history inside an existing transaction', () => {
    const editor = createMockEditor(createBaseDoc())
    const tr = editor.state.tr

    const result = applyTableUpdateWithHistoryInTr(
      tr,
      0,
      createTableRows(),
      'rev-tr-update-1',
      'history-tr-block-1'
    )

    expect(result).toEqual({
      success: true,
      newTableBlockPos: expect.any(Number),
      diffStats: { insertCount: 4, deleteCount: 0 },
    })

    const json = tr.doc.toJSON()
    expect((json.content?.[0] as any)?.attrs?.id).toBe('history-tr-block-1')
    expect((json.content?.[1] as any)?.content?.[0]?.type).toBe('table')
    expect(
      (((json.content?.[1] as any)?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.marks) ?? [])[0]
    ).toEqual(
      expect.objectContaining({
        type: 'revisionMark',
        attrs: expect.objectContaining({ revisionId: 'rev-tr-update-1' }),
      })
    )
  })
})
