/**
 * @file shareOption.ts
 * @description 饼图与环形图：少数互斥部分占同一整体的份额。
 *
 * 读者可以突出某个组成部分，但不能隐藏它：隐藏会让剩余扇区被放大成整个圆，改变占比的分母。
 * 扇区之间用 2px 表面色间隔；标签位于外侧并带引导线，放不下的小扇区交给 tooltip 与数据表。
 */

import type { ChartOption } from '../../definitions/chartOption'
import type { ChartRenderContext } from '../../definitions/chartRender'
import { formatChartDisplayValue } from '../chartNumbers'
import { categoryColor } from '../chartPalette'
import type { ChartReadingView } from '../chartReadingView'
import { chartObservationKeys } from '../chartTransition'
import { renderChartTooltip, type ChartTooltipContent } from '../chartTooltip'
import {
  DIMMED_OPACITY,
  baseOption,
  categoryLabel,
  formatShare,
  tooltipFrame,
} from './chartOptionShared'

const MAX_AUTO_LABELED_PARTS = 8

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
      return `${name} ${formatChartDisplayValue(share, { numberFormat: series?.dataLabelFormat ?? spec.dataLabelFormat ?? '0%', locale: ctx.locale })}`
    }
    default:
      return `${name} ${formatChartDisplayValue(value, {
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
      key: { color: categoryColor(ctx.theme, category, series), shape: 'bar' },
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
      color: categoryColor(ctx.theme, category, series),
      opacity: emphasis === null || emphasis === category ? 1 : DIMMED_OPACITY,
      // 扇区之间的 2px 表面色间隔。
      borderColor: ctx.theme.surface,
      borderWidth: 2,
      borderRadius: doughnut ? 4 : 0,
    },
  }))

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
      radius: doughnut ? ['46%', '64%'] : ['0%', '62%'],
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
        color: ctx.theme.textSecondary,
        fontSize: 12,
        formatter: (params: { dataIndex: number }) => {
          const category = view.categoryIndices[params.dataIndex]
          return category === undefined ? '' : labelText(view, ctx, category)
        },
      },
      labelLine: {
        show: labelsOn,
        length: 12,
        length2: 10,
        smooth: true,
        lineStyle: { color: ctx.theme.axisLine, width: 1 },
      },
      emphasis: { scale: true, scaleSize: 5, focus: 'self' },
      blur: { itemStyle: { opacity: 0.3 } },
    }],
  }
}
