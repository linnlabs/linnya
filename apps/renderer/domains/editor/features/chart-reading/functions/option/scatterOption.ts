/**
 * @file scatterOption.ts
 * @description 散点图：两个数值变量的关系。X/Y 都按真实数值定位，不把 X 当等距类目。
 *
 * 不拟合趋势线、不挪动重叠点；点是半透明的无描边填充色，重叠处仍可辨。读者聚焦范围只改变视口，
 * 数值轴域与原值不变。
 */

import type { ChartOption } from '../../definitions/chartOption'
import type { ChartRenderContext } from '../../definitions/chartRender'
import type { ChartDomains } from '../chartDomains'
import { formatChartAxisTick, formatChartDisplayValue, type NiceScale } from '../chartNumbers'
import { seriesMarkColors } from '../chartPalette'
import { chartObservationKeys } from '../chartTransition'
import type { ChartReadingView } from '../chartReadingView'
import { renderChartTooltip, type ChartTooltipContent } from '../chartTooltip'
import { filledMark } from './chartMarkStyle'
import {
  type ChartSeries,
  type ChartSpec,
  axisCaption,
  baseOption,
  mutedAxisLabel,
  seriesOpacity,
  tooltipFrame,
} from './chartOptionShared'

interface ShownScatterSeries {
  readonly series: ChartSeries
  readonly index: number
}

function shownScatterSeries(view: ChartReadingView): ShownScatterSeries[] {
  return view.spec.series.flatMap((series, index) => (view.seriesVisible[index] ? [{ series, index }] : []))
}

function xValueOf(spec: ChartSpec, point: number): number {
  const value = spec.categories[point]
  return typeof value === 'number' ? value : Number.NaN
}

function symbolSizeFor(pointCount: number): number {
  return pointCount <= 60 ? 7 : pointCount <= 300 ? 6 : 5
}

export function buildScatterTooltipContent(
  view: ChartReadingView,
  ctx: ChartRenderContext,
  seriesIndex: number,
  point: number,
): ChartTooltipContent | null {
  const { spec } = view
  const series = spec.series[seriesIndex]
  if (!series || point < 0 || point >= spec.categories.length) return null
  const x = xValueOf(spec, point)
  const y = series.values[point] ?? Number.NaN
  const xFormat = spec.xAxis?.numberFormat
  const yFormat = spec.valueAxis?.numberFormat
  const colors = seriesMarkColors(ctx.theme, seriesIndex, series, spec.series.length)
  return {
    heading: spec.pointLabels?.[point] ?? series.name,
    rows: [
      {
        key: { ...colors, shape: 'dot' },
        label: spec.xAxis?.title ?? 'X',
        value: formatChartDisplayValue(x, { ...(xFormat ? { numberFormat: xFormat } : {}), locale: ctx.locale }),
      },
      {
        key: { ...colors, shape: 'dot' },
        label: spec.valueAxis?.title ?? 'Y',
        value: formatChartDisplayValue(y, { ...(yFormat ? { numberFormat: yFormat } : {}), locale: ctx.locale }),
        ...(spec.pointLabels?.[point] ? { detail: series.name } : {}),
      },
    ],
  }
}

function numericAxis(
  authored: ChartSpec['valueAxis'],
  domain: NiceScale | undefined,
  ctx: ChartRenderContext,
  placement: 'x' | 'y',
) {
  const numberFormat = authored?.numberFormat
  return {
    type: 'value' as const,
    ...(domain ? { min: domain.min, max: domain.max, interval: domain.interval } : {}),
    position: placement === 'x' ? 'bottom' as const : 'left' as const,
    splitLine: { show: authored?.showGridlines ?? placement === 'y', lineStyle: { color: ctx.theme.gridColor, width: 0.5, type: 'solid' as const } },
    axisLine: placement === 'x' ? { show: true, lineStyle: { color: ctx.theme.gridColor, width: 0.5 } } : { show: false },
    axisTick: { show: false },
    axisLabel: {
      ...mutedAxisLabel(ctx),
      margin: 8,
      formatter: (value: number) => formatChartAxisTick(value, { ...(numberFormat ? { numberFormat } : {}), locale: ctx.locale }),
    },
    ...(authored?.title
      ? (placement === 'x'
          ? { name: authored.title, nameLocation: 'middle' as const, nameGap: 32, nameTextStyle: { color: ctx.theme.textMuted, fontSize: 12 } }
          : { name: authored.title, ...axisCaption(ctx, 'left') })
      : {}),
  }
}

export function buildScatterOption(view: ChartReadingView, domains: ChartDomains, ctx: ChartRenderContext): ChartOption {
  const { spec } = view
  const shown = shownScatterSeries(view)
  const keys = chartObservationKeys(spec)

  const series = shown.map(({ series: item, index }) => {
    const colors = seriesMarkColors(ctx.theme, index, item, spec.series.length)
    const opacity = seriesOpacity(view, item.name)
    const marker = item.marker
    return {
      id: `series:${item.name}`,
      name: item.name,
      type: 'scatter' as const,
      data: spec.categories.map((_, point) => ({
        // 和过渡准入使用同一身份来源；只给 values 时 ECharts 会按下标错配重排后的对象。
        ...(keys ? { id: keys[point] } : {}),
        value: [xValueOf(spec, point), item.values[point] ?? Number.NaN],
      })),
      symbol: marker === 'square' ? 'rect' : marker && marker !== 'none' ? marker : 'circle',
      symbolSize: symbolSizeFor(spec.categories.length),
      itemStyle: filledMark(colors, 0.8 * opacity),
      emphasis: { focus: 'series' as const, scale: 1.5 },
      blur: { itemStyle: { opacity: 0.25 } },
      z: 3,
    }
  })

  return {
    ...baseOption(ctx),
    grid: {
      left: 4,
      right: 18,
      top: spec.valueAxis?.title ? 34 : 14,
      bottom: spec.xAxis?.title ? 38 : 6,
      // ECharts 6：坐标轴刻度文字计入版面，等价于旧版 containLabel。
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    xAxis: numericAxis(spec.xAxis, domains.x, ctx, 'x'),
    yAxis: numericAxis(spec.valueAxis, domains.value, ctx, 'y'),
    tooltip: ctx.intent === 'export'
      ? { show: false }
      : {
          ...tooltipFrame(ctx),
          trigger: 'item',
          formatter: (params: unknown) => {
            const dataIndex = typeof params === 'object' && params !== null ? Reflect.get(params, 'dataIndex') : undefined
            const seriesPosition = typeof params === 'object' && params !== null ? Reflect.get(params, 'seriesIndex') : undefined
            const original = typeof seriesPosition === 'number' ? shown[seriesPosition]?.index : undefined
            const content = typeof dataIndex === 'number' && original !== undefined
              ? buildScatterTooltipContent(view, ctx, original, dataIndex)
              : null
            return content ? renderChartTooltip(content, ctx.theme) : ''
          },
        },
    series,
  }
}
