import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_READING_STATE } from '../definitions/chartReadingState'
import { chartFixture, chartTestTheme } from '../testing/chartTestFixtures'
import { composeChartImage, escapeXml, wrapText, type TextMeasurer } from './chartImageComposition'
import { buildChartLegend } from './chartLegend'

/** 每个字符固定宽度，使换行与高度可确定。 */
const measure: TextMeasurer = (text, size) => [...text].length * size * 0.6

describe('图片构图', () => {
  const chartSvg = '<svg width="640" height="320"><g/></svg>'
  const theme = chartTestTheme('light')

  it('图表、图例、脚注与题注依次排布，并给出稳定尺寸', () => {
    const spec = chartFixture('line', { description: '按季度对比营收与成本。' })
    const result = composeChartImage({
      spec, chartSvg, chartWidth: 640, chartHeight: 320, theme,
      legend: buildChartLegend(spec, DEFAULT_CHART_READING_STATE, theme),
      footnote: '同一量尺', measure,
    })
    expect(result.width).toBe(680)
    expect(result.svg.startsWith('<svg xmlns=')).toBe(true)
    expect(result.svg).toContain('季度营收与成本')
    expect(result.svg).toContain('按季度对比营收与成本。')
    expect(result.svg).toContain(chartSvg)
    expect(result.svg).toContain('同一量尺')
    // 图例、脚注和题注均在图表之后，题注包含在复制图片内。
    expect(result.svg.indexOf('季度营收与成本')).toBeGreaterThan(result.svg.indexOf('同一量尺'))
    expect(result.svg).toContain('text-anchor="middle"')
    expect(result.svg.indexOf(chartSvg)).toBeLessThan(result.svg.indexOf('>营收<'))
    expect(result.height).toBeGreaterThan(320 + 40)
  })

  it('标题与图例中的文本被转义：不可信文本不能注入标记', () => {
    const spec = chartFixture('line', { title: '<script>alert(1)</script> & "x"', series: [{ name: '</text><rect/>', values: [1, 2, 3, 4] }, { name: '成本', values: [1, 2, 3, 4] }] })
    const result = composeChartImage({
      spec, chartSvg, chartWidth: 640, chartHeight: 320, theme,
      legend: buildChartLegend(spec, DEFAULT_CHART_READING_STATE, theme), measure,
    })
    expect(result.svg).not.toContain('<script>')
    expect(result.svg).not.toContain('</text><rect/>')
    expect(result.svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;')
  })

  it('组合图中位于次轴的系列在图例里带“右轴”提示，与界面图例一致', () => {
    const spec = chartFixture('combo')
    const withHint = composeChartImage({
      spec, chartSvg, chartWidth: 640, chartHeight: 320, theme,
      legend: buildChartLegend(spec, DEFAULT_CHART_READING_STATE, theme), secondaryAxisHint: '右轴', measure,
    })
    const withoutHint = composeChartImage({
      spec, chartSvg, chartWidth: 640, chartHeight: 320, theme,
      legend: buildChartLegend(spec, DEFAULT_CHART_READING_STATE, theme), measure,
    })

    expect(withHint.svg).toContain('利润率 右轴')
    expect(withHint.svg).not.toContain('营收 右轴')
    expect(withoutHint.svg).not.toContain('右轴')
  })

  it('图例键与界面一致：柱是原色填充，折线是描线色短线，散点是圆点；整张图用等宽数字', () => {
    const palette = theme.palette
    const compose = (type: Parameters<typeof chartFixture>[0], patch: Record<string, unknown> = {}) => {
      const spec = chartFixture(type, patch)
      return composeChartImage({
        spec, chartSvg, chartWidth: 640, chartHeight: 320, theme,
        legend: buildChartLegend(spec, DEFAULT_CHART_READING_STATE, theme), measure,
      }).svg
    }
    const bars = compose('bar', { series: [{ name: '甲', values: [1, 2, 3, 4, 5] }, { name: '乙', values: [2, 3, 4, 5, 6] }] })
    expect(bars).toContain(`width="9" height="9" rx="2" fill="${palette[0]?.fill}"`)
    expect(bars).toContain(`fill="${palette[7]?.fill}"`)

    const lines = compose('line')
    expect(lines).toContain(`width="14" height="3" rx="1.5" fill="${palette[0]?.ink}"`)

    const dots = compose('scatter', { series: [{ name: '甲', values: [3, 5, 21, 25, 40] }, { name: '乙', values: [1, 2, 3, 4, 5] }] })
    expect(dots).toContain(`r="3.5" fill="${palette[0]?.fill}"`)

    expect(bars).toContain('style="font-variant-numeric:tabular-nums"')
  })

  it('没有标题与图例时只有图表本身加内边距', () => {
    const spec = chartFixture('bar', { title: undefined })
    const result = composeChartImage({ spec, chartSvg, chartWidth: 640, chartHeight: 320, theme, legend: [], measure })
    expect(result.height).toBe(320 + 40)
  })

  it('长标题按宽度换行：不丢字、不死循环', () => {
    // 字号 10、每字 6px：30px 宽每行最多 5 个字。
    expect(wrapText('一二三四五六七八九十', 30, 10, 400, measure)).toEqual(['一二三四五', '六七八九十'])
    expect(wrapText('短', 30, 10, 400, measure)).toEqual(['短'])
    // 单个字符超宽也至少占一行。
    expect(wrapText('宽宽', 1, 10, 400, measure)).toEqual(['宽', '宽'])
    expect(wrapText('', 30, 10, 400, measure)).toEqual([])
  })

  it('XML 转义覆盖五个特殊字符', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;')
  })
})
