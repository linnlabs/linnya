import { describe, expect, it, vi } from 'vitest'
import { MARKDOWN_CHART_TYPES } from '@app/schemas'
import { DEFAULT_CHART_READING_STATE } from '../../definitions/chartReadingState'
import { chartFixture, chartTestContext, chartTestTheme } from '../../testing/chartTestFixtures'
import { loadChartRuntime } from '../../orchestration/chartRuntime'
import { toggleEmphasis, toggleSeriesVisibility, setCategoryRange } from '../chartReadingState'
import { buildChartOption } from './buildChartOption'
import { buildCartesianTooltipContent, shownCartesianSeries } from './cartesianOption'
import { buildShareTooltipContent } from './shareOption'
import { buildScatterTooltipContent } from './scatterOption'
import { buildRadarTooltipContent } from './radarOption'
import { deriveChartReadingView } from '../chartReadingView'

function option(type: Parameters<typeof chartFixture>[0], patch: Record<string, unknown> = {}, state = DEFAULT_CHART_READING_STATE, ctx = chartTestContext()) {
  return buildChartOption(chartFixture(type, patch), state, ctx)
}

describe('option 是合法的 ECharts 配置：八类 × 亮/暗 × 默认/导出', () => {
  it.each(MARKDOWN_CHART_TYPES.flatMap(type => (['light', 'dark'] as const).flatMap(scheme =>
    (['reading', 'export'] as const).map(intent => [type, scheme, intent] as const))))(
    '%s / %s / %s 能被真实运行时渲染为 SVG，且 ECharts 没有任何告警输出',
    async (type, scheme, intent) => {
      // ECharts 通过 console 报告无效/已弃用的配置：任何输出都视为 option 不合法。
      const spies = (['log', 'info', 'warn', 'error'] as const).map(method => vi.spyOn(console, method).mockImplementation(() => undefined))
      try {
        const echarts = await loadChartRuntime(type)
        const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 640, height: 320 })
        chart.setOption(option(type, {}, DEFAULT_CHART_READING_STATE, chartTestContext({ theme: chartTestTheme(scheme), intent })))
        const svg = chart.renderToSVGString()
        chart.dispose()

        expect(svg.startsWith('<svg')).toBe(true)
        expect(svg.length).toBeGreaterThan(800)
        for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      } finally {
        spies.forEach(spy => spy.mockRestore())
      }
    },
  )

  it('SVG 中包含类目文字与作者格式化后的刻度（真实运行时）', async () => {
    const echarts = await loadChartRuntime('combo')
    const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 640, height: 320 })
    chart.setOption(option('combo'))
    const svg = chart.renderToSVGString()
    chart.dispose()
    for (const text of ['Q1', 'Q4', '24%', '32%', '万元', '利润率']) expect(svg, text).toContain(text)
  })
})

describe('浏览器里的主题 token 是 rgb()，不是十六进制', () => {
  // 真实应用中 token 经 canvas 解析成 rgb()/rgba()；helper 只认十六进制时，
  // 柱状图悬停的指示带会被画成不透明色块（只有真实浏览器能看到，SSR 的后备主题是十六进制）。
  const browserTheme = {
    ...chartTestTheme('light'),
    surface: 'rgb(255, 255, 255)',
    textPrimary: 'rgb(23, 23, 23)',
    textSecondary: 'rgb(73, 73, 73)',
    textMuted: 'rgb(115, 115, 115)',
    grid: 'rgb(229, 229, 229)',
    axisLine: 'rgb(212, 212, 212)',
    tooltipBackground: 'rgb(255, 255, 255)',
    tooltipBorder: 'rgb(212, 212, 212)',
  }

  it('柱状图悬停指示带是 5% 的淡色，不是不透明的色块', () => {
    const built = option('bar', {}, DEFAULT_CHART_READING_STATE, chartTestContext({ theme: browserTheme }))
    const pointer = (built.tooltip as { axisPointer: { type: string; shadowStyle?: { color: string } } }).axisPointer

    expect(pointer.type).toBe('shadow')
    expect(pointer.shadowStyle?.color).toBe('rgba(23, 23, 23, 0.05)')
  })

  it('堆叠柱内的数值标签按填充明度选择文字色（rgb() 表面色下仍然成立）', () => {
    const built = option('bar', { stacking: 'stacked', showDataLabels: true, series: [{ name: 'A', values: [1, 2, 3, 4, 5] }, { name: 'B', values: [2, 2, 2, 2, 2] }] }, DEFAULT_CHART_READING_STATE, chartTestContext({ theme: browserTheme }))
    const labels = (built.series as { label: { color: string } }[]).map(series => series.label.color)

    expect(labels.every(color => color === '#0b0b0b' || color === '#ffffff')).toBe(true)
  })
})

describe('柱/条', () => {
  it('横向条形：类目轴自上而下按作者顺序，数值轴在底部；数据端圆角朝右', () => {
    const built = option('bar', { barDirection: 'horizontal' })
    const category = built.yAxis as { type: string; inverse: boolean; data: string[] }
    expect(category).toMatchObject({ type: 'category', inverse: true })
    expect(category.data).toEqual(['北京', '上海', '广州', '深圳', '杭州'])
    expect((built.xAxis as { position: string }[])[0]).toMatchObject({ type: 'value', position: 'bottom' })
    const series = (built.series as { data: { itemStyle: { borderRadius: number[] } }[] }[])[0]
    expect(series?.data[0]?.itemStyle.borderRadius).toEqual([0, 4, 4, 0])
  })

  it('柱厚度有上限；单系列且类目不多时显示数值标签，类目多则克制', () => {
    const built = option('bar')
    const series = (built.series as { barMaxWidth: number; label: { show: boolean } }[])[0]
    expect(series?.barMaxWidth).toBe(24)
    expect(series?.label.show).toBe(true)

    const crowded = option('bar', {
      categories: Array.from({ length: 16 }, (_, index) => `C${index}`),
      series: [{ name: '销量', values: Array.from({ length: 16 }, (_, index) => index + 1) }],
    })
    expect((crowded.series as { label: { show: boolean } }[])[0]?.label.show).toBe(false)

    const forced = option('bar', {
      categories: Array.from({ length: 16 }, (_, index) => `C${index}`),
      series: [{ name: '销量', values: Array.from({ length: 16 }, (_, index) => index + 1) }],
      showDataLabels: true,
    })
    expect((forced.series as { label: { show: boolean } }[])[0]?.label.show).toBe(true)
  })

  it('负值的数据端圆角朝下', () => {
    const built = option('bar', { series: [{ name: '净额', values: [3, -2, 5, -1, 4] }], valueAxis: { title: '万辆' } })
    const data = (built.series as { data: { itemStyle: { borderRadius: number[] } }[] }[])[0]?.data
    expect(data?.[0]?.itemStyle.borderRadius).toEqual([4, 4, 0, 0])
    expect(data?.[1]?.itemStyle.borderRadius).toEqual([0, 0, 4, 4])
  })

  it('堆叠：只有可见堆叠顶端取圆角，段间是 2px 表面色间隔而非描边', () => {
    const spec = {
      stacking: 'stacked',
      categories: ['A', 'B'],
      series: [{ name: '一', values: [3, 4] }, { name: '二', values: [2, 1] }],
    }
    const built = option('bar', spec)
    const series = built.series as { stack: string; itemStyle: { borderColor: string; borderWidth: number }; data: { itemStyle: { borderRadius: number | number[] } }[] }[]
    expect(series.map(item => item.stack)).toEqual(['total', 'total'])
    expect(series[0]?.itemStyle).toMatchObject({ borderColor: '#ffffff', borderWidth: 2 })
    expect(series[0]?.data[0]?.itemStyle.borderRadius).toBe(0)
    expect(series[1]?.data[0]?.itemStyle.borderRadius).toEqual([4, 4, 0, 0])

    // 隐藏顶端系列后，圆角移到新的可见顶端。
    const hidden = toggleSeriesVisibility(chartFixture('bar', spec), DEFAULT_CHART_READING_STATE, '二')
    const afterHide = option('bar', spec, hidden).series as typeof series
    expect(afterHide).toHaveLength(1)
    expect(afterHide[0]?.data[0]?.itemStyle.borderRadius).toEqual([4, 4, 0, 0])
  })

  it('百分比堆叠：绘制值按完整类目合计归一；隐藏系列后剩余份额不补足到 100%，tooltip 保留原值', () => {
    const spec = {
      stacking: 'percent',
      categories: ['A', 'B'],
      series: [{ name: '一', values: [1, 2] }, { name: '二', values: [3, 2] }],
    }
    const full = option('bar', spec)
    const plotted = (full.series as { data: { value: number }[] }[]).map(item => item.data.map(point => point.value))
    expect(plotted).toEqual([[0.25, 0.5], [0.75, 0.5]])

    const hidden = toggleSeriesVisibility(chartFixture('bar', spec), DEFAULT_CHART_READING_STATE, '二')
    const afterHide = option('bar', spec, hidden)
    expect((afterHide.series as { data: { value: number }[] }[]).map(item => item.data.map(point => point.value))).toEqual([[0.25, 0.5]])

    const view = deriveChartReadingView(chartFixture('bar', spec), hidden)
    const tooltip = buildCartesianTooltipContent(view, chartTestContext(), 0)
    expect(tooltip?.rows).toEqual([expect.objectContaining({ label: '一', value: '1.0', detail: '占整体 25%' })])
  })

  it('类目聚焦只切片类目，不改变数值轴域', () => {
    const spec = chartFixture('bar')
    const focused = setCategoryRange(spec, DEFAULT_CHART_READING_STATE, { start: 1, end: 2 })
    const full = option('bar')
    const zoomed = option('bar', {}, focused)
    expect((zoomed.xAxis as { data: string[] }).data).toEqual(['上海', '广州'])
    expect((zoomed.yAxis as { min: number; max: number }[])[0]).toMatchObject(
      { min: (full.yAxis as { min: number }[])[0]?.min, max: (full.yAxis as { max: number }[])[0]?.max },
    )
  })

  it('颜色随实体：隐藏第一个系列后，第二个系列仍使用色板第二色', () => {
    const spec = { stacking: 'stacked', categories: ['A'], series: [{ name: '一', values: [1] }, { name: '二', values: [2] }] }
    const hidden = toggleSeriesVisibility(chartFixture('bar', spec), DEFAULT_CHART_READING_STATE, '一')
    const series = option('bar', spec, hidden).series as { itemStyle: { color: string } }[]
    expect(series).toHaveLength(1)
    expect(series[0]?.itemStyle.color).toBe(chartTestTheme('light').palette[1])
  })

  it('持久突出：未被突出的系列变淡', () => {
    const spec = chartFixture('line')
    const state = toggleEmphasis(spec, DEFAULT_CHART_READING_STATE, '营收')
    const series = buildChartOption(spec, state, chartTestContext()).series as { name: string; lineStyle: { opacity: number } }[]
    expect(series.find(item => item.name === '营收')?.lineStyle.opacity).toBe(1)
    expect(series.find(item => item.name === '成本')?.lineStyle.opacity).toBeLessThan(0.5)
  })
})

describe('折线与面积', () => {
  it('折线 2px、不平滑、保留观测点标记并带表面色环', () => {
    const series = (option('line').series as {
      type: string; smooth: boolean; showSymbol: boolean; symbolSize: number
      lineStyle: { width: number; cap: string; type: string }; itemStyle: { borderColor: string; borderWidth: number }
    }[])
    expect(series[0]).toMatchObject({ type: 'line', smooth: false, showSymbol: true, symbolSize: 8 })
    expect(series[0]?.lineStyle).toMatchObject({ width: 2, cap: 'round', type: 'solid' })
    expect(series[0]?.itemStyle).toMatchObject({ borderColor: '#ffffff', borderWidth: 2 })
    expect(series[1]?.lineStyle.type).toBe('dashed')
  })

  it('观测点很多时不画常驻标记；marker: none 关闭标记', () => {
    const many = option('line', {
      categories: Array.from({ length: 40 }, (_, index) => `${index}`),
      series: [{ name: 'S', values: Array.from({ length: 40 }, (_, index) => index) }],
    })
    expect((many.series as { showSymbol: boolean }[])[0]?.showSymbol).toBe(false)
    const none = option('line', { series: [{ name: 'S', values: [1, 2, 3, 4], marker: 'none' }] })
    expect((none.series as { showSymbol: boolean }[])[0]?.showSymbol).toBe(false)
  })

  it('面积只是 10% 的淡色铺底，类目轴贴边', () => {
    const built = option('area')
    expect((built.series as { areaStyle: { opacity: number } }[])[0]?.areaStyle.opacity).toBe(0.1)
    expect((built.xAxis as { boundaryGap: boolean }).boundaryGap).toBe(false)
  })

  it('折线默认只标注终点，不在每个点上放数字', () => {
    const data = (option('line').series as { data: unknown[] }[])[0]?.data
    expect(data?.slice(0, -1)).toEqual(expect.arrayContaining([expect.objectContaining({ label: { show: false } })]))
    expect(data?.[data.length - 1]).toMatchObject({ label: { show: true } })
  })
})

describe('组合', () => {
  it('双数值轴各自标注单位；次轴在右侧且无网格线；次轴系列带“右轴”标注', () => {
    const built = option('combo')
    const axes = built.yAxis as { name: string; position: string; splitLine: { show: boolean }; min: number; max: number }[]
    expect(axes).toHaveLength(2)
    expect(axes[0]).toMatchObject({ name: '万元', position: 'left', splitLine: { show: true } })
    expect(axes[1]).toMatchObject({ name: '利润率', position: 'right', splitLine: { show: false } })
    expect(axes[0]?.min).toBe(0)

    const series = built.series as { type: string; yAxisIndex: number }[]
    expect(series.map(item => [item.type, item.yAxisIndex])).toEqual([['bar', 0], ['line', 1]])

    const view = deriveChartReadingView(chartFixture('combo'), DEFAULT_CHART_READING_STATE)
    const rows = buildCartesianTooltipContent(view, chartTestContext(), 1)?.rows
    expect(rows?.map(row => [row.label, row.value])).toEqual([['营收', '132'], ['利润率 · 右轴', '31%']])
  })
})

describe('饼与环', () => {
  it('扇区间 2px 表面色间隔；环形有 4px 圆角；突出时其余扇区变淡', () => {
    const built = option('doughnut', {}, toggleEmphasis(chartFixture('doughnut'), DEFAULT_CHART_READING_STATE, '1'))
    const series = (built.series as { radius: string[]; data: { itemStyle: { opacity: number; borderWidth: number; borderRadius: number } }[] }[])[0]
    expect(series?.radius).toEqual(['46%', '64%'])
    expect(series?.data[0]?.itemStyle).toMatchObject({ borderWidth: 2, borderRadius: 4 })
    expect(series?.data[1]?.itemStyle.opacity).toBe(1)
    expect(series?.data[0]?.itemStyle.opacity).toBeLessThan(0.5)
  })

  it('tooltip 给出占比与原值；占比分母是完整合计', () => {
    const view = deriveChartReadingView(chartFixture('pie'), DEFAULT_CHART_READING_STATE)
    const content = buildShareTooltipContent(view, chartTestContext(), 0)
    expect(content).toMatchObject({ heading: '订阅', rows: [{ label: '占比', value: '58%', detail: '58' }] })
    expect(buildShareTooltipContent(view, chartTestContext(), 99)).toBeNull()
  })

  it('类目很多时默认关闭外侧标签，显式开启则显示', () => {
    const categories = Array.from({ length: 10 }, (_, index) => `部分${index}`)
    const series = [{ name: '份额', values: Array.from({ length: 10 }, () => 1) }]
    expect((option('pie', { categories, series }).series as { label: { show: boolean } }[])[0]?.label.show).toBe(false)
    expect((option('pie', { categories, series, showDataLabels: true }).series as { label: { show: boolean } }[])[0]?.label.show).toBe(true)
  })
})

describe('散点', () => {
  it('X 是真实数值坐标：非等距 X 保持真实间距', () => {
    const built = option('scatter')
    const series = built.series as { data: { value: number[] }[] }[]
    expect(series[0]?.data.map(point => point.value)).toEqual([[1, 3], [2, 5], [10, 21], [14, 25], [21, 40]])
    expect(built.xAxis).toMatchObject({ type: 'value' })
    expect(built.yAxis).toMatchObject({ type: 'value' })
  })

  it('tooltip 以对象标签为标题并给出 X/Y 的轴标题与格式', () => {
    const view = deriveChartReadingView(chartFixture('scatter'), DEFAULT_CHART_READING_STATE)
    expect(buildScatterTooltipContent(view, chartTestContext(), 0, 2)).toMatchObject({
      heading: '丙',
      rows: [{ label: '研发投入', value: '10亿元' }, { label: '专利数（件）', value: '21', detail: '样本企业' }],
    })
  })

  it('聚焦 X 范围只改变视口；单位与原值不变', () => {
    const spec = chartFixture('scatter')
    const state = { ...DEFAULT_CHART_READING_STATE, xRange: { min: 1, max: 5 } }
    const built = buildChartOption(spec, state, chartTestContext())
    expect(built.xAxis).toMatchObject({ min: 1, max: 5 })
    expect((built.series as { data: number[][] }[])[0]?.data).toHaveLength(5)
  })
})

describe('雷达', () => {
  it('所有维度共用固定量尺，不按各维度最大值归一', () => {
    const built = option('radar')
    const radar = built.radar as { indicator: { name: string; min: number; max: number }[] }
    expect(radar.indicator).toEqual(['性能', '成本', '体验', '生态', '安全'].map(name => ({ name, min: 0, max: 100 })))
    expect((built.series as { data: { value: number[] }[] }[])[0]?.data.map(item => item.value)).toEqual([
      [82, 60, 74, 90, 70],
      [65, 86, 78, 55, 80],
    ])
  })

  it('隐藏系列后量尺不变；tooltip 列出每个维度的原值', () => {
    const spec = chartFixture('radar')
    const hidden = toggleSeriesVisibility(spec, DEFAULT_CHART_READING_STATE, '方案乙')
    const built = buildChartOption(spec, hidden, chartTestContext())
    expect((built.radar as { indicator: { max: number }[] }).indicator.every(item => item.max === 100)).toBe(true)
    expect((built.series as { data: unknown[] }[])[0]?.data).toHaveLength(1)

    const view = deriveChartReadingView(spec, DEFAULT_CHART_READING_STATE)
    expect(buildRadarTooltipContent(view, chartTestContext(), 1)?.rows.map(row => [row.label, row.value])).toEqual([
      ['性能', '65'], ['成本', '86'], ['体验', '78'], ['生态', '55'], ['安全', '80'],
    ])
  })
})

describe('渲染意图', () => {
  it('默认视图导出忽略阅读状态，且没有 tooltip 与动画', () => {
    const spec = chartFixture('line')
    const state = toggleSeriesVisibility(spec, DEFAULT_CHART_READING_STATE, '成本')
    const built = buildChartOption(spec, state, chartTestContext({ intent: 'export', transition: true }))
    expect(built.series as unknown[]).toHaveLength(2)
    expect(built.tooltip).toEqual({ show: false })
  })

  it('仅在明确的数据更新时播放短过渡；首次渲染直接给出最终结果', () => {
    expect(option('bar', {}, DEFAULT_CHART_READING_STATE, chartTestContext({ transition: false }))).toMatchObject({ animation: false, animationDurationUpdate: 0 })
    expect(option('bar', {}, DEFAULT_CHART_READING_STATE, chartTestContext({ transition: true }))).toMatchObject({ animation: true, animationDuration: 0, animationDurationUpdate: 450 })
  })

  it('tooltip 内容读取正式观测值，与隐藏的系列无关', () => {
    const spec = chartFixture('line')
    const view = deriveChartReadingView(spec, toggleSeriesVisibility(spec, DEFAULT_CHART_READING_STATE, '成本'))
    expect(shownCartesianSeries(view).map(item => item.series.name)).toEqual(['营收'])
    expect(buildCartesianTooltipContent(view, chartTestContext(), 2)?.rows.map(row => row.value)).toEqual(['101'])
  })
})
