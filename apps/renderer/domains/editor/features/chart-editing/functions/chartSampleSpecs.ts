/**
 * @file chartSampleSpecs.ts
 * @description 八类图表的示例规格：插入图表时的起点。
 *
 * 示例数据永远是“明确标注为示例”的合法规格：标题与说明都写明这是示例，
 * 通过准入后才会进入文档，读者与作者都不会把它当成真实数据。
 */

import type { MarkdownChartSpec, MarkdownChartType } from '@app/schemas'
import type { ChartSampleLabels } from '../definitions/chartSampleLabels'

export function buildSampleChartSpec(chartType: MarkdownChartType, labels: ChartSampleLabels): MarkdownChartSpec {
  const common = { title: labels.title, description: labels.description }
  const categories = [...labels.categories]

  switch (chartType) {
    case 'bar':
      return {
        ...common,
        chartType,
        categories,
        series: [
          { name: labels.seriesA, values: [32, 48, 41, 56] },
          { name: labels.seriesB, values: [24, 36, 30, 44] },
        ],
      }
    case 'line':
      return {
        ...common,
        chartType,
        categories,
        series: [
          { name: labels.seriesA, values: [12, 18, 15, 24] },
          { name: labels.seriesB, values: [9, 13, 17, 20] },
        ],
      }
    case 'area':
      return {
        ...common,
        chartType,
        categories,
        series: [
          { name: labels.seriesA, values: [20, 34, 29, 46] },
          { name: labels.seriesB, values: [12, 21, 25, 32] },
        ],
      }
    case 'pie':
    case 'doughnut':
      return {
        ...common,
        chartType,
        categories,
        series: [{ name: labels.seriesA, values: [40, 30, 20, 10] }],
        dataLabelContent: 'percentage',
      }
    case 'scatter':
      return {
        ...common,
        chartType,
        categories: [1, 2, 3, 4, 5, 6],
        series: [{ name: labels.seriesA, values: [2.1, 3.4, 3.9, 5.2, 5.8, 7.1] }],
        xAxis: { title: labels.axisX },
        valueAxis: { title: labels.axisY },
      }
    case 'radar':
      return {
        ...common,
        chartType,
        categories: [...labels.dimensions],
        series: [
          { name: labels.seriesA, values: [70, 55, 80, 60, 75] },
          { name: labels.seriesB, values: [50, 75, 60, 85, 55] },
        ],
        radarScale: { min: 0, max: 100 },
      }
    case 'combo':
      return {
        ...common,
        chartType,
        categories,
        series: [
          { name: labels.seriesA, chartType: 'bar', values: [32, 48, 41, 56] },
          { name: labels.seriesB, chartType: 'line', axis: 'secondary', values: [12, 18, 15, 24] },
        ],
        valueAxis: { title: labels.axisX },
        secondaryValueAxis: { title: labels.axisY },
      }
  }
}
