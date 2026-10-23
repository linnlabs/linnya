import { describe, expect, it, vi } from 'vitest'
import { MARKDOWN_CHART_TYPES } from '@app/schemas'
import { DEFAULT_CHART_READING_STATE } from '../../definitions/chartReadingState'
import { chartFixture, chartTestContext, chartTestTheme } from '../../testing/chartTestFixtures'
import { loadChartRuntime } from '../../orchestration/chartRuntime'
import { toggleEmphasis, toggleSeriesVisibility, setCategoryRange } from '../chartReadingState'
import { buildChartOption } from './buildChartOption'
import { resolveLegendPosition } from '../chartLegend'
import { buildCartesianTooltipContent, categorySlotWidth, shownCartesianSeries } from './cartesianOption'
import { buildShareTooltipContent, shareOuterRatio } from './shareOption'
import { buildScatterTooltipContent } from './scatterOption'
import { buildRadarTooltipContent } from './radarOption'
import { deriveChartReadingView } from '../chartReadingView'
import { parseColor } from '../chartPalette'

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
    tooltipBackground: 'rgb(64, 64, 64)',
    tooltipText: 'rgb(255, 255, 255)',
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

  it('网格读取中性边界 token，指示线透明度能处理 rgb() 文字色', () => {
    const bar = option('bar', {}, DEFAULT_CHART_READING_STATE, chartTestContext({ theme: browserTheme }))
    const grid = (bar.yAxis as { splitLine: { lineStyle: { color: string; type: string } } }[])[0]?.splitLine.lineStyle
    expect(grid).toMatchObject({ color: browserTheme.gridColor, type: 'solid' })
    expect((bar.xAxis as { axisLine: { lineStyle: { color: string } } }).axisLine.lineStyle.color).toBe(browserTheme.gridColor)

    const line = option('line', {}, DEFAULT_CHART_READING_STATE, chartTestContext({ theme: browserTheme }))
    const pointer = (line.tooltip as { axisPointer: { lineStyle: { color: string } } }).axisPointer.lineStyle
    expect(pointer.color).toBe('rgba(23, 23, 23, 0.2)')
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
    expect(series?.data[0]?.itemStyle.borderRadius).toEqual([0, 2, 2, 0])
  })

  it('柱厚度有上限；单系列且类目不多时显示数值标签，类目多则克制', () => {
    const built = option('bar')
    const series = (built.series as { barMaxWidth: number; label: { show: boolean } }[])[0]
    expect(series?.barMaxWidth).toBe(22)
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
    expect(data?.[0]?.itemStyle.borderRadius).toEqual([2, 2, 0, 0])
    expect(data?.[1]?.itemStyle.borderRadius).toEqual([0, 0, 2, 2])
  })

  it('逐点着色：显式色作为填充；null 沿用系列色', () => {
    const built = option('bar', { series: [{ name: '销量', values: [12.4, 20.5, 8.1, 15.2, 9.3], pointColors: ['#336699', null, null, null, null] }] })
    const data = (built.series as { data: { itemStyle: { color?: string; borderColor?: string } }[] }[])[0]?.data
    expect(data?.[0]?.itemStyle).toMatchObject({ color: '#336699' })
    expect(data?.[1]?.itemStyle.color).toBeUndefined()
  })

  it('堆叠：只有可见堆叠顶端取圆角，隐藏系列后保留完整分母和色序', () => {
    const spec = {
      stacking: 'stacked',
      categories: ['A', 'B'],
      series: [{ name: '一', values: [3, 4] }, { name: '二', values: [2, 1] }],
    }
    const built = option('bar', spec)
    const series = built.series as { stack: string; itemStyle: { borderColor: string; borderWidth: number }; data: { itemStyle: { borderRadius: number | number[] } }[] }[]
    expect(series.map(item => item.stack)).toEqual(['total', 'total'])
    expect(series[0]?.data[0]?.itemStyle.borderRadius).toBe(0)
    expect(series[1]?.data[0]?.itemStyle.borderRadius).toEqual([2, 2, 0, 0])

    // 隐藏顶端系列后，圆角移到新的可见顶端。
    const hidden = toggleSeriesVisibility(chartFixture('bar', spec), DEFAULT_CHART_READING_STATE, '二')
    const afterHide = option('bar', spec, hidden).series as typeof series
    expect(afterHide).toHaveLength(1)
    expect(afterHide[0]?.data[0]?.itemStyle.borderRadius).toEqual([2, 2, 0, 0])
  })

  it('百分比堆叠：绘制值按完整类目合计归一；隐藏系列后剩余份额不补足到 100%，tooltip 保留原值', async () => {
    const spec = {
      stacking: 'percent',
      showDataLabels: true,
      categories: ['A', 'B'],
      series: [{ name: '一', values: [1, 2] }, { name: '二', values: [3, 2] }],
    }
    const full = option('bar', spec)
    const plotted = (full.series as { data: { value: number }[] }[]).map(item => item.data.map(point => point.value))
    expect(plotted).toEqual([[0.25, 0.5], [0.75, 0.5]])
    const echarts = await loadChartRuntime('bar')
    const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 640, height: 320 })
    try {
      chart.setOption(full)
      expect(chart.renderToSVGString()).toContain('25.0%')
    } finally { chart.dispose() }

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

  it('颜色随实体：隐藏第一个系列后，第二个系列仍保持原分配色', () => {
    const spec = { stacking: 'stacked', categories: ['A'], series: [{ name: '一', values: [1] }, { name: '二', values: [2] }] }
    const hidden = toggleSeriesVisibility(chartFixture('bar', spec), DEFAULT_CHART_READING_STATE, '一')
    const series = option('bar', spec, hidden).series as { itemStyle: { color: string; borderColor: string } }[]
    expect(series).toHaveLength(1)
    const second = chartTestTheme('light').palette[7]
    expect(series[0]?.itemStyle).toMatchObject({ color: second?.fill })
  })

  it('色系跟随规格：同一份数据在不同色系里取到各自的颜色', () => {
    const colors = (palette: 'verdant' | 'warm' | 'aqua') => {
      const series = option('bar', { palette }, DEFAULT_CHART_READING_STATE, chartTestContext({ theme: chartTestTheme('light', palette) })).series as { itemStyle: { color: string } }[]
      return series[0]?.itemStyle.color
    }
    expect(new Set([colors('verdant'), colors('warm'), colors('aqua')]).size).toBe(3)
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
  it('观测点很多时不画常驻标记；marker: none 关闭标记', () => {
    const many = option('line', {
      categories: Array.from({ length: 40 }, (_, index) => `${index}`),
      series: [{ name: 'S', values: Array.from({ length: 40 }, (_, index) => index) }],
    })
    expect((many.series as { showSymbol: boolean }[])[0]?.showSymbol).toBe(false)
    const none = option('line', { series: [{ name: 'S', values: [1, 2, 3, 4], marker: 'none' }] })
    expect((none.series as { showSymbol: boolean }[])[0]?.showSymbol).toBe(false)
  })

  it('面积表达规模、折线不带面积；类目轴贴边', () => {
    const built = option('area')
    expect(built.series).toEqual(expect.arrayContaining([expect.objectContaining({ areaStyle: expect.objectContaining({ color: expect.any(String) }) })]))
    expect((built.xAxis as { boundaryGap: boolean }).boundaryGap).toBe(false)
    expect((option('line').series as { areaStyle?: unknown }[]).every(item => item.areaStyle === undefined)).toBe(true)
  })

  it('持久突出时，未被突出的面积整体更淡', () => {
    const patch = { series: [{ name: '甲', values: [1, 2, 3, 4] }, { name: '乙', values: [2, 3, 4, 5] }] }
    const spec = chartFixture('area', patch)
    const state = toggleEmphasis(spec, DEFAULT_CHART_READING_STATE, '甲')
    const series = buildChartOption(spec, state, chartTestContext()).series as { name: string; areaStyle: { color: string } }[]
    const topAlpha = (name: string) => parseColor(series.find(item => item.name === name)?.areaStyle.color ?? '')?.alpha ?? 0
    expect(topAlpha('乙')).toBeLessThan(topAlpha('甲') * 0.5)
  })

  it('折线默认只在行末标注“系列名 + 末值”，不在每个点上放数字，也不再放图例', () => {
    const built = option('line')
    const series = built.series as { data: { label: { show: boolean } }[]; endLabel?: { show: boolean; formatter: string } }[]
    for (const item of series) {
      expect(item.data.every(point => point.label.show === false)).toBe(true)
      expect(item.endLabel).toMatchObject({ show: true })
    }
    expect(series[0]?.endLabel?.formatter).toBe('{name|营收}  {value|134}')
    expect(series[1]?.endLabel?.formatter).toBe('{name|成本}  {value|95}')
    expect(resolveLegendPosition(chartFixture('line'))).toBe('none')
  })

  it('行末标签给右侧留出恰好的边距：最长的“系列名 + 末值”决定，但不超过绘图区的 36%', () => {
    const rightOf = (patch: Record<string, unknown>, plotWidth = 640) =>
      (option('line', patch, DEFAULT_CHART_READING_STATE, chartTestContext({ plotWidth })).grid as { right: number }).right
    expect(rightOf({})).toBe(72)
    const long = { series: [{ name: '这是一个非常非常长的系列名称用来测试边距上限', values: [1, 2, 3, 4] }] }
    expect(rightOf(long)).toBe(Math.floor(640 * 0.36))
    expect(rightOf(long, 320)).toBe(Math.max(72, Math.floor(320 * 0.36)))
  })

  it('显式指定图例位置，或系列超过 5 个，或不是折线/面积时，不用行末直标', () => {
    const endLabelOf = (type: Parameters<typeof chartFixture>[0], patch: Record<string, unknown> = {}) =>
      (option(type, patch).series as { endLabel?: unknown }[]).map(item => item.endLabel)
    expect(endLabelOf('line', { legendPosition: 'bottom' }).every(value => value === undefined)).toBe(true)
    const crowded = { series: Array.from({ length: 6 }, (_, index) => ({ name: `系列${index + 1}`, values: [1, 2, 3, 4] })) }
    expect(endLabelOf('line', crowded).every(value => value === undefined)).toBe(true)
    expect(endLabelOf('bar').every(value => value === undefined)).toBe(true)
    expect(endLabelOf('combo').every(value => value === undefined)).toBe(true)
    expect(endLabelOf('area').every(value => value !== undefined)).toBe(true)
  })

  it('不用行末直标时，终点数值标签回到末点上，其余点不放数字', () => {
    const series = option('line', { legendPosition: 'bottom' }).series as { data: { label: { show: boolean } }[] }[]
    const data = series[0]?.data ?? []
    expect(data.slice(0, -1).every(point => point.label.show === false)).toBe(true)
    expect(data[data.length - 1]?.label.show).toBe(true)
  })

  it('行末标签加宽了右侧留白，类目标签仍按真实槽宽设定：不会因框重叠被 ECharts 隔一个隐藏', async () => {
    const echarts = await loadChartRuntime('line')
    for (const width of [680, 330]) {
      const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width, height: 320 })
      chart.setOption(option('line', {}, DEFAULT_CHART_READING_STATE, chartTestContext({ plotWidth: width })))
      const svg = chart.renderToSVGString()
      chart.dispose()
      for (const label of ['Q1', 'Q2', 'Q3', 'Q4']) expect(svg, `${width}px ${label}`).toContain(`>${label}<`)
    }
  })

  it('类目槽宽的估计计入右侧留白：留白越大每个类目越窄；副轴与默认留白至少按 72px 估算', () => {
    expect(categorySlotWidth(680, 4, 14)).toBe(152)
    expect(categorySlotWidth(680, 4, 4)).toBe(152)
    expect(categorySlotWidth(680, 4, 72)).toBe(137.5)
    expect(categorySlotWidth(680, 0, 14)).toBe(608)
  })

  it('系列名是不可信文本：行末标签里的花括号被换成全角，不会被当成富文本样式', () => {
    const built = option('line', { series: [{ name: '{value|x} 增长', values: [1, 2, 3, 4] }] })
    const formatter = (built.series as { endLabel: { formatter: string } }[])[0]?.endLabel.formatter ?? ''
    expect(formatter).toContain('｛value|x｝ 增长')
    expect(formatter).not.toContain('{value|x}')
    expect(formatter.startsWith('{name|')).toBe(true)
  })

  it('折线在暗色主题里取暗色色系的描线', () => {
    const dark = chartTestTheme('dark')
    const series = option('line', {}, DEFAULT_CHART_READING_STATE, chartTestContext({ theme: dark })).series as { lineStyle: { color: string } }[]
    expect(series[0]?.lineStyle.color).toBe(dark.palette[0]?.ink)
    expect(dark.palette[0]?.ink).not.toBe(chartTestTheme('light').palette[0]?.ink)
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
  it('突出某个环形组成部分时，其余变淡且数值不变', () => {
    const built = option('doughnut', {}, toggleEmphasis(chartFixture('doughnut'), DEFAULT_CHART_READING_STATE, '1'))
    const series = (built.series as { radius: string[]; data: { itemStyle: { opacity: number; borderWidth: number; borderRadius: number; color: string; borderColor: string } }[] }[])[0]
    expect(series?.data[1]?.itemStyle.opacity).toBe(1)
    expect(series?.data[0]?.itemStyle.opacity).toBeLessThan(0.5)
  })

  it('外半径随绘图区宽度收缩，窄图里先缩小圆，给外侧标签留出横向空间', () => {
    expect(shareOuterRatio(640, 320)).toBe(0.66)
    expect(shareOuterRatio(300, 320)).toBe(0.4)
    expect(shareOuterRatio(400, 320)).toBeCloseTo(0.65, 5)
    const widths = [200, 280, 340, 400, 460, 520, 640, 900].map(width => shareOuterRatio(width, 320))
    expect(widths.every(ratio => ratio >= 0.4 && ratio <= 0.66)).toBe(true)
    expect(widths).toEqual([...widths].sort((a, b) => a - b))

    const narrow = option('pie', {}, DEFAULT_CHART_READING_STATE, chartTestContext({ plotWidth: 300 }))
    expect((narrow.series as { radius: string[] }[])[0]?.radius).toEqual(['0%', '40%'])
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

  it('轮廓是描线色，填充是淡填充色；系列多时填充更淡，避免叠成一团', () => {
    const palette = chartTestTheme('light').palette
    type RadarData = { lineStyle: { color: string }; areaStyle: { color: string; opacity: number } }[]
    const two = ((option('radar').series as { data: RadarData }[])[0]?.data ?? [])
    expect(two[0]?.lineStyle.color).toBe(palette[0]?.ink)
    expect(two[0]?.areaStyle.color).toBe(palette[0]?.fill)

    const three = option('radar', { series: [
      { name: '甲', values: [82, 60, 74, 90, 70] }, { name: '乙', values: [65, 86, 78, 55, 80] }, { name: '丙', values: [50, 70, 60, 80, 90] },
    ] })
    expect(((three.series as { data: RadarData }[])[0]?.data ?? [])[0]?.areaStyle.opacity).toBeLessThan(two[0]?.areaStyle.opacity ?? 0)
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
