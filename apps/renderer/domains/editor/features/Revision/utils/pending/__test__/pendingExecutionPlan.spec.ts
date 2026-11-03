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

  describe('atomic block plans', () => {
    const createRule = (id = 'hr-new') =>
      workspaceMarkdownSchemaLite.nodes.horizontalRuleBlock.create({ id, blockType: 'horizontalRule' })

    it('block-replace swaps the empty placeholder content for the block and counts one insertion', () => {
      const editor = createMockEditor(createBaseDoc())

      const result = executePendingPlanToDocument({
        editor,
        blockPos: 0,
        revisionId: 'rev-hr-insert',
        plan: { kind: 'block-replace', contentBlock: createRule() },
      })

      expect(result).toEqual({ success: true, diffStats: { insertCount: 1, deleteCount: 0 } })
      expect(editor.dispatchedTransactions).toHaveLength(1)
      const [tr] = editor.dispatchedTransactions
      expect(tr.getMeta('pendingRevisionApply')).toBe(true)
      expect(tr.getMeta('addToHistory')).toBe(false)
      expect(tr.getMeta(EDITOR_EPHEMERAL_TRANSACTION_META)).toBe('pending-revision-projection')

      const first = editor.state.doc.child(0)
      // 目标 rootBlock 的身份保持不变，只换内容块；没有任何行内内容或修订标记。
      expect(first.attrs.id).toBe('block-1')
      expect(first.childCount).toBe(1)
      expect(first.firstChild?.type.name).toBe('horizontalRuleBlock')
      expect(first.textContent).toBe('')
      expect(JSON.stringify(editor.state.doc.toJSON())).not.toContain('revisionMark')
    })

    it('block-replace counts the replaced non-empty content as one deletion inside a shared transaction', () => {
      const editor = createMockEditor(createBaseDoc())
      const tr = editor.state.tr
      const secondBlockPos = editor.state.doc.child(0).nodeSize

      const result = executePendingPlanToTr({
        tr,
        blockPos: secondBlockPos,
        revisionId: 'rev-hr-update',
        plan: { kind: 'block-replace', contentBlock: createRule() },
      })

      expect(result).toEqual({ success: true, diffStats: { insertCount: 1, deleteCount: 1 } })
      expect(tr.doc.child(1).attrs.id).toBe('block-2')
      expect(tr.doc.child(1).firstChild?.type.name).toBe('horizontalRuleBlock')
      expect(tr.doc.child(1).textContent).toBe('')
    })

    it('block-replace is a no-op when the content block is already the same atomic block', () => {
      const editor = createMockEditor(
        workspaceMarkdownSchemaLite.node('doc', null, [
          workspaceMarkdownSchemaLite.node('rootBlock', { id: 'block-rule' }, [createRule('existing-rule')]),
        ])
      )
      const before = editor.state.doc

      const result = executePendingPlanToDocument({
        editor,
        blockPos: 0,
        revisionId: 'rev-hr-same',
        plan: { kind: 'block-replace', contentBlock: createRule('another-id') },
      })

      expect(result).toEqual({
        success: true,
        diffStats: { insertCount: 0, deleteCount: 0 },
        reason: '内容无差异，无需应用修订',
      })
      expect(editor.dispatchedTransactions).toHaveLength(0)
      expect(editor.state.doc.eq(before)).toBe(true)
    })

    it('block-replace fails explicitly when the target is not a rootBlock', () => {
      const editor = createMockEditor(createBaseDoc())

      const result = executePendingPlanToDocument({
        editor,
        // 1 位于 rootBlock 内部（baseBlock），不是 rootBlock 起点。
        blockPos: 1,
        revisionId: 'rev-hr-bad',
        plan: { kind: 'block-replace', contentBlock: createRule() },
      })

      expect(result).toEqual({ success: false, reason: '未找到有效的 rootBlock' })
      expect(editor.dispatchedTransactions).toHaveLength(0)
    })

    it('block-remove leaves the document untouched and counts one whole-block deletion', () => {
      const editor = createMockEditor(createBaseDoc())
      const before = editor.state.doc
      const tr = editor.state.tr

      const viaTr = executePendingPlanToTr({
        tr,
        blockPos: 0,
        revisionId: 'rev-hr-delete',
        plan: { kind: 'block-remove' },
      })
      const viaDocument = executePendingPlanToDocument({
        editor,
        blockPos: 0,
        revisionId: 'rev-hr-delete',
        plan: { kind: 'block-remove' },
      })

      expect(viaTr).toEqual({ success: true, diffStats: { insertCount: 0, deleteCount: 1 } })
      expect(viaDocument).toEqual(viaTr)
      // 每个块拿到独立的统计对象，登记后互不影响。
      expect(viaDocument.diffStats).not.toBe(viaTr.diffStats)
      expect(tr.docChanged).toBe(false)
      expect(editor.dispatchedTransactions).toHaveLength(0)
      expect(editor.state.doc.eq(before)).toBe(true)
    })
  })
})
