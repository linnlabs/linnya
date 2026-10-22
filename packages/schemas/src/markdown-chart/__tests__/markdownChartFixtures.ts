/**
 * 八类图表的合法规格样本。只服务本包测试：每个样本都是“能被研究文章直接使用”的最小自洽数据。
 */

import type { MarkdownChartType } from '../definitions/markdownChartConstants';

export const markdownChartFixtures: Readonly<Record<MarkdownChartType, Record<string, unknown>>> = {
  bar: {
    chartType: 'bar',
    title: '各城市 2025 年销量',
    categories: ['北京', '上海', '广州'],
    series: [{ name: '2025', values: [12, 20.5, 8] }],
    barDirection: 'horizontal',
    valueAxis: { title: '万件', numberFormat: '#,##0.0' },
  },
  line: {
    chartType: 'line',
    title: '季度营收',
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: '营收', values: [120, 132, 101, 134], marker: 'circle' },
      { name: '成本', values: [80, 90, 85, 95], lineDash: 'dash' },
    ],
    valueAxis: { title: '万元', min: 0 },
  },
  area: {
    chartType: 'area',
    categories: ['2022', '2023', '2024'],
    series: [{ name: '用户数', values: [10, 18, 30] }],
    valueAxis: { min: 0, max: 40 },
  },
  pie: {
    chartType: 'pie',
    title: '收入构成',
    categories: ['订阅', '广告', '其他'],
    series: [{ name: '占比', values: [60, 30, 10] }],
    dataLabelContent: 'percentage',
  },
  doughnut: {
    chartType: 'doughnut',
    categories: ['A', 'B'],
    series: [{ name: '份额', values: [3, 1], pointColors: ['#1F6FEB', null] }],
  },
  scatter: {
    chartType: 'scatter',
    title: '研发投入与专利数',
    categories: [1, 2, 10],
    series: [{ name: '样本', values: [3, 5, 21] }],
    pointLabels: ['甲', '乙', '丙'],
    xAxis: { title: '投入（亿元）' },
    valueAxis: { title: '专利数（件）' },
  },
  radar: {
    chartType: 'radar',
    categories: ['性能', '成本', '体验', '生态'],
    series: [
      { name: '方案甲', values: [80, 60, 70, 90] },
      { name: '方案乙', values: [65, 85, 75, 55], color: '#d9480f' },
    ],
    radarScale: { min: 0, max: 100 },
  },
  combo: {
    chartType: 'combo',
    title: '2026 年各季度营收与利润率',
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: '营收', values: [120, 132, 101, 134], chartType: 'bar' },
      { name: '利润率', values: [0.27, 0.31, 0.25, 0.29], chartType: 'line', axis: 'secondary' },
    ],
    valueAxis: { title: '万元', numberFormat: '#,##0' },
    secondaryValueAxis: { title: '利润率', numberFormat: '0%' },
  },
};

export function cloneFixture(type: MarkdownChartType): Record<string, unknown> {
  return structuredClone(markdownChartFixtures[type]);
}
