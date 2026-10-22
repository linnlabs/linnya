/**
 * @file chartSampleLabels.ts
 * @description 示例图表用到的文案。规则层只接收这些已解析的字符串，不依赖本地化机制。
 */

export interface ChartSampleLabels {
  readonly title: string
  readonly description: string
  readonly categories: readonly [string, string, string, string]
  readonly seriesA: string
  readonly seriesB: string
  readonly dimensions: readonly [string, string, string, string, string]
  readonly axisX: string
  readonly axisY: string
}
