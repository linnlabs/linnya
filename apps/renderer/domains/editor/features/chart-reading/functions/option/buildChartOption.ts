/**
 * @file buildChartOption.ts
 * @description 规格 + 阅读状态 + 渲染上下文 → ECharts option 的唯一入口。
 *
 * 纯函数：同一输入总得到同一 option。默认视图导出（intent: 'export'）无条件忽略阅读状态，
 * 因此复制出的图片不受读者此前的任何筛选或聚焦影响。
 */

import type { MarkdownChartSpecReadView } from '@app/schemas'
import { DEFAULT_CHART_READING_STATE, type ChartReadingState } from '../../definitions/chartReadingState'
import type { ChartOption } from '../../definitions/chartOption'
import type { ChartRenderContext } from '../../definitions/chartRender'
import { computeChartDomains } from '../chartDomains'
import { deriveChartReadingView, type ChartReadingView } from '../chartReadingView'
import { buildCartesianOption } from './cartesianOption'
import { buildRadarOption } from './radarOption'
import { buildScatterOption } from './scatterOption'
import { buildShareOption } from './shareOption'

export function deriveViewForContext(
  spec: MarkdownChartSpecReadView,
  readingState: ChartReadingState,
  ctx: Pick<ChartRenderContext, 'intent'>,
): ChartReadingView {
  return deriveChartReadingView(spec, ctx.intent === 'export' ? DEFAULT_CHART_READING_STATE : readingState)
}

export function buildChartOption(
  spec: MarkdownChartSpecReadView,
  readingState: ChartReadingState,
  ctx: ChartRenderContext,
): ChartOption {
  const view = deriveViewForContext(spec, readingState, ctx)
  const domains = computeChartDomains(view.spec, view.state)
  switch (spec.chartType) {
    case 'bar':
    case 'line':
    case 'area':
    case 'combo':
      return buildCartesianOption(view, domains, ctx)
    case 'pie':
    case 'doughnut':
      return buildShareOption(view, ctx)
    case 'scatter':
      return buildScatterOption(view, domains, ctx)
    case 'radar':
      return buildRadarOption(view, ctx)
  }
}
