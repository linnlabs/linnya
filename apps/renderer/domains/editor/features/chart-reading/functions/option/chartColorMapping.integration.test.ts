import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_READING_STATE } from '../../definitions/chartReadingState'
import { chartFixture, chartTestContext, chartTestTheme } from '../../testing/chartTestFixtures'
import { loadChartRuntime } from '../../orchestration/chartRuntime'
import { buildChartLegend } from '../chartLegend'
import { setCategoryRange, toggleEmphasis, toggleSeriesVisibility, reconcileReadingState } from '../chartReadingState'
import { deriveChartReadingView } from '../chartReadingView'
import { buildChartOption } from './buildChartOption'
import { buildCartesianTooltipContent } from './cartesianOption'
import { buildShareTooltipContent } from './shareOption'

const categories = ['论文', '报告', '披露', '访谈', '统计', '专利', '新闻', '档案']
const values = [28, 21, 15, 12, 9, 7, 5, 3]

describe('顺序颜色贯穿阅读、聚焦与导出', () => {
  it('八类别柱图按原顺序着色；图例、提示框、范围聚焦、突出和导出共享同一实体色', async () => {
    const spec = chartFixture('bar', { categories, series: [{ name: '证据', values }], palette: 'mist', colorBy: 'category', barDirection: 'horizontal' })
    const theme = chartTestTheme('light', 'mist')
    const ctx = chartTestContext({ theme })
    const expected = values.map((value, index) => ({ value, itemStyle: { color: theme.palette[index]?.fill } }))
    const full = buildChartOption(spec, DEFAULT_CHART_READING_STATE, ctx)
    expect(full).toMatchObject({ series: [{ data: expected }] })
    expect(buildChartLegend(spec, DEFAULT_CHART_READING_STATE, theme).map(item => item.fill)).toEqual(theme.palette.map(entry => entry.fill))

    const focused = setCategoryRange(spec, toggleEmphasis(spec, DEFAULT_CHART_READING_STATE, '5'), { start: 4, end: 7 })
    const built = buildChartOption(spec, focused, ctx)
    expect(built).toMatchObject({ series: [{ data: expected.slice(4) }] })
    const view = deriveChartReadingView(spec, focused)
    expect(buildCartesianTooltipContent(view, ctx, 1)?.rows[0]?.key?.fill).toBe(theme.palette[5]?.fill)
    expect(built).toMatchObject({ series: [{ data: [
      { itemStyle: { opacity: 0.28 } }, { itemStyle: { opacity: 1 } },
      { itemStyle: { opacity: 0.28 } }, { itemStyle: { opacity: 0.28 } },
    ] }] })
    expect(buildChartOption(spec, focused, { ...ctx, intent: 'export' })).toMatchObject({ series: [{ data: expected }] })
    expect(reconcileReadingState(spec, chartFixture('bar'), focused)).toBe(DEFAULT_CHART_READING_STATE)

    const echarts = await loadChartRuntime('bar')
    const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 640, height: 320 })
    try {
      chart.setOption(full)
      const svg = chart.renderToSVGString().toLowerCase()
      for (const entry of theme.palette) expect(svg).toContain(entry.fill)
    } finally { chart.dispose() }
  })

  it('分组、堆叠和百分比图保持系列顺序；隐藏中间系列不把第三色挪到第二色', () => {
    const theme = chartTestTheme('light', 'pastel')
    const ctx = chartTestContext({ theme })
    for (const stacking of ['none', 'stacked', 'percent']) {
      const spec = chartFixture('bar', { categories: ['Q1', 'Q2'], series: [
        { name: '综述', values: [18, 24] }, { name: '专题', values: [12, 18] }, { name: '简报', values: [10, 14] },
      ], palette: 'pastel', stacking })
      const full = buildChartOption(spec, DEFAULT_CHART_READING_STATE, ctx)
      expect(full).toMatchObject({ series: [
        { itemStyle: { color: theme.palette[0]?.fill } },
        { itemStyle: { color: theme.palette[4]?.fill } },
        { itemStyle: { color: theme.palette[7]?.fill } },
      ] })
      const hidden = toggleSeriesVisibility(spec, DEFAULT_CHART_READING_STATE, '专题')
      expect(buildChartOption(spec, hidden, ctx)).toMatchObject({ series: [
        { name: '综述', itemStyle: { color: theme.palette[0]?.fill } },
        { name: '简报', itemStyle: { color: theme.palette[7]?.fill } },
      ] })
    }
  })

  it('饼图和环形图沿同一色带顺序，逐点覆盖也同步到提示框与图例', () => {
    const theme = chartTestTheme('light', 'mist')
    const ctx = chartTestContext({ theme })
    for (const type of ['pie', 'doughnut'] as const) {
      const spec = chartFixture(type, { categories, series: [{ name: '来源', values, pointColors: [null, null, '#ABCDEF', null, null, null, null, null] }], palette: 'mist' })
      const fills = theme.palette.map((entry, index) => index === 2 ? '#ABCDEF' : entry.fill)
      expect(buildChartOption(spec, DEFAULT_CHART_READING_STATE, ctx)).toMatchObject({ series: [{ data: values.map((value, index) => ({ value, itemStyle: { color: fills[index] } })) }] })
      expect(buildChartLegend(spec, DEFAULT_CHART_READING_STATE, theme).map(item => item.fill)).toEqual(fills)
      const view = deriveChartReadingView(spec, DEFAULT_CHART_READING_STATE)
      expect(buildShareTooltipContent(view, ctx, 2)?.rows[0]?.key?.fill).toBe('#ABCDEF')
    }
  })
})
