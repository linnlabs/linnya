/**
 * @file chartPendingPlan.ts
 * @description 图表 Pending 的识别与计划：一条 Pending 是图表写入（insert/update）、图表删除，还是与图表无关。
 *
 * 图表是原子块，不能沿用文本 diff：Revision 为它建立明确的块级计划，并消费 markdownRuntime 的统一准入
 * （与导入、粘贴、流式写入同一判断），不在这里重复解析图表 JSON。
 * 识别只看 Pending 自身：`newMarkdown` 是否恰好是一个 `linnya-chart` 围栏，或被删除的块当前是否是图表。
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { MARKDOWN_CHART_FENCE_LANGUAGE, isMarkdownChartSpecInvalidError, type MarkdownChartSpec } from '@app/schemas'
import {
  admitChartBlockEvent,
  isChartBlockEvent,
  parseMarkdownToBlockEvents,
} from '../../../../../services/markdownRuntime'
import { getParsedOperation } from '../pendingOperation'
import { isIgnorableBlockEvent } from '../pendingMarkdownRuntime'
import type { ParsedPendingRevision } from '../pendingRevisionTypes'
import { findRootBlockPosByIdInDoc } from '../pendingRevisionHelpers'

export type ChartPendingPlan =
  /** insert/update：把目标块的内容换成这份已准入的图表规格。 */
  | { readonly kind: 'put'; readonly spec: MarkdownChartSpec }
  /** delete：目标块当前是图表；文档不变，仅登记待确认的删除。 */
  | { readonly kind: 'remove' }
  /** 围栏无效：不改文档，报告原因（后端写入时已准入，这里只可能来自版本错位）。 */
  | { readonly kind: 'invalid'; readonly reason: string }

export interface ChartPendingItem {
  readonly parsed: ParsedPendingRevision
  readonly plan: ChartPendingPlan
}

/** 不是图表相关的 Pending 返回 null，交回通用文本/表格路径。 */
export async function planChartPendingRevision(
  doc: ProseMirrorNode,
  parsed: ParsedPendingRevision,
): Promise<ChartPendingPlan | null> {
  const operation = getParsedOperation(parsed)

  if (operation === 'delete') {
    if (!parsed.blockId) return null
    const pos = findRootBlockPosByIdInDoc(doc, parsed.blockId)
    const content = pos === null ? null : doc.nodeAt(pos)?.firstChild
    return content?.type.name === 'chartBlock' ? { kind: 'remove' } : null
  }

  const markdown = parsed.newMarkdown ?? ''
  // 绝大多数 Pending 与图表无关：先用子串排除，避免为每条 Pending 多解析一次 Markdown。
  if (!markdown.includes(MARKDOWN_CHART_FENCE_LANGUAGE)) return null

  const events = (await parseMarkdownToBlockEvents(markdown)).filter(event => !isIgnorableBlockEvent(event))
  const [event] = events
  if (events.length !== 1 || !event || !isChartBlockEvent(event)) return null

  try {
    return { kind: 'put', spec: admitChartBlockEvent(event) }
  } catch (error) {
    if (!isMarkdownChartSpecInvalidError(error)) throw error
    return { kind: 'invalid', reason: error.message }
  }
}

/** 把一批已解析的 Pending 分成图表计划与其余部分（保持各自原有顺序）。 */
export async function partitionChartPendingRevisions(
  doc: ProseMirrorNode,
  revisions: readonly ParsedPendingRevision[],
): Promise<{ readonly chartItems: ChartPendingItem[]; readonly others: ParsedPendingRevision[] }> {
  const chartItems: ChartPendingItem[] = []
  const others: ParsedPendingRevision[] = []
  for (const parsed of revisions) {
    const plan = await planChartPendingRevision(doc, parsed)
    if (plan) chartItems.push({ parsed, plan })
    else others.push(parsed)
  }
  return { chartItems, others }
}
