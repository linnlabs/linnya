/**
 * @file radarOption.ts
 * @description 雷达图：同一量尺上的多维轮廓比较。
 *
 * 量尺来自规格中的固定 `radarScale`，绝不按各维度自身最大值偷偷归一化；
 * 异质指标需要作者先按公开方法转换，并在正文或数据表中说明。
 */

import type { ChartOption } from '../../definitions/chartOption'
import type { ChartRenderContext } from '../../definitions/chartRender'
import { formatPlainNumber } from '../chartNumbers'
import { seriesMarkColors } from '../chartPalette'
import type { ChartReadingView } from '../chartReadingView'
import { renderChartTooltip, type ChartTooltipContent } from '../chartTooltip'
import { MARK_STYLE, lineMarker, radarFillAlpha } from './chartMarkStyle'
import { baseOption, categoryLabel, seriesOpacity, tooltipFrame } from './chartOptionShared'

export function buildRadarTooltipContent(view: ChartReadingView, ctx: ChartRenderContext, seriesIndex: number): ChartTooltipContent | null {
  const { spec } = view
  const series = spec.series[seriesIndex]
  if (!series) return null
  const colors = seriesMarkColors(ctx.theme, seriesIndex, series, spec.series.length)
  return {
    heading: series.name,
    rows: view.categoryIndices.map(category => ({
      key: { ...colors, shape: 'dot' as const },
      label: categoryLabel(spec, category),
      value: formatPlainNumber(series.values[category] ?? Number.NaN, ctx.locale),
    })),
  }
}

export function buildRadarOption(view: ChartReadingView, ctx: ChartRenderContext): ChartOption {
  const { spec } = view
  const max = spec.radarScale?.max ?? 1
  const shown = spec.series.flatMap((series, index) => (view.seriesVisible[index] ? [{ series, index }] : []))

  return {
    ...baseOption(ctx),
    radar: {
      indicator: view.categoryIndices.map(category => ({ name: categoryLabel(spec, category), min: 0, max })),
      shape: 'polygon',
      splitNumber: 4,
      radius: '70%',
      center: ['50%', '52%'],
      axisNameGap: 10,
      axisName: { color: ctx.theme.textSecondary, fontSize: 12 },
      axisLine: { lineStyle: { color: ctx.theme.gridColor, width: 0.5 } },
      splitLine: { lineStyle: { color: ctx.theme.gridColor, width: 0.5 } },
      splitArea: { show: false },
      // 量尺是固定且共用的：不在每根轴上重复刻度数字，由图表脚注标明范围。
      axisLabel: { show: false },
    },
    tooltip: ctx.intent === 'export'
      ? { show: false }
      : {
          ...tooltipFrame(ctx),
          trigger: 'item',
          formatter: (params: unknown) => {
            const position = typeof params === 'object' && params !== null ? Reflect.get(params, 'dataIndex') : undefined
            const original = typeof position === 'number' ? shown[position]?.index : undefined
            const content = original === undefined ? null : buildRadarTooltipContent(view, ctx, original)
            return content ? renderChartTooltip(content, ctx.theme) : ''
          },
        },
    series: [{
      type: 'radar',
      data: shown.map(({ series, index }) => {
        const colors = seriesMarkColors(ctx.theme, index, series, spec.series.length)
        const opacity = seriesOpacity(view, series.name)
        return {
          name: series.name,
          value: view.categoryIndices.map(category => series.values[category] ?? Number.NaN),
          symbol: 'circle',
          symbolSize: MARK_STYLE.markerSize,
          lineStyle: { color: colors.ink, width: MARK_STYLE.lineWidth, opacity },
          areaStyle: { color: colors.fill, opacity: opacity === 1 ? radarFillAlpha(shown.length) : 0.03 },
          itemStyle: lineMarker(colors, opacity),
        }
      }),
      emphasis: { focus: 'self', lineStyle: { width: 3 } },
    }],
  }
}
