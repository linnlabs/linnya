/**
 * @file chartSampleLabels.ts
 * @description 从 Editor 文案解析器读取示例图表的文案，供示例规格构造使用。
 */

import type { EditorMessageResolver } from '../../../definitions/editorMessages'
import type { ChartSampleLabels } from '../definitions/chartSampleLabels'

export function readChartSampleLabels(editorMessage: EditorMessageResolver): ChartSampleLabels {
  return {
    title: editorMessage('editor.chart.sample.title'),
    description: editorMessage('editor.chart.sample.description'),
    categories: [
      editorMessage('editor.chart.sample.categoryA'),
      editorMessage('editor.chart.sample.categoryB'),
      editorMessage('editor.chart.sample.categoryC'),
      editorMessage('editor.chart.sample.categoryD'),
    ],
    seriesA: editorMessage('editor.chart.sample.seriesA'),
    seriesB: editorMessage('editor.chart.sample.seriesB'),
    dimensions: [
      editorMessage('editor.chart.sample.dimension1'),
      editorMessage('editor.chart.sample.dimension2'),
      editorMessage('editor.chart.sample.dimension3'),
      editorMessage('editor.chart.sample.dimension4'),
      editorMessage('editor.chart.sample.dimension5'),
    ],
    axisX: editorMessage('editor.chart.sample.axisX'),
    axisY: editorMessage('editor.chart.sample.axisY'),
  }
}
