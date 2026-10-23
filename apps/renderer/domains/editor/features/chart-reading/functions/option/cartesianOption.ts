/**
 * @file cartesianOption.ts
 * @description 柱/条、折线、面积和组合图的 option。
 *
 * 规则要点：
 * - 数值轴域来自完整数据；隐藏系列和类目聚焦不改变它。
 * - 百分比堆叠在绘制前按“原始完整类目合计”归一，隐藏系列后剩余份额不补足到 100%；tooltip 保留原值。
 * - 柱/条纤细、数据端 2px 圆角、基线端方正；原色无描边填充，堆叠段保持连续色序。
 * - 折线 2px，保留实际观测点，不平滑；标记与线同色；面积以低透明度平铺。
 * - 系列不多的折线/面积在行末直接标出“系列名 + 末值”，不再放图例（见 {@link usesEndLabels}）。
 */

import type { ChartOption } from '../../definitions/chartOption'
import type { ChartRenderContext } from '../../definitions/chartRender'
import type { ChartDomains } from '../chartDomains'
import { usesEndLabels } from '../chartLegend'
import { formatChartAxisTick, formatChartDisplayValue, type NiceScale } from '../chartNumbers'
import { categoryMarkColors, markColorsFromFill, readableTextOn, seriesMarkColors, withAlpha } from '../chartPalette'
import type { ChartReadingView } from '../chartReadingView'
import { chartObservationKeys } from '../chartTransition'
import { renderChartTooltip, type ChartTooltipContent } from '../chartTooltip'
import { HOVER_EMPHASIS, MARK_STYLE, areaFill, lineMarker, filledMark } from './chartMarkStyle'
import {
  INK_ALPHA,
  DIMMED_OPACITY,
  MAX_BAR_THICKNESS,
  type ChartSeries,
  type ChartSpec,
  axisCaption,
  baseOption,
  categoryLabel,
  estimateTextWidth,
  formatShare,
  formatSeriesValue,
  inkTint,
  mutedAxisLabel,
  resolveDataLabelMode,
  sanitizeRichText,
  seriesOpacity,
  textAxisLabel,
  tooltipFrame,
} from './chartOptionShared'

type SeriesKind = 'bar' | 'line' | 'area'

export interface ShownCartesianSeries {
  readonly series: ChartSeries
  /** 在完整 `spec.series` 中的下标：颜色与图例以它为准。 */
  readonly index: number
  readonly kind: SeriesKind
  readonly axis: 'primary' | 'secondary'
}

const BAR_RADIUS = 2
const END_LABEL_FONT_SIZE = 11
const END_LABEL_DISTANCE = 8
const MIN_END_LABEL_GUTTER = 72
const MAX_END_LABEL_GUTTER_RATIO = 0.36
/** 水平方向上绘图区之外占去的宽度：左侧数值轴刻度与内边距约 58px，再加右侧留白；至少按 72px 估算。 */
const HORIZONTAL_CHROME_BASE = 58
const MIN_HORIZONTAL_CHROME = 72
const DEFAULT_RIGHT_MARGIN = 14
const SECONDARY_RIGHT_MARGIN = 4

export function isCartesianSpec(spec: ChartSpec): boolean {
  return spec.chartType === 'bar' || spec.chartType === 'line' || spec.chartType === 'area' || spec.chartType === 'combo'
}

function kindOf(spec: ChartSpec, series: ChartSeries): SeriesKind {
  if (spec.chartType === 'combo') return series.chartType ?? 'bar'
  return spec.chartType === 'line' || spec.chartType === 'area' ? spec.chartType : 'bar'
}

export function shownCartesianSeries(view: ChartReadingView): ShownCartesianSeries[] {
  const { spec } = view
  return spec.series.flatMap((series, index) => view.seriesVisible[index]
    ? [{ series, index, kind: kindOf(spec, series), axis: series.axis === 'secondary' ? 'secondary' as const : 'primary' as const }]
    : [])
}

function isHorizontal(spec: ChartSpec): boolean {
  return spec.chartType === 'bar' && spec.barDirection === 'horizontal'
}

function stackingOf(spec: ChartSpec): 'none' | 'stacked' | 'percent' {
  return spec.chartType === 'bar' ? spec.stacking ?? 'none' : 'none'
}

/** 百分比堆叠的分母：每个类目下全部系列（含被隐藏者）的合计。 */
function categoryTotals(spec: ChartSpec): number[] {
  return spec.categories.map((_, category) =>
    spec.series.reduce((sum, series) => sum + (series.values[category] ?? 0), 0))
}

function valueAt(series: ChartSeries, category: number): number {
  return series.values[category] ?? 0
}

function barCap(horizontal: boolean, positive: boolean): [number, number, number, number] {
  if (horizontal) return positive ? [0, BAR_RADIUS, BAR_RADIUS, 0] : [BAR_RADIUS, 0, 0, BAR_RADIUS]
  return positive ? [BAR_RADIUS, BAR_RADIUS, 0, 0] : [0, 0, BAR_RADIUS, BAR_RADIUS]
}

/** 每个类目下，可见堆叠的正向/负向“最后一段”所属系列，只有它们的数据端取圆角。 */
function stackEnds(shown: readonly ShownCartesianSeries[], category: number) {
  let positive: number | null = null
  let negative: number | null = null
  for (const item of shown) {
    if (item.kind !== 'bar') continue
    if (valueAt(item.series, category) >= 0) positive = item.index
    else negative = item.index
  }
  return { positive, negative }
}

function barDataFor(
  view: ChartReadingView,
  shown: readonly ShownCartesianSeries[],
  item: ShownCartesianSeries,
  totals: readonly number[],
  ctx: ChartRenderContext,
) {
  const { spec } = view
  const horizontal = isHorizontal(spec)
  const stacking = stackingOf(spec)
  const keys = chartObservationKeys(spec)
  return view.categoryIndices.map(category => {
    const raw = valueAt(item.series, category)
    const total = totals[category] ?? 0
    const plotted = stacking === 'percent' ? (total ? raw / total : 0) : raw
    const capped = stacking === 'none'
      || (() => {
        const ends = stackEnds(shown, category)
        return raw >= 0 ? ends.positive === item.index : ends.negative === item.index
      })()
    const pointColor = item.series.pointColors?.[category]
    const byCategory = spec.chartType === 'bar' && spec.colorBy === 'category'
    const pointColors = byCategory ? categoryMarkColors(ctx.theme, category, item.series, spec.categories.length)
      : pointColor ? markColorsFromFill(pointColor, ctx.theme) : null
    return {
      ...(keys ? { id: keys[category] } : {}),
      value: plotted,
      itemStyle: {
        borderRadius: capped ? barCap(horizontal, raw >= 0) : 0,
        ...(pointColors ? { color: pointColors.fill } : {}),
        ...(byCategory ? { opacity: view.state.emphasis === null || view.state.emphasis === String(category) ? 1 : DIMMED_OPACITY } : {}),
      },
      ...(pointColors && stacking !== 'none' ? { label: { color: readableTextOn(pointColors.fill) } } : {}),
    }
  })
}

/** 折线某个观测点是否带数值标签。启用行末直标时，末点的数值已在行末标签里，不再重复。 */
function pointLabelVisible(mode: ReturnType<typeof resolveDataLabelMode>, position: number, last: number, endLabels: boolean): boolean {
  if (endLabels) return mode === 'all' && position !== last
  return mode === 'all' || (mode === 'last' && position === last)
}

function lineDataFor(
  item: ShownCartesianSeries,
  view: ChartReadingView,
  mode: ReturnType<typeof resolveDataLabelMode>,
  endLabels: boolean,
) {
  const lastPosition = view.categoryIndices.length - 1
  const keys = chartObservationKeys(view.spec)
  return view.categoryIndices.map((category, position) => {
    const value = valueAt(item.series, category)
    return {
      ...(keys ? { id: keys[category] } : {}),
      value,
      label: { show: pointLabelVisible(mode, position, lastPosition, endLabels) },
    }
  })
}

function axisFormatterFor(spec: ChartSpec, axis: 'primary' | 'secondary', ctx: ChartRenderContext) {
  const authored = axis === 'secondary' ? spec.secondaryValueAxis?.numberFormat : spec.valueAxis?.numberFormat
  const numberFormat = authored ?? (stackingOf(spec) === 'percent' ? '0%' : undefined)
  return (value: number) => formatChartAxisTick(value, { ...(numberFormat ? { numberFormat } : {}), locale: ctx.locale })
}

function valueAxis(
  spec: ChartSpec,
  axis: 'primary' | 'secondary',
  domain: NiceScale | undefined,
  ctx: ChartRenderContext,
  horizontal: boolean,
) {
  const authored = axis === 'secondary' ? spec.secondaryValueAxis : spec.valueAxis
  const showGrid = authored?.showGridlines ?? axis === 'primary'
  return {
    type: 'value' as const,
    ...(domain ? { min: domain.min, max: domain.max, interval: domain.interval } : {}),
    position: horizontal ? 'bottom' as const : axis === 'secondary' ? 'right' as const : 'left' as const,
    splitLine: { show: showGrid, lineStyle: { color: ctx.theme.gridColor, width: 0.5, type: 'solid' as const } },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { ...mutedAxisLabel(ctx), margin: 8, formatter: axisFormatterFor(spec, axis, ctx) },
    ...(authored?.title
      ? (horizontal
          ? { name: authored.title, nameLocation: 'middle' as const, nameGap: 30, nameTextStyle: { color: ctx.theme.textMuted, fontSize: 12 } }
          : { name: authored.title, ...axisCaption(ctx, axis === 'secondary' ? 'right' : 'left') })
      : {}),
  }
}

/** 每个类目在横向上占的宽度估计。标签宽度据此设定；估大了，相邻标签的框会重叠，ECharts 会隔一个隐藏。 */
export function categorySlotWidth(plotWidth: number, categoryCount: number, rightMargin: number): number {
  const chrome = Math.max(MIN_HORIZONTAL_CHROME, HORIZONTAL_CHROME_BASE + rightMargin)
  return (plotWidth - chrome) / Math.max(1, categoryCount)
}

function categoryAxis(view: ChartReadingView, ctx: ChartRenderContext, horizontal: boolean, rightMargin: number) {
  const { spec } = view
  const categories = view.categoryIndices.map(index => categoryLabel(spec, index))
  const slot = horizontal
    ? ctx.plotHeight / Math.max(1, categories.length)
    : categorySlotWidth(ctx.plotWidth, categories.length, rightMargin)
  const rotate = spec.categoryAxis?.labelRotation
  const crowded = !horizontal && rotate === undefined && slot < 40
  return {
    type: 'category' as const,
    data: categories,
    inverse: horizontal,
    position: horizontal ? 'left' as const : 'bottom' as const,
    boundaryGap: spec.chartType !== 'area',
    axisLine: { show: true, lineStyle: { color: ctx.theme.gridColor, width: 0.5 } },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: {
      ...textAxisLabel(ctx),
      margin: 10,
      interval: 0,
      ...(rotate !== undefined ? { rotate } : crowded ? { rotate: 40 } : {}),
      ...(horizontal
        ? { width: Math.min(132, Math.max(64, ctx.plotWidth * 0.3)), overflow: 'truncate' as const }
        : crowded || rotate !== undefined ? {} : { width: Math.max(32, slot - 8), overflow: 'break' as const, lineHeight: 15 }),
    },
    ...(spec.categoryAxis?.title
      ? { name: spec.categoryAxis.title, nameLocation: 'middle' as const, nameGap: horizontal ? 56 : 34, nameTextStyle: { color: ctx.theme.textMuted, fontSize: 12 } }
      : {}),
  }
}

function labelOption(view: ChartReadingView, item: ShownCartesianSeries, ctx: ChartRenderContext, fill: string, totals: readonly number[]) {
  const { spec } = view
  const mode = resolveDataLabelMode(spec, item.series, view)
  const stacked = stackingOf(spec) !== 'none'
  return {
    show: mode === 'all',
    position: stacked ? 'inside' as const : item.kind === 'bar' && isHorizontal(spec) ? 'right' as const : 'top' as const,
    color: stacked ? readableTextOn(fill) : ctx.theme.textPrimary,
    fontSize: 11,
    fontWeight: 400,
    distance: 6,
    formatter: (params: { dataIndex: number }) => {
      const category = view.categoryIndices[params.dataIndex]
      if (category === undefined) return ''
      const raw = valueAt(item.series, category)
      if (stackingOf(spec) === 'percent') {
        const total = totals[category] ?? 0
        return formatChartDisplayValue(raw / total, { numberFormat: item.series.dataLabelFormat ?? spec.dataLabelFormat ?? '0.0%', locale: ctx.locale })
      }
      return formatSeriesValue(spec, item.series, raw, ctx)
    },
  }
}

/** 行末标签的文字：系列名 + 末值，数值加粗。不可信的系列名先净化，不能被当成富文本样式。 */
function endLabelOption(view: ChartReadingView, item: ShownCartesianSeries, ctx: ChartRenderContext) {
  const lastCategory = view.categoryIndices[view.categoryIndices.length - 1]
  if (lastCategory === undefined) return undefined
  const value = formatSeriesValue(view.spec, item.series, valueAt(item.series, lastCategory), ctx)
  return {
    show: true,
    distance: END_LABEL_DISTANCE,
    formatter: `{name|${sanitizeRichText(item.series.name)}}  {value|${sanitizeRichText(value)}}`,
    rich: {
      name: { color: ctx.theme.textSecondary, fontSize: END_LABEL_FONT_SIZE },
      value: { color: ctx.theme.textPrimary, fontSize: END_LABEL_FONT_SIZE, fontWeight: 600 },
    },
  }
}

/** 给行末标签预留的右侧留白：按最长的“系列名 + 末值”估算，并限制在绘图区宽度的一部分内。 */
function endLabelGutter(view: ChartReadingView, shown: readonly ShownCartesianSeries[], ctx: ChartRenderContext): number {
  const lastCategory = view.categoryIndices[view.categoryIndices.length - 1]
  if (lastCategory === undefined) return MIN_END_LABEL_GUTTER
  const widest = shown.reduce((width, item) => {
    const value = formatSeriesValue(view.spec, item.series, valueAt(item.series, lastCategory), ctx)
    return Math.max(width, estimateTextWidth(item.series.name, END_LABEL_FONT_SIZE) + 10 + estimateTextWidth(value, END_LABEL_FONT_SIZE))
  }, 0)
  const ceiling = Math.max(MIN_END_LABEL_GUTTER, Math.floor(ctx.plotWidth * MAX_END_LABEL_GUTTER_RATIO))
  return Math.min(ceiling, Math.max(MIN_END_LABEL_GUTTER, Math.ceil(widest) + END_LABEL_DISTANCE + 12))
}

/** tooltip 的内容：列出该类目下每个可见系列的正式观测值（不是动画插值，也不是归一化后的绘制值）。 */
export function buildCartesianTooltipContent(
  view: ChartReadingView,
  ctx: ChartRenderContext,
  position: number,
): ChartTooltipContent | null {
  const { spec } = view
  const category = view.categoryIndices[position]
  if (category === undefined) return null
  const stacking = stackingOf(spec)
  const total = categoryTotals(spec)[category] ?? 0

  const rows = shownCartesianSeries(view).map(({ series, index, kind, axis }) => {
    const raw = valueAt(series, category)
    const suffix = spec.chartType === 'combo' && axis === 'secondary' ? ` · ${ctx.messages.secondaryAxis}` : ''
    return {
      key: {
        ...(spec.chartType === 'bar' && spec.colorBy === 'category'
          ? categoryMarkColors(ctx.theme, category, series, spec.categories.length)
          : kind === 'bar' && series.pointColors?.[category]
            ? markColorsFromFill(series.pointColors[category], ctx.theme)
            : seriesMarkColors(ctx.theme, index, series, spec.series.length)),
        shape: kind === 'bar' ? 'bar' as const : 'line' as const,
      },
      label: `${series.name}${suffix}`,
      value: formatSeriesValue(spec, series, raw, ctx),
      ...(stacking === 'percent' && total > 0
        ? { detail: `${ctx.messages.shareOfWhole} ${formatShare(raw / total, ctx)}` }
        : {}),
    }
  })
  return { heading: categoryLabel(spec, category), rows }
}

function seriesOption(
  view: ChartReadingView,
  item: ShownCartesianSeries,
  shown: readonly ShownCartesianSeries[],
  ctx: ChartRenderContext,
  totals: readonly number[],
  endLabels: boolean,
) {
  const { spec } = view
  const colors = seriesMarkColors(ctx.theme, item.index, item.series, view.spec.series.length)
  const opacity = spec.chartType === 'bar' && spec.colorBy === 'category' ? 1 : seriesOpacity(view, item.series.name)
  const horizontal = isHorizontal(spec)
  const stacking = stackingOf(spec)
  const label = labelOption(view, item, ctx, colors.fill, totals)
  const common = {
    id: `series:${item.series.name}`,
    name: item.series.name,
    xAxisIndex: 0,
    yAxisIndex: horizontal || item.axis === 'primary' ? 0 : 1,
    emphasis: HOVER_EMPHASIS,
    labelLayout: { hideOverlap: true },
  }

  if (item.kind === 'bar') {
    return {
      ...common,
      type: 'bar' as const,
      data: barDataFor(view, shown, item, totals, ctx),
      stack: stacking !== 'none' ? 'total' : '',
      barMaxWidth: MAX_BAR_THICKNESS,
      barCategoryGap: '42%',
      barGap: '14%',
      itemStyle: filledMark(colors, opacity),
      label,
      z: 2,
    }
  }

  const marker = item.series.marker
  const dash = item.series.lineDash
  const endLabel = endLabels ? endLabelOption(view, item, ctx) : undefined
  return {
    ...common,
    // 直标时按标签位置错开，避免相近的行末互相覆盖。
    ...(endLabel ? { labelLayout: { moveOverlap: 'shiftY' as const } } : {}),
    type: 'line' as const,
    data: lineDataFor(item, view, resolveDataLabelMode(spec, item.series, view), endLabels),
    smooth: false,
    showSymbol: marker === 'none' ? false : view.categoryIndices.length <= 24,
    symbol: marker === 'square' ? 'rect' : marker && marker !== 'none' ? marker : 'circle',
    symbolSize: MARK_STYLE.markerSize,
    lineStyle: {
      color: colors.ink,
      width: MARK_STYLE.lineWidth,
      opacity,
      cap: 'round' as const,
      join: 'round' as const,
      type: dash === 'dash' ? 'dashed' as const : dash === 'dot' ? 'dotted' as const : 'solid' as const,
    },
    // 小标记与细线共用可读线色，不叠加轮廓。
    itemStyle: lineMarker(colors, opacity),
    ...(item.kind === 'area' ? { areaStyle: { color: areaFill(colors.fill, opacity === 1) } } : {}),
    label,
    ...(endLabel ? { endLabel } : {}),
    z: 3,
  }
}

export function buildCartesianOption(view: ChartReadingView, domains: ChartDomains, ctx: ChartRenderContext): ChartOption {
  const { spec } = view
  const horizontal = isHorizontal(spec)
  const shown = shownCartesianSeries(view)
  const totals = categoryTotals(spec)
  const hasSecondary = spec.chartType === 'combo' && spec.secondaryValueAxis !== undefined
  const hasCaption = Boolean(spec.valueAxis?.title || spec.secondaryValueAxis?.title)
  const pureBar = shown.every(item => item.kind === 'bar')
  const endLabels = usesEndLabels(spec) && shown.length > 0

  const valueAxes = [
    valueAxis(spec, 'primary', domains.value, ctx, horizontal),
    ...(hasSecondary ? [valueAxis(spec, 'secondary', domains.secondary, ctx, false)] : []),
  ]
  const rightMargin = hasSecondary ? SECONDARY_RIGHT_MARGIN : endLabels ? endLabelGutter(view, shown, ctx) : DEFAULT_RIGHT_MARGIN
  const category = categoryAxis(view, ctx, horizontal, rightMargin)

  const tooltip = ctx.intent === 'export'
    ? { show: false }
    : {
        ...tooltipFrame(ctx),
        trigger: 'axis' as const,
        axisPointer: pureBar
          ? { type: 'shadow' as const, shadowStyle: { color: withAlpha(ctx.theme.textPrimary, 0.05) } }
          : { type: 'line' as const, snap: true, lineStyle: { color: inkTint(ctx.theme, INK_ALPHA.pointer), width: 1, type: 'solid' as const } },
        formatter: (params: unknown) => {
          const first: unknown = Array.isArray(params) ? params[0] : params
          const position = typeof first === 'object' && first !== null ? Reflect.get(first, 'dataIndex') : undefined
          const content = typeof position === 'number' ? buildCartesianTooltipContent(view, ctx, position) : null
          return content ? renderChartTooltip(content, ctx.theme) : ''
        },
      }

  return {
    ...baseOption(ctx),
    grid: {
      left: 4,
      right: rightMargin,
      top: hasCaption && !horizontal ? 34 : 12,
      bottom: spec.categoryAxis?.title || (horizontal && spec.valueAxis?.title) ? 36 : 6,
      // ECharts 6：坐标轴刻度文字计入版面，等价于旧版 containLabel。
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    xAxis: horizontal ? valueAxes : category,
    yAxis: horizontal ? category : valueAxes,
    tooltip,
    series: shown.map(item => seriesOption(view, item, shown, ctx, totals, endLabels)),
  }
}
