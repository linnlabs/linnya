import { describe, expect, it } from 'vitest'
import { admitMarkdownChartSpec, type MarkdownChartSpec } from '@app/schemas'
import { DEFAULT_CHART_READING_STATE } from '../definitions/chartReadingState'
import { computeChartDomains } from './chartDomains'
import { toggleSeriesVisibility } from './chartReadingState'

function admit(input: Record<string, unknown>): MarkdownChartSpec {
  const result = admitMarkdownChartSpec(input)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.spec
}

describe('数值轴域', () => {
  it('柱：包含零；堆叠使用正负累计；百分比堆叠固定 0–1', () => {
    const grouped = admit({ chartType: 'bar', categories: ['a', 'b'], series: [{ name: 's', values: [12, 47] }] })
    expect(computeChartDomains(grouped, DEFAULT_CHART_READING_STATE).value).toMatchObject({ min: 0, max: 50 })

    const stacked = admit({
      chartType: 'bar', stacking: 'stacked', categories: ['a', 'b'],
      series: [{ name: 'p', values: [30, 10] }, { name: 'q', values: [25, -15] }],
    })
    expect(computeChartDomains(stacked, DEFAULT_CHART_READING_STATE).value).toMatchObject({ min: -20, max: 60 })

    const percent = admit({
      chartType: 'bar', stacking: 'percent', categories: ['a'],
      series: [{ name: 'p', values: [1] }, { name: 'q', values: [3] }],
    })
    expect(computeChartDomains(percent, DEFAULT_CHART_READING_STATE).value).toEqual({ min: 0, max: 1, interval: 0.25 })
  })

  it('折线贴合数据，面积含零；作者范围优先', () => {
    const base = { categories: ['a', 'b'], series: [{ name: 's', values: [101, 134] }] }
    expect(computeChartDomains(admit({ chartType: 'line', ...base }), DEFAULT_CHART_READING_STATE).value)
      .toMatchObject({ min: 100, max: 140 })
    expect(computeChartDomains(admit({ chartType: 'area', ...base }), DEFAULT_CHART_READING_STATE).value)
      .toMatchObject({ min: 0, max: 150, interval: 50 })
    expect(computeChartDomains(admit({ chartType: 'line', ...base, valueAxis: { min: 0, max: 200 } }), DEFAULT_CHART_READING_STATE).value)
      .toMatchObject({ min: 0, max: 200 })
  })

  it('隐藏系列不改变轴域：筛选不会因重新拟合而放大剩余系列的差异', () => {
    const spec = admit({
      chartType: 'line', categories: ['a', 'b'],
      series: [{ name: '小', values: [1, 2] }, { name: '大', values: [800, 900] }],
    })
    const hidden = toggleSeriesVisibility(spec, DEFAULT_CHART_READING_STATE, '大')
    expect(computeChartDomains(spec, hidden)).toEqual(computeChartDomains(spec, DEFAULT_CHART_READING_STATE))
  })

  it('组合：主次轴分别按各自承载的系列计算，次轴含柱时同样含零', () => {
    const spec = admit({
      chartType: 'combo', categories: ['a', 'b'],
      series: [
        { name: '营收', values: [120, 132], chartType: 'bar' },
        { name: '利润率', values: [0.27, 0.31], chartType: 'line', axis: 'secondary' },
      ],
      secondaryValueAxis: { numberFormat: '0%' },
    })
    const domains = computeChartDomains(spec, DEFAULT_CHART_READING_STATE)
    expect(domains.value).toMatchObject({ min: 0, max: 150 })
    // 次轴承载的是折线：贴合自己的数据，而不是被主轴的柱基线拉伸；
    // 刻度间隔数与主轴一致（均为 3），主轴网格线与次轴刻度对齐。
    expect(domains.secondary).toEqual({ min: 0.26, max: 0.32, interval: 0.02 })
  })

  it('散点：X/Y 真实数值域，聚焦范围只改变视口', () => {
    const spec = admit({ chartType: 'scatter', categories: [1, 2, 10], series: [{ name: 'S', values: [3, 5, 21] }] })
    const full = computeChartDomains(spec, DEFAULT_CHART_READING_STATE)
    expect(full.x?.min).toBeLessThanOrEqual(1)
    expect(full.x?.max).toBeGreaterThanOrEqual(10)
    const focused = computeChartDomains(spec, { ...DEFAULT_CHART_READING_STATE, xRange: { min: 1, max: 3 } })
    expect(focused.x).toMatchObject({ min: 1, max: 3 })
    expect(focused.value).toEqual(full.value)
  })

  it('饼/环/雷达没有笛卡尔轴域', () => {
    expect(computeChartDomains(admit({ chartType: 'pie', categories: ['a'], series: [{ name: 's', values: [1] }] }), DEFAULT_CHART_READING_STATE)).toEqual({})
  })
})
