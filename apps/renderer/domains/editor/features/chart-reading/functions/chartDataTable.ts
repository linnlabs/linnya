/**
 * @file chartDataTable.ts
 * @description 数据表模型：每张图的无障碍等价物，也是低对比度色板的补偿通道。
 *
 * 数据表永远展示完整规格（不随筛选删行），数值按作者格式展示；`copyText` 为制表符分隔文本，
 * 可直接粘贴进电子表格。
 */

import type { MarkdownChartSpecReadView as ChartSpec } from '@app/schemas'
import { formatChartDisplayValue } from './chartNumbers'

export interface ChartDataTableModel {
  readonly header: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

export interface ChartDataTableLabels {
  readonly category: string
  readonly series: string
  readonly value: string
  readonly share: string
  readonly dimension: string
  readonly pointLabel: string
}

export function buildChartDataTable(spec: ChartSpec, labels: ChartDataTableLabels, locale: string): ChartDataTableModel {
  const format = (value: number, numberFormat: string | undefined) =>
    formatChartDisplayValue(value, { ...(numberFormat ? { numberFormat } : {}), locale })

  switch (spec.chartType) {
    case 'pie':
    case 'doughnut': {
      const series = spec.series[0]
      const total = (series?.values ?? []).reduce((sum, value) => sum + value, 0)
      const numberFormat = series?.dataLabelFormat ?? spec.dataLabelFormat
      return {
        header: [labels.category, series?.name ?? labels.value, labels.share],
        rows: spec.categories.map((category, index) => {
          const value = series?.values[index] ?? Number.NaN
          return [String(category), format(value, numberFormat), total > 0 ? format(value / total, '0.0%') : '—']
        }),
      }
    }
    case 'scatter': {
      const hasLabels = spec.pointLabels !== undefined
      return {
        header: [...(hasLabels ? [labels.pointLabel] : []), labels.series, spec.xAxis?.title ?? 'X', spec.valueAxis?.title ?? 'Y'],
        rows: spec.series.flatMap(series => spec.categories.map((x, index) => [
          ...(hasLabels ? [spec.pointLabels?.[index] ?? ''] : []),
          series.name,
          format(typeof x === 'number' ? x : Number.NaN, spec.xAxis?.numberFormat),
          format(series.values[index] ?? Number.NaN, spec.valueAxis?.numberFormat),
        ])),
      }
    }
    case 'radar':
      return {
        header: [labels.dimension, ...spec.series.map(series => series.name)],
        rows: spec.categories.map((category, index) => [
          String(category),
          ...spec.series.map(series => format(series.values[index] ?? Number.NaN, undefined)),
        ]),
      }
    default:
      return {
        header: [labels.category, ...spec.series.map(series => series.name)],
        rows: spec.categories.map((category, index) => [
          String(category),
          ...spec.series.map(series => format(
            series.values[index] ?? Number.NaN,
            series.dataLabelFormat
              ?? (series.axis === 'secondary' ? spec.secondaryValueAxis?.numberFormat : spec.valueAxis?.numberFormat),
          )),
        ]),
      }
  }
}

/** 制表符分隔文本：首行为表头。单元格内的制表符与换行被压成空格，保证行列结构稳定。 */
export function chartDataTableToTsv(table: ChartDataTableModel): string {
  const clean = (cell: string) => cell.replace(/[\t\r\n]+/g, ' ')
  return [table.header, ...table.rows].map(row => row.map(clean).join('\t')).join('\n')
}
