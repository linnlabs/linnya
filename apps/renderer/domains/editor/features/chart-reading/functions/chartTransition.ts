/**
 * @file chartTransition.ts
 * @description 数据更新何时可以播放过渡：只有能明确确认“同一个对象”时才动。
 *
 * 过渡的含义是“这个系列/这个观测对象从旧值变成新值”。如果无法确认对应关系
 * （重复类目、无对象标签且 X/Y 同时变化、类型或坐标语义改变），动画会伪造不存在的轨迹，
 * 因此直接显示最终图。这些数据仍然可以合法绘制，只是没有过渡。
 * 实体身份由内容决定，从不按数组下标猜测。
 */

import type { MarkdownChartSpecReadView as ChartSpec } from '@app/schemas'

function allUnique(values: readonly (string | number)[]): boolean {
  return new Set(values.map(String)).size === values.length
}

function sharesAny(left: readonly (string | number)[], right: readonly (string | number)[]): boolean {
  const known = new Set(left.map(String))
  return right.some(value => known.has(String(value)))
}

/** 和 ECharts 数据项共用身份；有歧义时不提供伪造的持久身份。 */
export function chartObservationKeys(spec: ChartSpec): readonly string[] | null {
  const values = spec.chartType === 'scatter' ? spec.pointLabels ?? spec.categories : spec.categories
  if (!allUnique(values)) return null
  const prefix = spec.chartType === 'scatter' ? spec.pointLabels ? 'label' : 'x' : 'category'
  return values.map(value => `${prefix}:${value}`)
}

function presentationKey(spec: ChartSpec): string {
  const { categories, pointLabels, series, ...presentation } = spec
  void categories
  void pointLabels
  return JSON.stringify({ ...presentation, series: series.map(({ values, ...style }) => { void values; return style }) })
}

function sameCoordinateSemantics(previous: ChartSpec, next: ChartSpec): boolean {
  if (previous.chartType !== next.chartType) return false
  if ((previous.barDirection ?? 'vertical') !== (next.barDirection ?? 'vertical')) return false
  if ((previous.stacking ?? 'none') !== (next.stacking ?? 'none')) return false
  if ((previous.size ?? 'medium') !== (next.size ?? 'medium')) return false
  for (const field of ['categoryAxis', 'valueAxis', 'secondaryValueAxis', 'xAxis', 'radarScale'] as const) {
    if (JSON.stringify(previous[field]) !== JSON.stringify(next[field])) return false
  }
  if (previous.chartType === 'combo') {
    // 系列的绘制类型和所属坐标轴必须一致，否则“同名系列”并不是同一个图形对象。
    const kinds = new Map(previous.series.map(series => [series.name, `${series.chartType}:${series.axis ?? 'primary'}`]))
    return next.series.every(series => !kinds.has(series.name) || kinds.get(series.name) === `${series.chartType}:${series.axis ?? 'primary'}`)
  }
  return true
}

export function canTransitionBetween(previous: ChartSpec | null, next: ChartSpec): boolean {
  if (previous === null || !sameCoordinateSemantics(previous, next)) return false
  if (presentationKey(previous) !== presentationKey(next)) return false

  const previousSeries = previous.series.map(series => series.name)
  const nextSeries = next.series.map(series => series.name)
  if (!allUnique(previousSeries) || !allUnique(nextSeries) || !sharesAny(previousSeries, nextSeries)) return false

  const previousKeys = chartObservationKeys(previous)
  const nextKeys = chartObservationKeys(next)
  if (!previousKeys || !nextKeys || !sharesAny(previousKeys, nextKeys)) return false

  if (next.chartType === 'scatter') {
    const previousLabels = previous.pointLabels
    const nextLabels = next.pointLabels
    if (previousLabels && nextLabels) {
      return allUnique(previousLabels) && allUnique(nextLabels) && sharesAny(previousLabels, nextLabels)
    }
    // 没有对象标签：只在 X 完全不变且互不重复的点之间建立对应。
    return previous.categories.length === next.categories.length
      && previous.categories.every((value, index) => value === next.categories[index])
      && allUnique(next.categories)
  }

  return allUnique(previous.categories) && allUnique(next.categories) && sharesAny(previous.categories, next.categories)
}
