/**
 * 仅供测试：八类图表的展示数据与渲染上下文。
 * 数据是固定、可复算的研究风格样例，覆盖长中文类目、小数/百分比、负值和大数。
 */

import { admitMarkdownChartSpec, type MarkdownChartPalette, type MarkdownChartSpec, type MarkdownChartType } from '@app/schemas'
import { baseChartTheme, type ChartScheme, type ChartThemeTokens } from '../definitions/chartTheme'
import type { ChartRenderContext } from '../definitions/chartRender'

export const chartFixtureInputs: Readonly<Record<MarkdownChartType, Record<string, unknown>>> = {
  bar: {
    chartType: 'bar',
    title: '2025 年主要城市新能源汽车销量',
    categories: ['北京', '上海', '广州', '深圳', '杭州'],
    series: [{ name: '销量', values: [12.4, 20.5, 8.1, 15.2, 9.3] }],
    valueAxis: { title: '万辆', numberFormat: '0.0' },
  },
  line: {
    chartType: 'line',
    title: '季度营收与成本',
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: '营收', values: [120, 132, 101, 134] },
      { name: '成本', values: [80, 90, 85, 95], lineDash: 'dash' },
    ],
    valueAxis: { title: '万元' },
  },
  area: {
    chartType: 'area',
    categories: ['2021', '2022', '2023', '2024'],
    series: [{ name: '注册用户', values: [1200, 1800, 3100, 4600] }],
    valueAxis: { title: '万人' },
  },
  pie: {
    chartType: 'pie',
    title: '收入构成',
    categories: ['订阅', '广告', '增值服务', '其他'],
    series: [{ name: '收入', values: [58, 22, 14, 6] }],
    dataLabelContent: 'percentage',
  },
  doughnut: {
    chartType: 'doughnut',
    categories: ['国内', '北美', '欧洲', '亚太其他'],
    series: [{ name: '份额', values: [48, 24, 18, 10] }],
    dataLabelContent: 'percentage',
  },
  scatter: {
    chartType: 'scatter',
    title: '研发投入与专利数',
    categories: [1, 2, 10, 14, 21],
    series: [{ name: '样本企业', values: [3, 5, 21, 25, 40] }],
    pointLabels: ['甲', '乙', '丙', '丁', '戊'],
    xAxis: { title: '研发投入', numberFormat: '0"亿元"' },
    valueAxis: { title: '专利数（件）' },
  },
  radar: {
    chartType: 'radar',
    title: '方案评估',
    categories: ['性能', '成本', '体验', '生态', '安全'],
    series: [
      { name: '方案甲', values: [82, 60, 74, 90, 70] },
      { name: '方案乙', values: [65, 86, 78, 55, 80] },
    ],
    radarScale: { min: 0, max: 100 },
  },
  combo: {
    chartType: 'combo',
    title: '营收与利润率',
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: '营收', values: [120, 132, 101, 134], chartType: 'bar' },
      { name: '利润率', values: [0.27, 0.31, 0.25, 0.29], chartType: 'line', axis: 'secondary' },
    ],
    valueAxis: { title: '万元', numberFormat: '#,##0' },
    secondaryValueAxis: { title: '利润率', numberFormat: '0%' },
  },
}

export function chartFixture(type: MarkdownChartType, patch: Record<string, unknown> = {}): MarkdownChartSpec {
  const result = admitMarkdownChartSpec({ ...chartFixtureInputs[type], ...patch })
  if (!result.ok) throw new Error(`fixture ${type}: ${JSON.stringify(result.diagnostics)}`)
  return result.spec
}

export function chartTestTheme(scheme: ChartScheme = 'light', palette?: MarkdownChartPalette): ChartThemeTokens {
  return baseChartTheme(scheme, palette)
}

export function chartTestContext(overrides: Partial<ChartRenderContext> = {}): ChartRenderContext {
  return {
    theme: chartTestTheme('light'),
    locale: 'zh-CN',
    messages: { secondaryAxis: '右轴', shareOfWhole: '占整体', share: '占比' },
    plotWidth: 640,
    plotHeight: 320,
    intent: 'reading',
    transition: false,
    ...overrides,
  }
}
