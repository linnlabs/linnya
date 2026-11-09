/**
 * @file shareOption.ts
 * @description 饼图与环形图：少数互斥部分占同一整体的份额。
 *
 * 读者可以突出某个组成部分，但不能隐藏它：隐藏会让剩余扇区被放大成整个圆，改变占比的分母。
 * 扇区是无描边原色填充；标签位于外侧并带引导线，放不下的小扇区交给 tooltip 与数据表。
 * 半径随绘图区宽度收缩：外侧标签需要固定的横向空间，窄图里先缩小圆，而不是让标签被截断。
 */

import type { ChartOption } from '../../definitions/chartOption'
import type { ChartRenderContext } from '../../definitions/chartRender'
import { formatChartDisplayValue } from '../chartNumbers'
import { categoryMarkColors } from '../chartPalette'
import type { ChartReadingView } from '../chartReadingView'
import { chartObservationKeys } from '../chartTransition'
import { renderChartTooltip, type ChartTooltipContent } from '../chartTooltip'
import { HOVER_EMPHASIS, filledMark } from './chartMarkStyle'
import {
  DIMMED_OPACITY,
  baseOption,
  categoryLabel,
  formatShare,
  tooltipFrame,
} from './chartOptionShared'

const MAX_AUTO_LABELED_PARTS = 8
/** 圆环厚度占外半径的比例，保持组成部分的可见面积。 */
const RING_THICKNESS = 0.34
/** 外侧标签（引导线 + 文字）需要的单侧横向空间。 */
const LABEL_ROOM_PX = 96
const MIN_OUTER_RATIO = 0.4
const MAX_OUTER_RATIO = 0.66

/** 外半径占 `min(宽, 高) / 2` 的比例：宽图取上限，窄图收缩到给标签留出 {@link LABEL_ROOM_PX}。 */
export function shareOuterRatio(plotWidth: number, plotHeight: number): number {
  const halfShortSide = Math.min(plotWidth, plotHeight) / 2
  const room = (plotWidth / 2 - LABEL_ROOM_PX) / halfShortSide
  return Math.min(MAX_OUTER_RATIO, Math.max(MIN_OUTER_RATIO, room))
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`
}

function emphasisIndexOf(view: ChartReadingView): number | null {
  return view.state.emphasis === null ? null : Number(view.state.emphasis)
}

function partTotal(view: ChartReadingView): number {
  return (view.spec.series[0]?.values ?? []).reduce((sum, value) => sum + value, 0)
}

function labelText(view: ChartReadingView, ctx: ChartRenderContext, category: number): string {
  const { spec } = view
  const series = spec.series[0]
  const name = categoryLabel(spec, category)
  const value = series?.values[category] ?? 0
  switch (spec.dataLabelContent ?? 'value') {
    case 'category':
      return name
    case 'percentage': {
      const total = partTotal(view)
      const share = total > 0 ? value / total : 0
      return `${name}\n${formatChartDisplayValue(share, { numberFormat: series?.dataLabelFormat ?? spec.dataLabelFormat ?? '0%', locale: ctx.locale })}`
    }
    default:
      return `${name}\n${formatChartDisplayValue(value, {
        ...(series?.dataLabelFormat ?? spec.dataLabelFormat ? { numberFormat: series?.dataLabelFormat ?? spec.dataLabelFormat } : {}),
        locale: ctx.locale,
      })}`
  }
}

export function buildShareTooltipContent(view: ChartReadingView, ctx: ChartRenderContext, category: number): ChartTooltipContent | null {
  const { spec } = view
  const series = spec.series[0]
  if (!series || category < 0 || category >= spec.categories.length) return null
  const value = series.values[category] ?? 0
  const total = partTotal(view)
  const numberFormat = series.dataLabelFormat ?? spec.dataLabelFormat
  return {
    heading: categoryLabel(spec, category),
    rows: [{
      key: { ...categoryMarkColors(ctx.theme, category, series, spec.categories.length), shape: 'bar' },
      label: ctx.messages.share,
      value: total > 0 ? formatShare(value / total, ctx) : '—',
      detail: formatChartDisplayValue(value, { ...(numberFormat ? { numberFormat } : {}), locale: ctx.locale }),
    }],
  }
}

export function buildShareOption(view: ChartReadingView, ctx: ChartRenderContext): ChartOption {
  const { spec } = view
  const series = spec.series[0]
  const doughnut = spec.chartType === 'doughnut'
  const emphasis = emphasisIndexOf(view)
  const labelsOn = (series?.showDataLabels ?? spec.showDataLabels) ?? spec.categories.length <= MAX_AUTO_LABELED_PARTS
  const keys = chartObservationKeys(spec)

  const data = view.categoryIndices.map(category => ({
    ...(keys ? { id: keys[category] } : {}),
    name: categoryLabel(spec, category),
    value: series?.values[category] ?? 0,
    itemStyle: {
      ...filledMark(categoryMarkColors(ctx.theme, category, series, spec.categories.length), emphasis === null || emphasis === category ? 1 : DIMMED_OPACITY),
      borderRadius: 0,
    },
  }))
  const outer = shareOuterRatio(ctx.plotWidth, ctx.plotHeight)

  return {
    ...baseOption(ctx),
    tooltip: ctx.intent === 'export'
      ? { show: false }
      : {
          ...tooltipFrame(ctx),
          trigger: 'item',
          formatter: (params: unknown) => {
            const position = typeof params === 'object' && params !== null ? Reflect.get(params, 'dataIndex') : undefined
            const category = typeof position === 'number' ? view.categoryIndices[position] : undefined
            const content = category === undefined ? null : buildShareTooltipContent(view, ctx, category)
            return content ? renderChartTooltip(content, ctx.theme) : ''
          },
        },
    series: [{
      id: `series:${series?.name}`,
      type: 'pie',
      name: series?.name ?? '',
      radius: doughnut ? [percent(outer * (1 - RING_THICKNESS)), percent(outer)] : ['0%', percent(outer)],
      center: ['50%', '50%'],
      startAngle: 90,
      // 小份额仍按真实比例绘制；最小角度会放大小份额，甚至让零值出现扇区。
      minAngle: 0,
      minShowLabelAngle: 4,
      avoidLabelOverlap: true,
      selectedMode: false,
      data,
      label: {
        show: labelsOn,
        position: 'outside',
        color: ctx.theme.textPrimary,
        fontSize: 12,
        lineHeight: 18,
        formatter: (params: { dataIndex: number }) => {
          const category = view.categoryIndices[params.dataIndex]
          return category === undefined ? '' : labelText(view, ctx, category)
        },
      },
      labelLine: {
        show: labelsOn,
        length: 10,
        length2: 8,
        smooth: false,
        lineStyle: { color: ctx.theme.gridColor, width: 0.5 },
      },
      emphasis: HOVER_EMPHASIS,
    }],
  }
}
