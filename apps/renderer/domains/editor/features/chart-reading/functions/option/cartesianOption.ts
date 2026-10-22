/**
 * @file cartesianOption.ts
 * @description 柱/条、折线、面积和组合图的 option。
 *
 * 规则要点：
 * - 数值轴域来自完整数据；隐藏系列和类目聚焦不改变它。
 * - 百分比堆叠在绘制前按“原始完整类目合计”归一，隐藏系列后剩余份额不补足到 100%；tooltip 保留原值。
 * - 柱/条纤细、数据端 4px 圆角、基线端方正；堆叠段之间用 2px 表面色间隔，而不是描边。
 * - 折线 2px，保留实际观测点，不平滑；标记 8px 并带表面色环；面积只是 10% 的淡色铺底。
 */

import type { ChartOption } from '../../definitions/chartOption'
import type { ChartRenderContext } from '../../definitions/chartRender'
import type { ChartDomains } from '../chartDomains'
import { formatChartAxisTick, type NiceScale } from '../chartNumbers'
import { readableTextOn, seriesColor, withAlpha } from '../chartPalette'
import type { ChartReadingView } from '../chartReadingView'
import { chartObservationKeys } from '../chartTransition'
import { renderChartTooltip, type ChartTooltipContent } from '../chartTooltip'
import {
  MAX_BAR_THICKNESS,
  type ChartSeries,
  type ChartSpec,
  axisCaption,
  baseOption,
  categoryLabel,
  formatShare,
  formatSeriesValue,
  mutedAxisLabel,
  resolveDataLabelMode,
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

const BAR_RADIUS = 4

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
    return {
      ...(keys ? { id: keys[category] } : {}),
      value: plotted,
      itemStyle: {
        borderRadius: capped ? barCap(horizontal, raw >= 0) : 0,
        ...(pointColor ? { color: pointColor } : {}),
      },
    }
  })
}

function lineDataFor(item: ShownCartesianSeries, view: ChartReadingView, mode: ReturnType<typeof resolveDataLabelMode>) {
  const lastPosition = view.categoryIndices.length - 1
  const keys = chartObservationKeys(view.spec)
  return view.categoryIndices.map((category, position) => {
    const value = valueAt(item.series, category)
    return { ...(keys ? { id: keys[category] } : {}), value, label: { show: mode === 'all' || mode === 'last' && position === lastPosition } }
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
    splitLine: { show: showGrid, lineStyle: { color: ctx.theme.grid, width: 1, type: 'solid' as const } },
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

function categoryAxis(view: ChartReadingView, ctx: ChartRenderContext, horizontal: boolean) {
  const { spec } = view
  const categories = view.categoryIndices.map(index => categoryLabel(spec, index))
  const slot = horizontal
    ? ctx.plotHeight / Math.max(1, categories.length)
    : (ctx.plotWidth - 72) / Math.max(1, categories.length)
  const rotate = spec.categoryAxis?.labelRotation
  const crowded = !horizontal && rotate === undefined && slot < 40
  return {
    type: 'category' as const,
    data: categories,
    inverse: horizontal,
    position: horizontal ? 'left' as const : 'bottom' as const,
    boundaryGap: spec.chartType !== 'area',
    axisLine: { show: true, lineStyle: { color: ctx.theme.axisLine, width: 1 } },
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

function labelOption(view: ChartReadingView, item: ShownCartesianSeries, ctx: ChartRenderContext, fill: string) {
  const { spec } = view
  const mode = resolveDataLabelMode(spec, item.series, view)
  const stacked = stackingOf(spec) !== 'none'
  return {
    show: mode === 'all',
    position: stacked ? 'inside' as const : item.kind === 'bar' && isHorizontal(spec) ? 'right' as const : 'top' as const,
    color: stacked ? readableTextOn(fill) : ctx.theme.textSecondary,
    fontSize: 12,
    distance: 6,
    formatter: (params: { dataIndex: number }) => {
      const category = view.categoryIndices[params.dataIndex]
      return category === undefined ? '' : formatSeriesValue(spec, item.series, valueAt(item.series, category), ctx)
    },
  }
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
      key: { color: seriesColor(ctx.theme, index, series), shape: kind === 'bar' ? 'bar' as const : 'line' as const },
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
) {
  const { spec } = view
  const color = seriesColor(ctx.theme, item.index, item.series)
  const opacity = seriesOpacity(view, item.series.name)
  const horizontal = isHorizontal(spec)
  const stacking = stackingOf(spec)
  const label = labelOption(view, item, ctx, color)
  const common = {
    id: `series:${item.series.name}`,
    name: item.series.name,
    xAxisIndex: 0,
    yAxisIndex: horizontal || item.axis === 'primary' ? 0 : 1,
    emphasis: { focus: 'series' as const },
    blur: { itemStyle: { opacity: 0.3 }, lineStyle: { opacity: 0.3 }, areaStyle: { opacity: 0.04 } },
    labelLayout: { hideOverlap: true },
  }

  if (item.kind === 'bar') {
    return {
      ...common,
      type: 'bar' as const,
      data: barDataFor(view, shown, item, totals),
      stack: stacking !== 'none' ? 'total' : '',
      barMaxWidth: MAX_BAR_THICKNESS,
      barCategoryGap: '42%',
      barGap: '14%',
      itemStyle: {
        color,
        opacity,
        // 堆叠段之间的 2px 表面色间隔；它是留白，不是描边。
        borderColor: ctx.theme.surface,
        borderWidth: stacking !== 'none' ? 2 : 0,
      },
      label,
      z: 2,
    }
  }

  const marker = item.series.marker
  const dash = item.series.lineDash
  return {
    ...common,
    type: 'line' as const,
    data: lineDataFor(item, view, resolveDataLabelMode(spec, item.series, view)),
    smooth: false,
    showSymbol: marker === 'none' ? false : view.categoryIndices.length <= 24,
    symbol: marker === 'square' ? 'rect' : marker && marker !== 'none' ? marker : 'circle',
    symbolSize: 8,
    lineStyle: {
      color,
      width: 2,
      opacity,
      cap: 'round' as const,
      join: 'round' as const,
      type: dash === 'dash' ? 'dashed' as const : dash === 'dot' ? 'dotted' as const : 'solid' as const,
    },
    // 标记带一圈表面色环：在与线或其他标记交叠处保持可辨。
    itemStyle: { color, opacity, borderColor: ctx.theme.surface, borderWidth: 2 },
    areaStyle: { color, opacity: item.kind === 'area' ? opacity === 1 ? 0.1 : 0.03 : 0 },
    label,
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

  const valueAxes = [
    valueAxis(spec, 'primary', domains.value, ctx, horizontal),
    ...(hasSecondary ? [valueAxis(spec, 'secondary', domains.secondary, ctx, false)] : []),
  ]
  const category = categoryAxis(view, ctx, horizontal)

  const tooltip = ctx.intent === 'export'
    ? { show: false }
    : {
        ...tooltipFrame(ctx),
        trigger: 'axis' as const,
        axisPointer: pureBar
          ? { type: 'shadow' as const, shadowStyle: { color: withAlpha(ctx.theme.textPrimary, 0.05) } }
          : { type: 'line' as const, snap: true, lineStyle: { color: ctx.theme.axisLine, width: 1, type: 'solid' as const } },
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
      right: hasSecondary ? 4 : 14,
      top: hasCaption && !horizontal ? 34 : 12,
      bottom: spec.categoryAxis?.title || (horizontal && spec.valueAxis?.title) ? 36 : 6,
      // ECharts 6：坐标轴刻度文字计入版面，等价于旧版 containLabel。
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    xAxis: horizontal ? valueAxes : category,
    yAxis: horizontal ? category : valueAxes,
    tooltip,
    series: shown.map(item => seriesOption(view, item, shown, ctx, totals)),
  }
}
