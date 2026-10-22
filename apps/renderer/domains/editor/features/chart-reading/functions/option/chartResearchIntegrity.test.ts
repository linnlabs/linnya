import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_READING_STATE } from '../../definitions/chartReadingState'
import { chartFixture, chartTestContext } from '../../testing/chartTestFixtures'
import { loadChartRuntime } from '../../orchestration/chartRuntime'
import { buildChartOption } from './buildChartOption'
import { formatChartDisplayValue, resolveAxisDomain } from '../chartNumbers'

function property(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined
}

describe('研究数据与实际呈现保持一致', () => {
  it('小份额与零份额在真实饼图中的角度符合原始比例', async () => {
    const runtime = await loadChartRuntime('pie')
    const chart = runtime.init(null, undefined, { renderer: 'svg', ssr: true, width: 640, height: 320 })
    try {
      const spec = chartFixture('pie', {
        categories: ['小份额', '主体', '零'],
        series: [{ name: '数量', values: [1, 999, 0] }],
      })
      chart.setOption(buildChartOption(spec, DEFAULT_CHART_READING_STATE, chartTestContext({ intent: 'export' })))
      chart.renderToSVGString()
      const angles = chart.getZr().storage.getDisplayList().filter(shape => shape.type === 'sector').map(shape => {
        const geometry: unknown = Reflect.get(shape, 'shape')
        const start = property(geometry, 'startAngle')
        const end = property(geometry, 'endAngle')
        if (typeof start !== 'number' || typeof end !== 'number') throw new Error('sector has no angles')
        return Math.abs(end - start)
      })
      expect(angles[0]).toBeCloseTo(Math.PI * 2 / 1000, 8)
      expect(angles[1]).toBeCloseTo(Math.PI * 2 * 999 / 1000, 8)
      expect(angles[2] ?? 0).toBe(0)
    } finally {
      chart.dispose()
    }
  })

  it('散点对象重排时，运行时数据身份跟随观测标签', () => {
    const build = (categories: number[], pointLabels: string[], values: number[]) => {
      const spec = chartFixture('scatter', { categories, pointLabels, series: [{ name: '国家', values }] })
      const option = buildChartOption(spec, DEFAULT_CHART_READING_STATE, chartTestContext())
      const series = Array.isArray(option.series) ? option.series[0] : option.series
      const data = property(series, 'data')
      if (!Array.isArray(data)) throw new Error('scatter has no data')
      return data.map((item: unknown) => property(item, 'id'))
    }
    const first = build([1, 2], ['甲国', '乙国'], [10, 20])
    const next = build([3, 4], ['乙国', '甲国'], [30, 40])
    expect(first.every(id => typeof id === 'string')).toBe(true)
    expect(next).toEqual([first[1], first[0]])
  })

  it('查值与数据表的 General 不把微小观测变成零、不截断大整数', () => {
    expect(formatChartDisplayValue(0.0000000123456789, { locale: 'en-US' })).toBe('0.0000000123456789')
    expect(formatChartDisplayValue(123456789012345, { locale: 'en-US' })).toBe('123,456,789,012,345')
  })

  it('单边轴范围位于数据之外时仍产生有效视口，保留作者指定边界', () => {
    const lower = resolveAxisDomain({ dataMin: 10, dataMax: 20, userMin: 100, includeZero: false, targetTicks: 5 })
    expect(lower.min).toBe(100)
    expect(lower.max).toBeGreaterThan(lower.min)
    const upper = resolveAxisDomain({ dataMin: 10, dataMax: 20, userMax: 0, includeZero: true, targetTicks: 5 })
    expect(upper.max).toBe(0)
    expect(upper.min).toBeLessThan(upper.max)
  })
});
