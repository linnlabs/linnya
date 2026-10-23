/**
 * @file chartLegend.ts
 * @description 图例模型：DOM 图例、阅读控件和导出图片共用同一份条目。
 *
 * 图例是身份的可靠通道，不依赖读者对着颜色猜：≥2 个系列、以及饼/环（按类目）总有图例；
 * 单系列的标题已经说明了所画内容，不再放只有一个色块的图例。
 * 例外：折线/面积的系列不多时，行末直接标出“系列名 + 末值”（见 {@link usesEndLabels}），不再重复放图例；
 * 阅读选项里的筛选/突出入口仍然存在。
 */

import type { MarkdownChartSpecReadView as ChartSpec } from '@app/schemas'
import type { ChartReadingState } from '../definitions/chartReadingState'
import type { ChartThemeTokens } from '../definitions/chartTheme'
import { categoryMarkColors, seriesMarkColors } from './chartPalette'
import { emphasisTargetsCategories, supportsSeriesFiltering } from './chartReadingState'

export type ChartLegendPosition = 'top' | 'bottom' | 'left' | 'right' | 'none'

export interface ChartLegendItem {
  /** 系列名；饼/环为类目下标的字符串，与阅读状态中的突出键一致。 */
  readonly id: string
  readonly label: string
  /** 填充与描线：条形/圆点键用填充 + 描线轮廓，线键用描线色。 */
  readonly fill: string
  readonly ink: string
  readonly shape: 'bar' | 'line' | 'dot'
  /** 该系列当前被读者隐藏。 */
  readonly hidden: boolean
  readonly emphasized: boolean
  /** 可被隐藏（饼/环的组成部分只能突出）。 */
  readonly filterable: boolean
  /** 组合图中位于次轴的系列。 */
  readonly secondaryAxis: boolean
}

/** 行末直标最多承载的系列数：再多时行末标签会互相挤压，回到图例。 */
export const MAX_END_LABEL_SERIES = 5

/** 折线/面积在系列不多、且作者没有指定图例位置时，用行末直标代替图例。作者显式写了 `legendPosition` 就尊重它。 */
export function usesEndLabels(spec: ChartSpec): boolean {
  return (spec.chartType === 'line' || spec.chartType === 'area')
    && spec.legendPosition === undefined
    && spec.series.length <= MAX_END_LABEL_SERIES
}

export function resolveLegendPosition(spec: ChartSpec): ChartLegendPosition {
  if (spec.legendPosition !== undefined) return spec.legendPosition
  if (emphasisTargetsCategories(spec)) return 'bottom'
  if (usesEndLabels(spec)) return 'none'
  return spec.series.length >= 2 ? 'bottom' : 'none'
}

function keyShape(spec: ChartSpec, seriesIndex: number): ChartLegendItem['shape'] {
  switch (spec.chartType) {
    case 'bar':
      return 'bar'
    case 'scatter':
      return 'dot'
    case 'combo':
      return (spec.series[seriesIndex]?.chartType ?? 'bar') === 'bar' ? 'bar' : 'line'
    case 'pie':
    case 'doughnut':
      return 'bar'
    default:
      return 'line'
  }
}

/** 图例条目（无论是否展示）；`position: none` 时阅读选项仍通过它提供筛选/突出入口。 */
export function buildChartLegend(spec: ChartSpec, state: ChartReadingState, theme: ChartThemeTokens): ChartLegendItem[] {
  if (emphasisTargetsCategories(spec)) {
    const series = spec.series[0]
    return spec.categories.map((category, index) => ({
      id: String(index),
      label: String(category),
      ...categoryMarkColors(theme, index, series),
      shape: 'bar',
      hidden: false,
      emphasized: state.emphasis === String(index),
      filterable: false,
      secondaryAxis: false,
    }))
  }
  return spec.series.map((series, index) => ({
    id: series.name,
    label: series.name,
    ...seriesMarkColors(theme, index, series),
    shape: keyShape(spec, index),
    hidden: state.hiddenSeries.includes(series.name),
    emphasized: state.emphasis === series.name,
    filterable: supportsSeriesFiltering(spec),
    secondaryAxis: spec.chartType === 'combo' && series.axis === 'secondary',
  }))
}
