import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'

import { cloneNodeWithRevisionMark } from '../revisionInlineNodes'
import { markWholeBlockAsInsert, markWholeBlockAsInsertInTr } from './pendingRevisionHelpers'
import { markPendingRevisionProjectionTransaction } from '../../../../core/transactions/editorTransactionMeta'

export interface ReplaceRootBlockWithTableResult {
  success: boolean
  reason?: string
}

export interface ReplaceRootBlockWithTableInTrResult {
  success: boolean
  reason?: string
}

export interface ApplyTableUpdateWithHistoryResult {
  success: boolean
  newTableBlockPos?: number
  diffStats?: { insertCount: number; deleteCount: number }
  reason?: string
}

function buildHistoryBlockWithDeleteMark(
  rootBlockNode: ProseMirrorNode,
  revisionId: string,
  historyBlockId: string,
  schema: Editor['state']['schema']
) {
  const revisionMarkType = schema.marks.revisionMark
  const rootBlockType = schema.nodes.rootBlock

  if (!revisionMarkType || !rootBlockType) {
    return null
  }

  const deleteMark = revisionMarkType.create({
    revisionId,
    changeType: 'delete',
    source: 'ai',
  })

  const historyContent: ProseMirrorNode[] = []
  rootBlockNode.content.forEach((child) => {
    historyContent.push(cloneNodeWithRevisionMark(child, deleteMark) as ProseMirrorNode)
  })

  return rootBlockType.create(
    { ...rootBlockNode.attrs, id: historyBlockId },
    historyContent
  )
}

function buildRootBlockWithTable(
  rootBlockNode: ProseMirrorNode,
  tableNode: ProseMirrorNode,
  schema: Editor['state']['schema']
) {
  const rootBlockType = schema.nodes.rootBlock
  if (!rootBlockType) {
    return null
  }

  return rootBlockType.create(
    { ...rootBlockNode.attrs },
    tableNode
  )
}

export function replaceRootBlockWithTable(
  editor: Editor,
  rootBlockPos: number,
  rows: ProseMirrorNode[]
): ReplaceRootBlockWithTableResult {
  const { state, view } = editor
  const rootBlockNode = state.doc.nodeAt(rootBlockPos)
  const tableType = state.schema.nodes.table

  if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
    return {
      success: false,
      reason: '未找到有效的 rootBlock',
    }
  }

  if (!tableType || rows.length === 0) {
    return {
      success: false,
      reason: '表格节点或 rows 不可用',
    }
  }

  const newTableNode = tableType.create({}, rows)
  const newRootBlock = buildRootBlockWithTable(rootBlockNode, newTableNode, state.schema)
  if (!newRootBlock) {
    return {
      success: false,
      reason: 'schema 缺少 rootBlock 节点',
    }
  }

  const tr = state.tr.replaceWith(
    rootBlockPos,
    rootBlockPos + rootBlockNode.nodeSize,
    newRootBlock
  )
  markPendingRevisionProjectionTransaction(tr)
  view.dispatch(tr)

  return { success: true }
}

export function replaceRootBlockWithTableInTr(
  tr: Transaction,
  rootBlockPos: number,
  rows: ProseMirrorNode[]
): ReplaceRootBlockWithTableInTrResult {
  const rootBlockNode = tr.doc.nodeAt(rootBlockPos)
  const tableType = tr.doc.type.schema.nodes.table

  if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
    return {
      success: false,
      reason: '未找到有效的 rootBlock',
    }
  }

  if (!tableType || rows.length === 0) {
    return {
      success: false,
      reason: '表格节点或 rows 不可用',
    }
  }

  const newTableNode = tableType.create({}, rows)
  const newRootBlock = buildRootBlockWithTable(rootBlockNode, newTableNode, tr.doc.type.schema)
  if (!newRootBlock) {
    return {
      success: false,
      reason: 'schema 缺少 rootBlock 节点',
    }
  }

  tr.replaceWith(
    rootBlockPos,
    rootBlockPos + rootBlockNode.nodeSize,
    newRootBlock
  )

  return { success: true }
}

export function applyTableUpdateWithHistory(
  editor: Editor,
  rootBlockPos: number,
  rows: ProseMirrorNode[],
  revisionId: string,
  historyBlockId = `history-${revisionId}-${Date.now()}`
): ApplyTableUpdateWithHistoryResult {
  const { state, view } = editor
  const rootBlockNode = state.doc.nodeAt(rootBlockPos)
  const tableType = state.schema.nodes.table

  if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
    return {
      success: false,
      reason: '未找到有效的 rootBlock',
    }
  }

  if (!tableType || rows.length === 0) {
    return {
      success: false,
      reason: 'schema 缺少表格或修订标记节点，或 rows 为空',
    }
  }

  const newTableNode = tableType.create({}, rows)
  const newRootBlock = buildRootBlockWithTable(rootBlockNode, newTableNode, state.schema)
  if (!newRootBlock) {
    return {
      success: false,
      reason: 'schema 缺少 rootBlock 节点',
    }
  }

  const historyBlock = buildHistoryBlockWithDeleteMark(
    rootBlockNode,
    revisionId,
    historyBlockId,
    state.schema
  )
  if (!historyBlock) {
    return {
      success: false,
      reason: 'schema 缺少 history block 所需节点',
    }
  }

  const tr = state.tr
  tr.insert(rootBlockPos, historyBlock)

  const newTableBlockPos = rootBlockPos + historyBlock.nodeSize
  tr.replaceWith(
    newTableBlockPos,
    newTableBlockPos + rootBlockNode.nodeSize,
    newRootBlock
  )

  markPendingRevisionProjectionTransaction(tr)
  view.dispatch(tr)

  const diffStats = markWholeBlockAsInsert(editor, newTableBlockPos, revisionId)
  return {
    success: true,
    newTableBlockPos,
    diffStats,
  }
}

export function applyTableUpdateWithHistoryInTr(
  tr: Transaction,
  rootBlockPos: number,
  rows: ProseMirrorNode[],
  revisionId: string,
  historyBlockId = `history-${revisionId}-${Date.now()}`
): ApplyTableUpdateWithHistoryResult {
  const rootBlockNode = tr.doc.nodeAt(rootBlockPos)
  const tableType = tr.doc.type.schema.nodes.table

  if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
    return {
      success: false,
      reason: '未找到有效的 rootBlock',
    }
  }

  if (!tableType || rows.length === 0) {
    return {
      success: false,
      reason: 'schema 缺少表格节点，或 rows 为空',
    }
  }

  const newTableNode = tableType.create({}, rows)
  const newRootBlock = buildRootBlockWithTable(rootBlockNode, newTableNode, tr.doc.type.schema)
  if (!newRootBlock) {
    return {
      success: false,
      reason: 'schema 缺少 rootBlock 节点',
    }
  }

  const historyBlock = buildHistoryBlockWithDeleteMark(
    rootBlockNode,
    revisionId,
    historyBlockId,
    tr.doc.type.schema
  )
  if (!historyBlock) {
    return {
      success: false,
      reason: 'schema 缺少 history block 所需节点',
    }
  }

  tr.insert(rootBlockPos, historyBlock)

  const newTableBlockPos = rootBlockPos + historyBlock.nodeSize
  tr.replaceWith(
    newTableBlockPos,
    newTableBlockPos + rootBlockNode.nodeSize,
    newRootBlock
  )

  return {
    success: true,
    newTableBlockPos,
    diffStats: markWholeBlockAsInsertInTr(tr, newTableBlockPos, revisionId),
  }
}

export function applyTableInsertInTr(
  tr: Transaction,
  rootBlockPos: number,
  rows: ProseMirrorNode[],
  revisionId: string
): ApplyTableUpdateWithHistoryResult {
  const replaceResult = replaceRootBlockWithTableInTr(tr, rootBlockPos, rows)
  if (!replaceResult.success) {
    return replaceResult
  }

  return {
    success: true,
    newTableBlockPos: rootBlockPos,
    diffStats: markWholeBlockAsInsertInTr(tr, rootBlockPos, revisionId),
  }
}
