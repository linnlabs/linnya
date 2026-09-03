import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'

import type { InsertedTextNewlineMode } from '../diffApplier'
import { applyRichDiffToDocument, applyRichDiffToTr } from '../diffApplier'
import type { RichDiffResult } from '../richDiff'
import { markWholeBlockAsInsert } from './pendingRevisionHelpers'
import {
  applyTableInsertInTr,
  applyTableUpdateWithHistory,
  applyTableUpdateWithHistoryInTr,
  replaceRootBlockWithTable,
} from './pendingTableBlockApplier'
import { getPendingRevisionProjectionTransactionMeta } from '../../../../core/transactions/editorTransactionMeta'

export interface PendingContentDiffExecutionPlan {
  kind: 'content-diff'
  richDiff: RichDiffResult
  insertNewlineMode: InsertedTextNewlineMode
}

export interface PendingTableInsertExecutionPlan {
  kind: 'table-insert'
  tableRows: ProseMirrorNode[]
}

export interface PendingTableUpdateExecutionPlan {
  kind: 'table-update-with-history'
  tableRows: ProseMirrorNode[]
  fallbackRichDiff?: RichDiffResult | null
}

export type PendingExecutionPlan =
  | PendingContentDiffExecutionPlan
  | PendingTableInsertExecutionPlan
  | PendingTableUpdateExecutionPlan

export interface ExecutePendingPlanResult {
  success: boolean
  diffStats?: { insertCount: number; deleteCount: number }
  reason?: string
}

interface ExecutePendingPlanBase {
  blockPos: number
  revisionId: string
}

export interface ExecutePendingPlanToDocumentParams extends ExecutePendingPlanBase {
  editor: Editor
  plan: PendingExecutionPlan
  historyBlockId?: string
}

export interface ExecutePendingPlanToTrParams extends ExecutePendingPlanBase {
  tr: Transaction
  plan: PendingExecutionPlan
  historyBlockId?: string
}

function hasMeaningfulDiff(diff?: { insertCount: number; deleteCount: number } | null): boolean {
  return !!diff && (diff.insertCount > 0 || diff.deleteCount > 0)
}

export function executePendingPlanToDocument(
  params: ExecutePendingPlanToDocumentParams
): ExecutePendingPlanResult {
  const { editor, blockPos, revisionId, plan, historyBlockId } = params

  if (plan.kind === 'content-diff') {
    if (!hasMeaningfulDiff(plan.richDiff.stats)) {
      return {
        success: true,
        diffStats: plan.richDiff.stats,
        reason: '内容无差异，无需应用修订',
      }
    }

    const applyResult = applyRichDiffToDocument({
      editor,
      blockPos,
      richDiff: plan.richDiff,
      revisionId,
      source: 'ai',
      insertNewlineMode: plan.insertNewlineMode,
      transactionMeta: getPendingRevisionProjectionTransactionMeta(),
    })

    return applyResult.success
      ? { success: true, diffStats: plan.richDiff.stats }
      : { success: false, reason: applyResult.error || '应用 diff 失败' }
  }

  if (plan.kind === 'table-insert') {
    const replaceResult = replaceRootBlockWithTable(editor, blockPos, plan.tableRows)
    if (!replaceResult.success) {
      return {
        success: false,
        reason: replaceResult.reason || '表格插入替换失败',
      }
    }

    const diffStats = markWholeBlockAsInsert(editor, blockPos, revisionId)
    if (!hasMeaningfulDiff(diffStats)) {
      return {
        success: false,
        reason: '表格插入后块内未发现可标记的文本',
      }
    }

    return {
      success: true,
      diffStats,
    }
  }

  const tableUpdateResult = applyTableUpdateWithHistory(
    editor,
    blockPos,
    plan.tableRows,
    revisionId,
    historyBlockId
  )

  if (tableUpdateResult.success && tableUpdateResult.diffStats) {
    return {
      success: true,
      diffStats: tableUpdateResult.diffStats,
      reason: '已通过表格整块替换（保留旧表格历史）应用修订',
    }
  }

  if (!hasMeaningfulDiff(plan.fallbackRichDiff?.stats)) {
    return {
      success: false,
      reason: tableUpdateResult.reason || '表格整块替换失败，且无可回退的文本 diff',
    }
  }

  const fallbackResult = applyRichDiffToDocument({
    editor,
    blockPos,
    richDiff: plan.fallbackRichDiff!,
    revisionId,
    source: 'ai',
    insertNewlineMode: 'hardBreak',
    transactionMeta: getPendingRevisionProjectionTransactionMeta(),
  })

  return fallbackResult.success
    ? {
        success: true,
        diffStats: plan.fallbackRichDiff!.stats,
        reason: '表格整块替换失败，已回退到普通文本 Diff',
      }
    : {
        success: false,
        reason:
          fallbackResult.error ||
          tableUpdateResult.reason ||
          '表格整块替换失败，且无法回退到普通文本 Diff',
      }
}

export function executePendingPlanToTr(params: ExecutePendingPlanToTrParams): ExecutePendingPlanResult {
  const { tr, blockPos, revisionId, plan, historyBlockId } = params

  if (plan.kind === 'content-diff') {
    if (!hasMeaningfulDiff(plan.richDiff.stats)) {
      return {
        success: true,
        diffStats: plan.richDiff.stats,
        reason: '内容无差异，无需应用修订',
      }
    }

    const applyResult = applyRichDiffToTr({
      tr,
      blockPos,
      richDiff: plan.richDiff,
      revisionId,
      source: 'ai',
      insertNewlineMode: plan.insertNewlineMode,
    })

    return applyResult.success
      ? { success: true, diffStats: plan.richDiff.stats }
      : { success: false, reason: applyResult.error || '应用 diff 到 mega-tr 失败' }
  }

  if (plan.kind === 'table-insert') {
    const tableApplyResult = applyTableInsertInTr(tr, blockPos, plan.tableRows, revisionId)
    return tableApplyResult.success && tableApplyResult.diffStats
      ? { success: true, diffStats: tableApplyResult.diffStats }
      : { success: false, reason: tableApplyResult.reason || '应用表格到 mega-tr 失败' }
  }

  const tableUpdateResult = applyTableUpdateWithHistoryInTr(
    tr,
    blockPos,
    plan.tableRows,
    revisionId,
    historyBlockId
  )

  if (tableUpdateResult.success && tableUpdateResult.diffStats) {
    return {
      success: true,
      diffStats: tableUpdateResult.diffStats,
      reason: '已通过表格整块替换（保留旧表格历史）应用修订',
    }
  }

  if (!hasMeaningfulDiff(plan.fallbackRichDiff?.stats)) {
    return {
      success: false,
      reason: tableUpdateResult.reason || '表格整块替换失败，且无可回退的文本 diff',
    }
  }

  const fallbackResult = applyRichDiffToTr({
    tr,
    blockPos,
    richDiff: plan.fallbackRichDiff!,
    revisionId,
    source: 'ai',
    insertNewlineMode: 'hardBreak',
  })

  return fallbackResult.success
    ? {
        success: true,
        diffStats: plan.fallbackRichDiff!.stats,
        reason: '表格整块替换失败，已回退到普通文本 Diff',
      }
    : {
        success: false,
        reason:
          fallbackResult.error ||
          tableUpdateResult.reason ||
          '表格整块替换失败，且无法回退到普通文本 Diff',
      }
}
