/**
 * @file chartDomains.ts
 * @description 数值轴域：由完整规格确定，阅读状态（隐藏系列、类目聚焦）不改变它。
 *
 * 只有读者显式聚焦散点的 X/Y 范围时，视口才会改变；此时单位与原值不变，仍落在整齐刻度上。
 */

import type { MarkdownChartSpecReadView as ChartSpec } from '@app/schemas'
import type { ChartReadingState } from '../definitions/chartReadingState'
import { alignScaleToIntervals, cleanFloat, computeNiceScale, resolveAxisDomain, type NiceScale } from './chartNumbers'
import { plotHeightOf, targetTickCount } from './chartLayout'

export interface ChartDomains {
  /** 柱/线/面积/组合的主数值轴；散点的 Y 轴。 */
  readonly value?: NiceScale
  readonly secondary?: NiceScale
  /** 散点 X 轴。 */
  readonly x?: NiceScale
}

interface Extent {
  readonly min: number
  readonly max: number
}

function extentOf(values: readonly number[]): Extent | null {
  if (values.length === 0) return null
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

function stackedExtent(series: readonly { readonly values: readonly number[] }[], categoryCount: number): Extent | null {
  let min = 0
  let max = 0
  for (let category = 0; category < categoryCount; category += 1) {
    let positive = 0
    let negative = 0
    for (const item of series) {
      const value = item.values[category] ?? 0
      if (value >= 0) positive += value
      else negative += value
    }
    min = Math.min(min, negative)
    max = Math.max(max, positive)
  }
  return categoryCount === 0 ? null : { min, max }
}

function domainFor(
  extent: Extent | null,
  axis: { min?: number; max?: number; majorUnit?: number } | undefined,
  options: { includeZero: boolean; ticks: number; padRatio?: number },
): NiceScale | undefined {
  if (!extent) return undefined
  return resolveAxisDomain({
    dataMin: extent.min,
    dataMax: extent.max,
    includeZero: options.includeZero,
    ...(options.padRatio !== undefined ? { padRatio: options.padRatio } : {}),
    ...(axis?.min !== undefined ? { userMin: axis.min } : {}),
    ...(axis?.max !== undefined ? { userMax: axis.max } : {}),
    ...(axis?.majorUnit !== undefined ? { majorUnit: axis.majorUnit } : {}),
    targetTicks: options.ticks,
  })
}

function focusedDomain(range: { min: number; max: number }, ticks: number): NiceScale {
  const scale = computeNiceScale(range.min, range.max, ticks)
  return { min: cleanFloat(range.min), max: cleanFloat(range.max), interval: scale.interval }
}

export function computeChartDomains(spec: ChartSpec, state: ChartReadingState): ChartDomains {
  const ticks = targetTickCount(plotHeightOf(spec))

  switch (spec.chartType) {
    case 'bar': {
      if (spec.stacking === 'percent') {
        const interval = spec.valueAxis?.majorUnit ?? 0.25
        return { value: { min: 0, max: 1, interval } }
      }
      const extent = spec.stacking === 'stacked'
        ? stackedExtent(spec.series, spec.categories.length)
        : extentOf(spec.series.flatMap(series => series.values))
      const value = domainFor(extent, spec.valueAxis, { includeZero: true, ticks })
      return value ? { value } : {}
    }
    case 'line':
    case 'area': {
      const extent = extentOf(spec.series.flatMap(series => series.values))
      const value = domainFor(extent, spec.valueAxis, { includeZero: spec.chartType === 'area', ticks })
      return value ? { value } : {}
    }
    case 'combo': {
      const onAxis = (axis: 'primary' | 'secondary') => spec.series.filter(series => (series.axis ?? 'primary') === axis)
      const build = (axis: 'primary' | 'secondary') => {
        const hosted = onAxis(axis)
        return domainFor(
          extentOf(hosted.flatMap(series => series.values)),
          axis === 'primary' ? spec.valueAxis : spec.secondaryValueAxis,
          { includeZero: hosted.some(series => series.chartType !== 'line'), ticks },
        )
      }
      const value = build('primary')
      let secondary = build('secondary')
      // 作者没有限定次轴时，尽量让次轴刻度与主轴网格线对齐。
      const authored = spec.secondaryValueAxis
      const secondaryExtent = extentOf(onAxis('secondary').flatMap(series => series.values))
      if (value && secondary && secondaryExtent && authored?.min === undefined && authored?.max === undefined && authored?.majorUnit === undefined) {
        const intervals = Math.round((value.max - value.min) / value.interval)
        const aligned = alignScaleToIntervals(secondaryExtent.min, secondaryExtent.max, intervals, {
          includeZero: onAxis('secondary').some(series => series.chartType !== 'line'),
        })
        secondary = aligned ?? secondary
      }
      return { ...(value ? { value } : {}), ...(secondary ? { secondary } : {}) }
    }
    case 'scatter': {
      const x = state.xRange
        ? focusedDomain(state.xRange, ticks)
        : domainFor(extentOf(spec.categories.filter((value): value is number => typeof value === 'number')), spec.xAxis, { includeZero: false, ticks, padRatio: 0.04 })
      const y = state.yRange
        ? focusedDomain(state.yRange, ticks)
        : domainFor(extentOf(spec.series.flatMap(series => series.values)), spec.valueAxis, { includeZero: false, ticks, padRatio: 0.04 })
      return { ...(y ? { value: y } : {}), ...(x ? { x } : {}) }
    }
    default:
      return {}
  }
}
