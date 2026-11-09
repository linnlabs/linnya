/**
 * @file chartOptionShared.ts
 * @description 各图表类型共用的 option 片段与取值规则。
 *
 * 视觉原则（面向研究文章）：数据使用内容色，网格与基线使用界面的弱分隔色；
 * 填充无描边、线条细，标签按密度显示，文字使用正文色而不是系列色。
 */

import type { MarkdownChartSeriesReadView, MarkdownChartSpecReadView } from '@app/schemas'
import type { ChartOption } from '../../definitions/chartOption'
import type { ChartRenderContext } from '../../definitions/chartRender'
import type { ChartThemeTokens } from '../../definitions/chartTheme'
import type { ChartReadingView } from '../chartReadingView'
import { formatChartDisplayValue } from '../chartNumbers'
import { withAlpha } from '../chartPalette'

export type ChartSpec = MarkdownChartSpecReadView
export type ChartSeries = MarkdownChartSeriesReadView

/** 持久突出某对象时，其余对象的透明度。 */
export const DIMMED_OPACITY = 0.28

/** 条/柱的最大厚度：留白属于画面的一部分，不填满分类槽。 */
export const MAX_BAR_THICKNESS = 22

/** 悬停指示线由文字色弱化；常驻网格和基线另用主题的 gridColor。 */
export const INK_ALPHA = Object.freeze({ pointer: 0.2 })

export function inkTint(theme: ChartThemeTokens, alpha: number): string {
  return withAlpha(theme.textPrimary, alpha)
}

/** ECharts 富文本把 `{样式|文字}` 当作标记；不可信文本里的花括号换成全角，避免被解释成样式。 */
export function sanitizeRichText(text: string): string {
  return text.replace(/\{/g, '｛').replace(/\}/g, '｝')
}

/** 估算文字宽度（px）：CJK 全宽，其余约 0.6em。只用于给行末标签留边距，不求精确。 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const character of text) width += (character.codePointAt(0) ?? 0) > 0x2e80 ? fontSize : fontSize * 0.6
  return width
}

const UPDATE_TRANSITION_MS = 450

export function baseOption(ctx: ChartRenderContext): Pick<
  ChartOption,
  'animation' | 'animationDuration' | 'animationDurationUpdate' | 'animationEasingUpdate' | 'backgroundColor' | 'textStyle' | 'aria' | 'axisPointer'
> {
  return {
    // 首次渲染、主题/尺寸变化与再次入屏直接呈现最终结果；只有明确的数据更新才播放短过渡。
    animation: ctx.transition,
    animationDuration: 0,
    animationDurationUpdate: ctx.transition ? UPDATE_TRANSITION_MS : 0,
    animationEasingUpdate: 'cubicOut',
    // 坐标提示器会独立发送 highlight；只禁用系列 emphasis 不足以关闭这条路径。
    axisPointer: { triggerEmphasis: false },
    backgroundColor: 'transparent',
    textStyle: { fontFamily: ctx.theme.fontFamily, fontSize: 12, color: ctx.theme.textSecondary },
    // ECharts 的自动描述会朗读堆叠后的内部维度和 NaN，并覆盖宿主的图形标题。
    // 图形的简短可访问名称由 ChartSurface 提供；完整原始值通过“查看数据”表格访问。
    aria: { enabled: false },
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
