/**
 * @file chartReadingState.ts
 * @description 阅读状态的规则：哪些操作适用于哪种图表、何时有效、何时必须重置。
 *
 * 全部为纯函数。是否重置由“语义键”比较决定，而不是对象引用变化：标题、尺寸、颜色这类展示改动
 * 保留有效的阅读状态；数据、类型、类目或轴语义改变则回到默认视图，避免旧筛选解释新数据。
 */

import type { MarkdownChartSpecReadView as ChartSpec } from '@app/schemas'
import {
  DEFAULT_CHART_READING_STATE,
  type ChartIndexRange,
  type ChartReadingState,
  type ChartValueRange,
} from '../definitions/chartReadingState'

/** 可按系列隐藏/突出的图表类型；饼与环只能突出，不能隐藏组成部分。 */
export function supportsSeriesFiltering(spec: ChartSpec): boolean {
  return !emphasisTargetsCategories(spec)
}

/** 以类目为横（纵）轴的图表可以聚焦类目范围。 */
export function supportsCategoryRange(spec: ChartSpec): boolean {
  return spec.chartType === 'bar' || spec.chartType === 'line' || spec.chartType === 'area' || spec.chartType === 'combo'
}

export function supportsValueRange(spec: ChartSpec): boolean {
  return spec.chartType === 'scatter'
}

/** 饼/环与按类目着色的单系列柱图突出类目，其余突出系列。 */
export function emphasisTargetsCategories(spec: ChartSpec): boolean {
  return spec.chartType === 'pie' || spec.chartType === 'doughnut' || (spec.chartType === 'bar' && spec.colorBy === 'category')
}

export function isDefaultReadingState(state: ChartReadingState): boolean {
  return state.hiddenSeries.length === 0
    && state.emphasis === null
    && state.categoryRange === null
    && state.xRange === null
    && state.yRange === null
}

function fullCategoryRange(spec: ChartSpec, range: ChartIndexRange): boolean {
  return range.start === 0 && range.end === spec.categories.length - 1
}

/** 把任意状态收敛为对 spec 有效的状态：丢弃不存在的系列、越界范围和不适用的字段。 */
export function normalizeReadingState(spec: ChartSpec, state: ChartReadingState): ChartReadingState {
  const seriesNames = new Set(spec.series.map(series => series.name))
  const hiddenSeries = supportsSeriesFiltering(spec)
    ? state.hiddenSeries.filter(name => seriesNames.has(name))
    : []

  let emphasis: string | null = state.emphasis
  if (emphasis !== null) {
    if (emphasisTargetsCategories(spec)) {
      const index = Number(emphasis)
      if (!Number.isInteger(index) || index < 0 || index >= spec.categories.length) emphasis = null
    } else if (!seriesNames.has(emphasis) || hiddenSeries.includes(emphasis)) {
      emphasis = null
    }
  }

  let categoryRange: ChartIndexRange | null = null
  if (supportsCategoryRange(spec) && state.categoryRange) {
    const last = spec.categories.length - 1
    const start = Math.min(Math.max(0, Math.floor(state.categoryRange.start)), last)
    const end = Math.min(Math.max(start, Math.floor(state.categoryRange.end)), last)
    const clamped = { start, end }
    categoryRange = fullCategoryRange(spec, clamped) ? null : clamped
  }

  const keepValueRanges = supportsValueRange(spec)
  const sameState = hiddenSeries.length === state.hiddenSeries.length
    && emphasis === state.emphasis
    && categoryRange?.start === state.categoryRange?.start
    && categoryRange?.end === state.categoryRange?.end
    && (keepValueRanges || (state.xRange === null && state.yRange === null))
  if (sameState) return state

  return {
    hiddenSeries,
    emphasis,
    categoryRange,
    xRange: keepValueRanges ? state.xRange : null,
    yRange: keepValueRanges ? state.yRange : null,
  }
}

export function toggleSeriesVisibility(
  spec: ChartSpec,
  state: ChartReadingState,
  seriesName: string,
): ChartReadingState {
  if (!supportsSeriesFiltering(spec) || !spec.series.some(series => series.name === seriesName)) return state
  const hidden = state.hiddenSeries.includes(seriesName)
  return normalizeReadingState(spec, {
    ...state,
    hiddenSeries: hidden
      ? state.hiddenSeries.filter(name => name !== seriesName)
      : [...state.hiddenSeries, seriesName],
  })
}

/** 再次选择同一对象即取消突出。 */
export function toggleEmphasis(spec: ChartSpec, state: ChartReadingState, key: string): ChartReadingState {
  return normalizeReadingState(spec, { ...state, emphasis: state.emphasis === key ? null : key })
}

export function setCategoryRange(
  spec: ChartSpec,
  state: ChartReadingState,
  range: ChartIndexRange | null,
): ChartReadingState {
  return normalizeReadingState(spec, { ...state, categoryRange: range })
}

export function setValueRanges(
  spec: ChartSpec,
  state: ChartReadingState,
  ranges: { readonly xRange?: ChartValueRange | null; readonly yRange?: ChartValueRange | null },
): ChartReadingState {
  const valid = (range: ChartValueRange | null | undefined) =>
    range === undefined ? undefined : range !== null && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min < range.max ? range : null
  const xRange = valid(ranges.xRange)
  const yRange = valid(ranges.yRange)
  return normalizeReadingState(spec, {
    ...state,
    xRange: xRange === undefined ? state.xRange : xRange,
    yRange: yRange === undefined ? state.yRange : yRange,
  })
}

export function resetReadingState(): ChartReadingState {
  return DEFAULT_CHART_READING_STATE
}

/**
 * 只包含“会改变阅读状态含义”的字段。标题、说明、尺寸、颜色、标签格式等展示改动不在其中，
 * 因此不会让读者的筛选意外丢失；数据、类型、类目或轴语义变化则必须重置。
 */
export function readingSemanticKey(spec: ChartSpec): string {
  const range = (axis: { min?: number; max?: number; majorUnit?: number } | undefined) =>
    axis ? [axis.min ?? null, axis.max ?? null, axis.majorUnit ?? null] : null
  return JSON.stringify({
    type: spec.chartType,
    categories: spec.categories,
    pointLabels: spec.pointLabels ?? null,
    series: spec.series.map(series => [series.name, series.values, series.chartType ?? null, series.axis ?? 'primary']),
    stacking: spec.stacking ?? 'none',
    barDirection: spec.barDirection ?? 'vertical',
    colorBy: spec.colorBy ?? 'series',
    value: range(spec.valueAxis),
    secondary: range(spec.secondaryValueAxis),
    x: range(spec.xAxis),
    radar: spec.radarScale?.max ?? null,
  })
}

/** 规格更新后决定阅读状态：语义变化 → 默认视图；否则保留并收敛为有效状态。 */
export function reconcileReadingState(
  previous: ChartSpec | null,
  next: ChartSpec,
  state: ChartReadingState,
): ChartReadingState {
  if (previous === null || readingSemanticKey(previous) !== readingSemanticKey(next)) return DEFAULT_CHART_READING_STATE
  return normalizeReadingState(next, state)
}
