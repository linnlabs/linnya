/**
 * @file chartOptionShared.ts
 * @description 各图表类型共用的 option 片段与取值规则。
 *
 * 视觉原则（面向研究文章，而非仪表盘）：数据是唯一响亮的部分。标记纤细、网格与轴线是比表面深一档的发丝线，
 * 间隔用表面色而不是描边，标签稀疏，文字永远使用文字色而不是系列色。
 */

import type { MarkdownChartSeriesReadView, MarkdownChartSpecReadView } from '@app/schemas'
import type { ChartOption } from '../../definitions/chartOption'
import type { ChartRenderContext } from '../../definitions/chartRender'
import type { ChartReadingView } from '../chartReadingView'
import { formatChartDisplayValue } from '../chartNumbers'

export type ChartSpec = MarkdownChartSpecReadView
export type ChartSeries = MarkdownChartSeriesReadView

/** 持久突出某对象时，其余对象的透明度。 */
export const DIMMED_OPACITY = 0.28

/** 条/柱的最大厚度：留白属于画面的一部分，不填满分类槽。 */
export const MAX_BAR_THICKNESS = 24

const UPDATE_TRANSITION_MS = 450

export function baseOption(ctx: ChartRenderContext): Pick<
  ChartOption,
  'animation' | 'animationDuration' | 'animationDurationUpdate' | 'animationEasingUpdate' | 'backgroundColor' | 'textStyle' | 'aria'
> {
  return {
    // 首次渲染、主题/尺寸变化与再次入屏直接呈现最终结果；只有明确的数据更新才播放短过渡。
    animation: ctx.transition,
    animationDuration: 0,
    animationDurationUpdate: ctx.transition ? UPDATE_TRANSITION_MS : 0,
    animationEasingUpdate: 'cubicOut',
    backgroundColor: 'transparent',
    textStyle: { fontFamily: ctx.theme.fontFamily, fontSize: 12, color: ctx.theme.textSecondary },
    aria: { enabled: true, decal: { show: false } },
  }
}

/** tooltip 外壳：外观由内容节点自带，ECharts 只负责定位。导出渲染不含交互。 */
export function tooltipFrame(ctx: ChartRenderContext): NonNullable<ChartOption['tooltip']> {
  if (ctx.intent === 'export') return { show: false }
  return {
    confine: true,
    appendToBody: true,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    extraCssText: 'box-shadow:none;',
    transitionDuration: 0.08,
    hideDelay: 80,
  }
}

/** 作者在承载该系列的数值轴上声明的格式，其次是数据标签格式。 */
export function numberFormatFor(spec: ChartSpec, series: ChartSeries): string | undefined {
  if (series.dataLabelFormat !== undefined) return series.dataLabelFormat
  if (spec.chartType === 'combo' && series.axis === 'secondary') {
    return spec.secondaryValueAxis?.numberFormat ?? spec.dataLabelFormat
  }
  return spec.valueAxis?.numberFormat ?? spec.dataLabelFormat
}

export function formatSeriesValue(
  spec: ChartSpec,
  series: ChartSeries,
  value: number,
  ctx: Pick<ChartRenderContext, 'locale'>,
): string {
  const numberFormat = numberFormatFor(spec, series)
  return formatChartDisplayValue(value, { ...(numberFormat ? { numberFormat } : {}), locale: ctx.locale })
}

export function categoryLabel(spec: ChartSpec, index: number): string {
  return String(spec.categories[index])
}

export type DataLabelMode = 'all' | 'last' | 'none'

/**
 * 数据标签：显式 true 请求显示（由避碰保证可读），显式 false 关闭；
 * 缺省时按类型和密度克制地决定——不在每个点上放数字，完整数值始终在 tooltip 与数据表中。
 */
export function resolveDataLabelMode(spec: ChartSpec, series: ChartSeries, view: ChartReadingView): DataLabelMode {
  const explicit = series.showDataLabels ?? spec.showDataLabels
  if (explicit === true) return 'all'
  if (explicit === false) return 'none'

  const visibleSeries = view.seriesVisible.filter(Boolean).length
  const visibleCategories = view.categoryIndices.length
  switch (spec.chartType) {
    case 'bar':
      return spec.stacking === undefined || spec.stacking === 'none'
        ? (visibleSeries === 1 && visibleCategories <= 12 ? 'all' : 'none')
        : 'none'
    case 'line':
    case 'area':
      return visibleSeries <= 4 ? 'last' : 'none'
    default:
      return 'none'
  }
}

/** 持久突出时，未被突出的系列变淡。 */
export function seriesOpacity(view: ChartReadingView, seriesName: string): number {
  const emphasis = view.state.emphasis
  return emphasis === null || emphasis === seriesName ? 1 : DIMMED_OPACITY
}

/** 轴标题以小号弱化文字置于轴端，不占用画布中央。 */
export function axisCaption(ctx: ChartRenderContext, align: 'left' | 'right') {
  return {
    nameLocation: 'end' as const,
    nameGap: 14,
    nameTextStyle: { color: ctx.theme.textMuted, fontSize: 12, align, padding: [0, 0, 2, 0] },
  }
}

export function textAxisLabel(ctx: ChartRenderContext) {
  return { color: ctx.theme.textSecondary, fontSize: 12, hideOverlap: true }
}

export function mutedAxisLabel(ctx: ChartRenderContext) {
  return { color: ctx.theme.textMuted, fontSize: 12, hideOverlap: true }
}

export function formatShare(share: number, ctx: Pick<ChartRenderContext, 'locale'>): string {
  return new Intl.NumberFormat(ctx.locale, { style: 'percent', maximumFractionDigits: 1 }).format(share)
}
