/**
 * 单条 Pending Revision - delete 操作应用器
 * 
 * 职责：
 * - 根据 blockId 找到目标 rootBlock
 * - 将 newMarkdown 视为空字符串，计算 RichDiff
 * - 在块内容上打上 delete 类型的 revisionMark
 */

import type { Editor } from '@tiptap/core'
import type { Transaction } from 'prosemirror-state'
import type { ParsedPendingRevision, ApplyDetail } from './pendingRevisionTypes'
import { findRootBlockPosById, findRootBlockPosByIdInDoc } from './pendingRevisionHelpers'
import { linearizeNode, linearizeRootBlock } from '../linearizeBlock'
import {
  executePendingPlanToDocument,
  executePendingPlanToTr,
} from './pendingExecutionPlan'
import { buildDeleteExecutionPlan } from './pendingPlanBuilder'
import { useRevisionStore } from '../../store/useRevisionStore'
import { logRevisionDebug } from '../revisionDebugLogging'
import { markPendingRevisionProjectionTransaction } from '../../../../core/transactions/editorTransactionMeta'

export function applyDeletePendingRevision(
  editor: Editor,
  parsed: ParsedPendingRevision
): ApplyDetail {
  const { blockId } = parsed

  if (!blockId) {
    return {
      id: parsed.id,
      success: false,
      operation: 'delete',
      blockId,
      reason: 'delete 操作缺少 blockId',
    }
  }

  logRevisionDebug(`[applyDeletePendingRevision] 应用 delete 操作，blockId=${blockId}`)

  // 1. 根据 blockId 找到块位置
  const blockPos = findRootBlockPosById(editor, blockId)
  if (blockPos === null) {
    return {
      id: parsed.id,
      success: false,
      operation: 'delete',
      blockId,
      reason: `未找到 blockId=${blockId} 对应的 rootBlock，可能已被删除`,
    }
  }

  // 2. 获取当前块内容
  const currentContent = linearizeRootBlock(editor, blockPos)
  if (!currentContent) {
    return {
      id: parsed.id,
      success: false,
      operation: 'delete',
      blockId,
      reason: `无法提取 blockId=${blockId} 的块内容`,
    }
  }

  const plan = buildDeleteExecutionPlan(currentContent.spans)

  // 5. 如果原本就是空的，跳过
  if (!plan.richDiff.stats.deleteCount) {
    return {
      id: parsed.id,
      success: true,
      operation: 'delete',
      blockId,
      reason: '块内容已为空，无需应用删除修订',
    }
  }

  // 6. 生成 revisionId
  const revisionId = `ai-${parsed.id}`

  const applyResult = executePendingPlanToDocument({
    editor,
    blockPos,
    revisionId,
    plan,
  })

  if (!applyResult.success || !applyResult.diffStats) {
    return {
      id: parsed.id,
      success: false,
      operation: 'delete',
      blockId,
      reason: applyResult.reason || '应用 diff 失败',
    }
  }

  // 8. 在 RevisionStore 中注册修订状态
  try {
    const revisionStore = useRevisionStore(editor)
    revisionStore.startRevision({
      blockId,
      revisionId,
      operation: 'delete',
      diffStats: applyResult.diffStats,
      // 中文说明：优先使用后端 pending_revisions 的 createdAt，避免重复注入导致时间统一刷新
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
    })
  } catch (e) {
    console.warn(`[applyDeletePendingRevision] 注册 RevisionStore 失败:`, e)
  }

  return {
    id: parsed.id,
    success: true,
    operation: 'delete',
    blockId,
  }
}

export async function batchApplyDeletePendingRevisions(
  editor: Editor,
  deletes: ParsedPendingRevision[]
): Promise<ApplyDetail[]> {
  const results: ApplyDetail[] = []
  if (deletes.length === 0) return results

  const prepared: Array<{
    parsed: ParsedPendingRevision
    blockId: string
    revisionId: string
    diffStats?: { insertCount: number; deleteCount: number }
  }> = []
  const megaTr: Transaction = editor.state.tr

  for (const parsed of deletes) {
    const { blockId } = parsed

    if (!blockId) {
      results.push({
        id: parsed.id,
        success: false,
        operation: 'delete',
        blockId,
        reason: 'delete 操作缺少 blockId',
      })
      continue
    }

    const blockPos = findRootBlockPosByIdInDoc(megaTr.doc, blockId)
    if (blockPos === null) {
      results.push({
        id: parsed.id,
        success: false,
        operation: 'delete',
        blockId,
        reason: `未找到 blockId=${blockId} 对应的 rootBlock，可能已被删除`,
      })
      continue
    }

    const rootBlockNode = megaTr.doc.nodeAt(blockPos)
    const currentContent = rootBlockNode ? linearizeNode(rootBlockNode) : null
    if (!rootBlockNode || !currentContent) {
      results.push({
        id: parsed.id,
        success: false,
        operation: 'delete',
        blockId,
        reason: `无法提取 blockId=${blockId} 的块内容`,
      })
      continue
    }

    const plan = buildDeleteExecutionPlan(currentContent.spans)
    if (!plan.richDiff.stats.deleteCount) {
      results.push({
        id: parsed.id,
        success: true,
        operation: 'delete',
        blockId,
        reason: '块内容已为空，无需应用删除修订',
      })
      continue
    }

    const executeResult = executePendingPlanToTr({
      tr: megaTr,
      blockPos,
      revisionId: `ai-${parsed.id}`,
      plan,
    })

    if (!executeResult.success || !executeResult.diffStats) {
      results.push({
        id: parsed.id,
        success: false,
        operation: 'delete',
        blockId,
        reason: executeResult.reason || '应用 diff 到 mega-tr 失败',
      })
      continue
    }

    prepared.push({
      parsed,
      blockId,
      revisionId: `ai-${parsed.id}`,
      diffStats: executeResult.diffStats,
    })
    results.push({
      id: parsed.id,
      success: true,
      operation: 'delete',
      blockId,
    })
  }

  markPendingRevisionProjectionTransaction(megaTr)
  if (megaTr.docChanged) {
    editor.view.dispatch(megaTr)
  }

  for (const item of prepared) {
    if (!item.diffStats || (item.diffStats.insertCount === 0 && item.diffStats.deleteCount === 0)) {
      continue
    }

    try {
      const revisionStore = useRevisionStore(editor)
      revisionStore.startRevision({
        blockId: item.blockId,
        revisionId: item.revisionId,
        operation: 'delete',
        diffStats: item.diffStats,
        createdAt: typeof item.parsed.createdAt === 'number' ? item.parsed.createdAt : undefined,
      })
    } catch (e) {
      console.warn('[batchApplyDeletePendingRevisions] 注册 RevisionStore 失败:', e)
    }
  }

  return results
}
