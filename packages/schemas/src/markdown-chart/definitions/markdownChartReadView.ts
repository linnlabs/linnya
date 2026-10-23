/**
 * @file markdownChartReadView.ts
 * @description 规格的“读取视角”：把按图表类型判别的联合展平为一个所有适用字段都可选的只读形状。
 *
 * 准入阶段需要按类型严格区分字段；渲染、数据表、图例等只读消费者则只关心“这个字段有没有”。
 * 任何已准入规格都可以赋给这个形状（无需类型断言），消费者因此不必在每处用 `in` 窄化。
 */

import type { MarkdownChartPalette, MarkdownChartType } from './markdownChartConstants'
import type { MarkdownChartCategoryAxis, MarkdownChartSpec, MarkdownChartValueAxis } from './markdownChartSpec'

export interface MarkdownChartSeriesReadView {
  readonly name: string
  readonly values: readonly number[]
  readonly chartType?: 'bar' | 'line' | 'area'
  readonly axis?: 'primary' | 'secondary'
  readonly color?: string
  readonly pointColors?: readonly (string | null)[]
  readonly lineDash?: 'solid' | 'dash' | 'dot'
  readonly marker?: 'none' | 'circle' | 'square' | 'diamond' | 'triangle'
  readonly showDataLabels?: boolean
  readonly dataLabelFormat?: string
}

export interface MarkdownChartSpecReadView {
  readonly chartType: MarkdownChartType
  readonly title?: string
  readonly description?: string
  readonly size?: 'small' | 'medium' | 'large'
  readonly legendPosition?: 'top' | 'bottom' | 'left' | 'right' | 'none'
  readonly palette?: MarkdownChartPalette
  readonly categories: readonly (string | number)[]
  readonly series: readonly MarkdownChartSeriesReadView[]
  readonly barDirection?: 'vertical' | 'horizontal'
  readonly stacking?: 'none' | 'stacked' | 'percent'
  readonly colorBy?: 'series' | 'category'
  readonly categoryAxis?: Readonly<MarkdownChartCategoryAxis>
  readonly valueAxis?: Readonly<MarkdownChartValueAxis>
  readonly secondaryValueAxis?: Readonly<MarkdownChartValueAxis>
  readonly xAxis?: Readonly<MarkdownChartValueAxis>
  readonly pointLabels?: readonly string[]
  readonly radarScale?: { readonly min: 0; readonly max: number }
  readonly showDataLabels?: boolean
  readonly dataLabelFormat?: string
  readonly dataLabelContent?: 'value' | 'percentage' | 'category'
}

/** 无损地以读取视角看待一份已准入的规格。 */
export function toMarkdownChartReadView(spec: MarkdownChartSpec): MarkdownChartSpecReadView {
  return spec
}
