import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_READING_STATE } from '../definitions/chartReadingState'
import { chartFixture, chartTestTheme } from '../testing/chartTestFixtures'
import { buildChartLegend, resolveLegendPosition, usesEndLabels } from './chartLegend'
import { toggleEmphasis, toggleSeriesVisibility } from './chartReadingState'
import { canTransitionBetween } from './chartTransition'
import { buildChartDataTable, chartDataTableToTsv } from './chartDataTable'

describe('图例', () => {
  it('单系列无图例，多系列柱在底部，饼/环按类目；显式位置优先', () => {
    expect(resolveLegendPosition(chartFixture('bar'))).toBe('none')
    expect(resolveLegendPosition(chartFixture('bar', { series: [{ name: 'a', values: [1, 2, 3, 4, 5] }, { name: 'b', values: [2, 3, 4, 5, 6] }] }))).toBe('bottom')
    expect(resolveLegendPosition(chartFixture('pie'))).toBe('bottom')
    expect(resolveLegendPosition(chartFixture('line', { legendPosition: 'right' }))).toBe('right')
    expect(resolveLegendPosition(chartFixture('line', { legendPosition: 'none' }))).toBe('none')
  })

  it('折线/面积不超过 5 个系列时用行末直标，不再放图例；超过 5 个、显式指定位置或不是折线/面积时回到图例', () => {
    expect(usesEndLabels(chartFixture('line'))).toBe(true)
    expect(usesEndLabels(chartFixture('area'))).toBe(true)
    expect(resolveLegendPosition(chartFixture('line'))).toBe('none')

    const crowded = chartFixture('line', { series: Array.from({ length: 6 }, (_, index) => ({ name: `系列${index + 1}`, values: [1, 2, 3, 4] })) })
    expect(usesEndLabels(crowded)).toBe(false)
    expect(resolveLegendPosition(crowded)).toBe('bottom')
    expect(usesEndLabels(chartFixture('line', { legendPosition: 'bottom' }))).toBe(false)
    expect(resolveLegendPosition(chartFixture('line', { legendPosition: 'bottom' }))).toBe('bottom')
    expect(usesEndLabels(chartFixture('bar'))).toBe(false)
    expect(usesEndLabels(chartFixture('combo'))).toBe(false)
  })

  it('条目随阅读状态标记隐藏/突出；颜色按完整规格中的序号，与是否隐藏无关', () => {
    const spec = chartFixture('line')
    const theme = chartTestTheme()
    let state = toggleSeriesVisibility(spec, DEFAULT_CHART_READING_STATE, '营收')
    state = toggleEmphasis(spec, state, '成本')
    const items = buildChartLegend(spec, state, theme)
    expect(items.map(item => [item.label, item.hidden, item.emphasized, item.fill, item.ink])).toEqual([
      ['营收', true, false, theme.palette[0]?.fill, theme.palette[0]?.ink],
      ['成本', false, true, theme.palette[1]?.fill, theme.palette[1]?.ink],
    ])
  })

  it('图例颜色跟随规格选择的色系', () => {
    const warm = chartTestTheme('light', 'warm')
    const items = buildChartLegend(chartFixture('line', { palette: 'warm' }), DEFAULT_CHART_READING_STATE, warm)
    expect(items.map(item => item.fill)).toEqual([warm.palette[0]?.fill, warm.palette[1]?.fill])
    expect(items[0]?.fill).not.toBe(buildChartLegend(chartFixture('line'), DEFAULT_CHART_READING_STATE, chartTestTheme())[0]?.fill)
  })

  it('作者显式给的系列色作为图例填充，描线由它派生', () => {
    const spec = chartFixture('line', { series: [{ name: '营收', values: [1, 2, 3, 4], color: '#336699' }, { name: '成本', values: [1, 2, 3, 4] }] })
    const items = buildChartLegend(spec, DEFAULT_CHART_READING_STATE, chartTestTheme())
    expect(items[0]?.fill).toBe('#336699')
    expect(items[0]?.ink).not.toBe('#336699')
    expect(items[1]?.fill).toBe(chartTestTheme().palette[1]?.fill)
  })

  it('饼/环的条目是类目，只能突出，不能隐藏', () => {
    const items = buildChartLegend(chartFixture('pie'), toggleEmphasis(chartFixture('pie'), DEFAULT_CHART_READING_STATE, '2'), chartTestTheme())
    expect(items.map(item => item.label)).toEqual(['订阅', '广告', '增值服务', '其他'])
    expect(items.every(item => !item.filterable)).toBe(true)
    expect(items[2]?.emphasized).toBe(true)
  })

  it('组合图的图例键形状反映系列类型，次轴系列带标记', () => {
    const items = buildChartLegend(chartFixture('combo'), DEFAULT_CHART_READING_STATE, chartTestTheme())
    expect(items.map(item => [item.shape, item.secondaryAxis])).toEqual([['bar', false], ['line', true]])
  })
})

describe('过渡的身份条件', () => {
  const line = chartFixture('line')

  it('同类型、类目与系列可确认对应 → 可过渡', () => {
    expect(canTransitionBetween(line, chartFixture('line', { series: [{ name: '营收', values: [130, 140, 90, 150] }, { name: '成本', values: [80, 90, 85, 95], lineDash: 'dash' }] }))).toBe(true)
  })

  it('首次渲染、类型变化、系列全部重命名 → 不过渡', () => {
    expect(canTransitionBetween(null, line)).toBe(false)
    expect(canTransitionBetween(line, chartFixture('line', {
      chartType: 'bar',
      series: [{ name: '营收', values: [120, 132, 101, 134] }, { name: '成本', values: [80, 90, 85, 95] }],
    }))).toBe(false)
    expect(canTransitionBetween(line, chartFixture('line', { series: [{ name: '新系列', values: [1, 2, 3, 4] }] }))).toBe(false)
  })

  it('重复类目无法确认对应 → 不过渡，但图仍可合法绘制', () => {
    const duplicated = chartFixture('line', { categories: ['A', 'A', 'B', 'C'] })
    expect(canTransitionBetween(line, duplicated)).toBe(false)
    expect(canTransitionBetween(duplicated, duplicated)).toBe(false)
  })

  it('堆叠方式改变或组合图系列换了绘制类型/坐标轴 → 不过渡', () => {
    const bar = chartFixture('bar', { categories: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] })
    expect(canTransitionBetween(bar, chartFixture('bar', { categories: ['a', 'b'], series: [{ name: 's', values: [1, 2] }], stacking: 'stacked' }))).toBe(false)

    const combo = chartFixture('combo')
    const retyped = chartFixture('combo', {
      series: [
        { name: '营收', values: [120, 132, 101, 134], chartType: 'line' },
        { name: '利润率', values: [0.27, 0.31, 0.25, 0.29], chartType: 'line', axis: 'secondary' },
      ],
    })
    expect(canTransitionBetween(combo, retyped)).toBe(false)
  })

  it('散点：有唯一对象标签按标签对应；无标签只在 X 不变且唯一时对应', () => {
    const scatter = chartFixture('scatter')
    expect(canTransitionBetween(scatter, chartFixture('scatter', { series: [{ name: '样本企业', values: [4, 6, 22, 26, 41] }] }))).toBe(true)

    const unlabeled = { pointLabels: undefined }
    const base = chartFixture('scatter', unlabeled)
    expect(canTransitionBetween(base, chartFixture('scatter', { ...unlabeled, series: [{ name: '样本企业', values: [4, 6, 22, 26, 41] }] }))).toBe(true)
    expect(canTransitionBetween(base, chartFixture('scatter', { ...unlabeled, categories: [1, 2, 10, 14, 22], series: [{ name: '样本企业', values: [4, 6, 22, 26, 41] }] }))).toBe(false)
    expect(canTransitionBetween(base, chartFixture('scatter', { ...unlabeled, categories: [1, 1, 10, 14, 21] }))).toBe(false)
  })
})

describe('数据表', () => {
  const labels = { category: '类目', series: '系列', value: '数值', share: '占比', dimension: '维度', pointLabel: '对象' }

  it('类目 × 系列，数值按作者格式', () => {
    const table = buildChartDataTable(chartFixture('combo'), labels, 'zh-CN')
    expect(table.header).toEqual(['类目', '营收', '利润率'])
    expect(table.rows[1]).toEqual(['Q2', '132', '31%'])
  })

  it('饼/环附带占比；散点逐点列出对象、X、Y；雷达按维度', () => {
    expect(buildChartDataTable(chartFixture('pie'), labels, 'zh-CN').rows[0]).toEqual(['订阅', '58', '58.0%'])
    const scatter = buildChartDataTable(chartFixture('scatter'), labels, 'zh-CN')
    expect(scatter.header).toEqual(['对象', '系列', '研发投入', '专利数（件）'])
    expect(scatter.rows[2]).toEqual(['丙', '样本企业', '10亿元', '21'])
    expect(buildChartDataTable(chartFixture('radar'), labels, 'zh-CN').rows[0]).toEqual(['性能', '82', '65'])
  })

  it('数据表永远完整：不随任何阅读状态删行；TSV 保持行列结构', () => {
    const table = buildChartDataTable(chartFixture('line'), labels, 'zh-CN')
    expect(table.rows).toHaveLength(4)
    expect(chartDataTableToTsv({ header: ['a\tb', 'c'], rows: [['1\n2', '3']] })).toBe('a b\tc\n1 2\t3')
  })
})
