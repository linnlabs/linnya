import { describe, expect, it } from 'vitest'
import { admitMarkdownChartSpec, MARKDOWN_CHART_TYPES, serializeMarkdownChartSpec } from '@app/schemas'
import type { ChartSampleLabels } from '../definitions/chartSampleLabels'
import { buildSampleChartSpec } from './chartSampleSpecs'

const zh: ChartSampleLabels = {
  title: '示例图表',
  description: '示例数据：请编辑图表，替换为实际数据和来源说明。',
  categories: ['类别 A', '类别 B', '类别 C', '类别 D'],
  seriesA: '系列 A',
  seriesB: '系列 B',
  dimensions: ['维度 1', '维度 2', '维度 3', '维度 4', '维度 5'],
  axisX: '指标 X',
  axisY: '指标 Y',
}

const en: ChartSampleLabels = {
  title: 'Sample chart',
  description: 'Sample data: edit the chart and replace it with real data and a source note.',
  categories: ['Category A', 'Category B', 'Category C', 'Category D'],
  seriesA: 'Series A',
  seriesB: 'Series B',
  dimensions: ['Dimension 1', 'Dimension 2', 'Dimension 3', 'Dimension 4', 'Dimension 5'],
  axisX: 'Measure X',
  axisY: 'Measure Y',
}

describe('buildSampleChartSpec', () => {
  for (const [name, labels] of [['zh-CN', zh], ['en-US', en]] as const) {
    describe(name, () => {
      for (const chartType of MARKDOWN_CHART_TYPES) {
        it(`${chartType} 的示例通过严格准入且 canonical 稳定`, () => {
          const sample = buildSampleChartSpec(chartType, labels)
          const admission = admitMarkdownChartSpec(sample)
          if (!admission.ok) throw new Error(`示例被拒绝: ${JSON.stringify(admission.diagnostics)}`)

          expect(admission.spec.chartType).toBe(chartType)
          // 再次准入 canonical 文本得到同一份文本：示例不依赖任何会被改写的字段
          expect(serializeMarkdownChartSpec(admission.spec)).toBe(admission.canonicalText)
        })

        it(`${chartType} 的示例明确标注为示例数据`, () => {
          const sample = buildSampleChartSpec(chartType, labels)
          expect(sample.title).toBe(labels.title)
          expect(sample.description).toBe(labels.description)
        })
      }
    })
  }

  it('覆盖全部八种图表类型', () => {
    expect([...MARKDOWN_CHART_TYPES].sort()).toEqual(
      ['area', 'bar', 'combo', 'doughnut', 'line', 'pie', 'radar', 'scatter'],
    )
  })
})

describe('readChartSampleLabels', () => {
  it('把每个示例文案键映射到对应字段', async () => {
    const { readChartSampleLabels } = await import('./chartSampleLabels')
    const labels = readChartSampleLabels(key => `<${key}>`)

    expect(labels.title).toBe('<editor.chart.sample.title>')
    expect(labels.description).toBe('<editor.chart.sample.description>')
    expect(labels.categories).toEqual([
      '<editor.chart.sample.categoryA>',
      '<editor.chart.sample.categoryB>',
      '<editor.chart.sample.categoryC>',
      '<editor.chart.sample.categoryD>',
    ])
    expect(labels.dimensions).toHaveLength(5)
    expect(new Set([...labels.categories, ...labels.dimensions, labels.seriesA, labels.seriesB]).size).toBe(11)
  })
})
