/**
 * @file chartPendingRevisionApplier.ts
 * @description 图表 Pending 的批量投影：一次事务应用一批图表计划，并向 Revision 登记各自的增删统计。
 *
 * 与文本路径相互独立：图表计划不经过 RichDiff、不产生 revisionMark；位置按 blockId 在事务文档中重新定位，
 * 失败只影响该条 Pending，不阻断同批其他块。登记条件与文本路径一致（有实际增删才登记）。
 */

import type { Editor } from '@tiptap/core'
import { markPendingRevisionProjectionTransaction } from '../../../../../core/transactions/editorTransactionMeta'
import { useRevisionStore } from '../../../useRevisionStore'
import { getParsedOperation } from '../pendingOperation'
import { findRootBlockPosByIdInDoc } from '../pendingRevisionHelpers'
import type { ApplyDetail } from '../pendingRevisionTypes'
import { applyChartPendingPlanToTr } from './chartPendingProjection'
import type { ChartPendingItem } from './chartPendingPlan'

export function applyChartPendingItems(editor: Editor, items: readonly ChartPendingItem[]): ApplyDetail[] {
  if (items.length === 0) return []

  const store = useRevisionStore(editor)
  const tr = editor.state.tr
  const results: ApplyDetail[] = []
  const registrations: Array<{ item: ChartPendingItem; diffStats: { insertCount: number; deleteCount: number } }> = []

  for (const item of items) {
    const { parsed, plan } = item
    const operation = getParsedOperation(parsed)
    const fail = (reason: string) => results.push({ id: parsed.id, success: false, operation, blockId: parsed.blockId, reason })

    if (!parsed.blockId) {
      fail(`${operation} 操作缺少 blockId`)
      continue
    }
    const pos = findRootBlockPosByIdInDoc(tr.doc, parsed.blockId)
    if (pos === null) {
      fail(`未找到 blockId=${parsed.blockId} 对应的 rootBlock，可能已被删除`)
      continue
    }

    const result = applyChartPendingPlanToTr(tr, pos, plan)
    if (!result.success) {
      fail(result.reason ?? '图表 Pending 应用失败')
      continue
    }
    results.push({ id: parsed.id, success: true, operation, blockId: parsed.blockId, ...(result.reason ? { reason: result.reason } : {}) })
    if (result.diffStats && (result.diffStats.insertCount > 0 || result.diffStats.deleteCount > 0)) {
      registrations.push({ item, diffStats: result.diffStats })
    }
  }

  markPendingRevisionProjectionTransaction(tr)
  if (tr.docChanged) editor.view.dispatch(tr)

  for (const { item, diffStats } of registrations) {
    const { parsed } = item
    if (!parsed.blockId) continue
    store.startRevision({
      blockId: parsed.blockId,
      revisionId: `ai-${parsed.id}`,
      operation: getParsedOperation(parsed),
      diffStats,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
    })
  }
  return results
}
