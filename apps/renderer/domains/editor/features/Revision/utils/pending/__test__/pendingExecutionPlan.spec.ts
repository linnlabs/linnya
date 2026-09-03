import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'

import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import {
  executePendingPlanToDocument,
  executePendingPlanToTr,
} from '../pendingExecutionPlan'
import { EDITOR_EPHEMERAL_TRANSACTION_META } from '../../../../../core/transactions/editorTransactionMeta'

function createMockEditor(docNode: ReturnType<typeof workspaceMarkdownSchemaLite.node>) {
  let state = EditorState.create({
    schema: workspaceMarkdownSchemaLite,
    doc: docNode,
  })
  const dispatchedTransactions: Array<Parameters<typeof state.apply>[0]> = []

  const editor: any = {
    state,
    dispatchedTransactions,
    view: {
      dispatch(tr: any) {
        dispatchedTransactions.push(tr)
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
        workspaceMarkdownSchemaLite.node('baseBlock', { id: 'base-1', blockType: 'base' }, []),
      ]
    ),
    workspaceMarkdownSchemaLite.node(
      'rootBlock',
      { id: 'block-2' },
      [
        workspaceMarkdownSchemaLite.node('baseBlock', { id: 'base-2', blockType: 'base' }, [
          workspaceMarkdownSchemaLite.text('旧内容'),
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

describe('pendingExecutionPlan', () => {
  it('executes table-insert plans against the live document', () => {
    const editor = createMockEditor(createBaseDoc())

    const result = executePendingPlanToDocument({
      editor,
      blockPos: 0,
      revisionId: 'rev-insert-1',
      plan: {
        kind: 'table-insert',
        tableRows: createTableRows(),
      },
    })

    expect(result).toEqual({
      success: true,
      diffStats: { insertCount: 4, deleteCount: 0 },
    })
    expect(editor.dispatchedTransactions.length).toBeGreaterThan(0)
    for (const tr of editor.dispatchedTransactions) {
      expect(tr.getMeta('pendingRevisionApply')).toBe(true)
      expect(tr.getMeta('addToHistory')).toBe(false)
      expect(tr.getMeta(EDITOR_EPHEMERAL_TRANSACTION_META)).toBe('pending-revision-projection')
    }
    expect((editor.state.doc.toJSON().content?.[0] as any)?.content?.[0]?.type).toBe('table')
  })

  it('executes table-update-with-history plans inside an existing transaction', () => {
    const editor = createMockEditor(createBaseDoc())
    const tr = editor.state.tr
    const secondBlockPos = editor.state.doc.child(0).nodeSize

    const result = executePendingPlanToTr({
      tr,
      blockPos: secondBlockPos,
      revisionId: 'rev-update-1',
      historyBlockId: 'history-block-2',
      plan: {
        kind: 'table-update-with-history',
        tableRows: createTableRows(),
      },
    })

    expect(result).toEqual({
      success: true,
      diffStats: { insertCount: 4, deleteCount: 0 },
      reason: '已通过表格整块替换（保留旧表格历史）应用修订',
    })
    const json = tr.doc.toJSON()
    expect((json.content?.[1] as any)?.attrs?.id).toBe('history-block-2')
    expect((json.content?.[2] as any)?.content?.[0]?.type).toBe('table')
  })
})
