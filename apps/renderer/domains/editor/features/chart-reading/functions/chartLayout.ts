/**
 * @file chartLayout.ts
 * @description 图表的确定性版面：绘图区高度和刻度数量只取决于规格，不读取窗口或主题。
 */

import type { MarkdownChartSpec } from '@app/schemas'

/** 三档绘图区高度（CSS px）。标题、说明和外壳留白另计，由 DOM 自然排版。 */
export const CHART_PLOT_HEIGHT = Object.freeze({ small: 240, medium: 320, large: 420 })

export function plotHeightOf(spec: Pick<MarkdownChartSpec, 'size'>): number {
  return CHART_PLOT_HEIGHT[spec.size ?? 'medium']
}

/** 数值轴目标刻度数：随绘图区高度变化，但保持克制。 */
export function targetTickCount(plotHeight: number): number {
  return Math.min(7, Math.max(4, Math.round(plotHeight / 64)))
}
