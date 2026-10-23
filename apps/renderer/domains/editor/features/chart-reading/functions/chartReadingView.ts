/**
 * @file chartReadingView.ts
 * @description 把规格与阅读状态合成“这次要画什么”：可见类目与可见系列。
 *
 * 颜色、轴域和百分比分母都以完整规格为准，视图只决定哪些类目/系列出现在画布上，
 * 因此筛选不会重新分配颜色，也不会改变占比的分母。
 */

import type { MarkdownChartSpecReadView as ChartSpec } from '@app/schemas'
import type { ChartReadingState } from '../definitions/chartReadingState'
import type { ChartHighlightTarget } from '../definitions/chartRender'
import { emphasisTargetsCategories, isDefaultReadingState, normalizeReadingState } from './chartReadingState'

export interface ChartReadingView {
  readonly spec: ChartSpec
  readonly state: ChartReadingState
  /** 可见类目在 `spec.categories` 中的下标，保持作者顺序。 */
  readonly categoryIndices: readonly number[]
  /** 与 `spec.series` 同序：该系列此刻是否绘制。 */
  readonly seriesVisible: readonly boolean[]
  readonly isDefault: boolean
}

export function deriveChartReadingView(spec: ChartSpec, requested: ChartReadingState): ChartReadingView {
  const state = normalizeReadingState(spec, requested)
  const range = state.categoryRange
  const start = range?.start ?? 0
  const end = range?.end ?? spec.categories.length - 1
  const categoryIndices = Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
  return {
    spec,
    state,
    categoryIndices,
    seriesVisible: spec.series.map(series => !state.hiddenSeries.includes(series.name)),
    isDefault: isDefaultReadingState(state),
  }
}

/** 图例保留完整实体集，临时突出只能指向当前可见项；范围聚焦后必须转换类目下标。 */
export function resolveChartHighlight(view: ChartReadingView, id: string | null): ChartHighlightTarget | null {
  if (id === null) return null
  if (emphasisTargetsCategories(view.spec)) {
    const index = view.categoryIndices.indexOf(Number(id))
    return index < 0 ? null : { kind: 'part', index }
  }
  const index = view.spec.series.findIndex(series => series.name === id)
  return view.seriesVisible[index] ? { kind: 'series', name: id } : null
}
