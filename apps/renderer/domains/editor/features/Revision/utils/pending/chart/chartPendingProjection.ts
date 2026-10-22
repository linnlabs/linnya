/**
 * @file chartPendingProjection.ts
 * @description 把图表 Pending 计划投影到事务：纯函数，不派发、不登记。
 *
 * 投影只改显示：insert/update 把目标块的内容换成提议的图表，delete 不改文档。
 * 基线（原块）由 Revision 的投影账本保存，保存或拒绝时从账本还原；
 * 图表数据不拆成行内 mark，增删计数按“整张图”计：新增 1，被替换/删除的原内容 1。
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { MarkdownChartSpecSchema, serializeMarkdownChartSpec, type MarkdownChartSpec } from '@app/schemas'
import { generateBlockId } from '../../../../../../../shared/utils/idUtils'
import type { ChartPendingPlan } from './chartPendingPlan'

export interface ChartPendingApplyResult {
  readonly success: boolean
  readonly diffStats?: { readonly insertCount: number; readonly deleteCount: number }
  readonly reason?: string
}

function isSameChartSpec(current: unknown, next: MarkdownChartSpec): boolean {
  const parsed = MarkdownChartSpecSchema.safeParse(current)
  return parsed.success && serializeMarkdownChartSpec(parsed.data) === serializeMarkdownChartSpec(next)
}

/** 目标块当前是否有可被替换的“实际内容”：空段落占位（insert 的占位块）不算。 */
function hasMeaningfulContent(content: ProseMirrorNode): boolean {
  return content.isAtom || content.content.size > 0
}

function putChart(tr: Transaction, blockPos: number, spec: MarkdownChartSpec): ChartPendingApplyResult {
  const root = tr.doc.nodeAt(blockPos)
  const chartType = tr.doc.type.schema.nodes['chartBlock']
  if (!root || root.type.name !== 'rootBlock' || root.childCount === 0) {
    return { success: false, reason: '未找到有效的 rootBlock' }
  }
  if (!chartType) return { success: false, reason: 'schema 缺少 chartBlock 节点' }

  const content = root.child(0)
  if (content.type === chartType) {
    if (isSameChartSpec(content.attrs['spec'], spec)) {
      return { success: true, diffStats: { insertCount: 0, deleteCount: 0 }, reason: '图表无差异，无需应用修订' }
    }
    tr.setNodeMarkup(blockPos + 1, null, { ...content.attrs, spec })
    return { success: true, diffStats: { insertCount: 1, deleteCount: 1 } }
  }

  const currentId: unknown = content.attrs['id']
  const id = typeof currentId === 'string' && currentId !== '' ? currentId : generateBlockId()
  tr.replaceWith(blockPos + 1, blockPos + 1 + content.nodeSize, chartType.create({ id, blockType: 'chart', spec }))
  return { success: true, diffStats: { insertCount: 1, deleteCount: hasMeaningfulContent(content) ? 1 : 0 } }
}

export function applyChartPendingPlanToTr(
  tr: Transaction,
  blockPos: number,
  plan: ChartPendingPlan,
): ChartPendingApplyResult {
  switch (plan.kind) {
    case 'put':
      return putChart(tr, blockPos, plan.spec)
    case 'remove':
      return { success: true, diffStats: { insertCount: 0, deleteCount: 1 } }
    case 'invalid':
      return { success: false, reason: plan.reason }
  }
}
