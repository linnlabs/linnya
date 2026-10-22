/**
 * @file chartRevisionView.ts
 * @description 图表块在 Pending 下怎么显示：提议/待删除标记、能否对照原内容、能否编辑。
 *
 * 图表是原子块，修订不拆成行内 mark：块里展示提议（或将被删除的）图表，原块保存在 Revision 的投影账本里，
 * 读者可以切换查看。Pending 期间块内容由数据库修订拥有，所以不提供源码编辑入口。
 */

import type { MarkdownChartSpec } from '@app/schemas'
import type { ChartReadingVariant } from '../../../features/chart-reading'

export type ChartPendingOperation = 'insert' | 'update' | 'delete'

export interface ChartRevisionViewInput {
  /** 该块是否有未决修订及其类型；没有为 null。 */
  readonly operation: ChartPendingOperation | null
  /** 修订是否已经投影到编辑器。 */
  readonly projection: 'deferred' | 'ready' | 'failed' | null
  /** 投影账本是否保存了原块。 */
  readonly baselineAvailable: boolean
  /** 原块内容若是图表则为其规格；不是图表为 null。 */
  readonly baselineSpec: MarkdownChartSpec | null
  /** 读者当前选择查看原内容。 */
  readonly showingBaseline: boolean
}

export interface ChartRevisionView {
  readonly pending: boolean
  readonly badge: 'proposed' | 'deleted' | null
  /** update 且账本有原块：可以在原内容与提议之间切换。 */
  readonly canToggleBaseline: boolean
  /** 正在查看原内容但原内容不是图表。 */
  readonly showBaselineNote: boolean
  /** 展示的是原图表而不是节点里的规格。 */
  readonly displaysBaseline: boolean
  readonly editable: boolean
  /** 阅读状态按展示用途隔离：正文、提议、原内容互不污染。 */
  readonly readingVariant: ChartReadingVariant
}

const NOT_PENDING: ChartRevisionView = Object.freeze({
  pending: false,
  badge: null,
  canToggleBaseline: false,
  showBaselineNote: false,
  displaysBaseline: false,
  editable: true,
  readingVariant: 'document',
})

export function deriveChartRevisionView(input: ChartRevisionViewInput): ChartRevisionView {
  if (input.operation === null) return NOT_PENDING

  // 有未决修订但尚未投影（或投影失败）：块里仍是原内容，不打“提议”标记，也不允许在其上编辑。
  if (input.projection !== 'ready') {
    return { ...NOT_PENDING, pending: true, editable: false }
  }

  if (input.operation === 'delete') {
    return { ...NOT_PENDING, pending: true, badge: 'deleted', editable: false }
  }

  const canToggleBaseline = input.operation === 'update' && input.baselineAvailable
  const showingBaseline = canToggleBaseline && input.showingBaseline
  const displaysBaseline = showingBaseline && input.baselineSpec !== null
  return {
    pending: true,
    badge: 'proposed',
    canToggleBaseline,
    showBaselineNote: showingBaseline && input.baselineSpec === null,
    displaysBaseline,
    editable: false,
    readingVariant: displaysBaseline ? 'baseline' : 'proposed',
  }
}
