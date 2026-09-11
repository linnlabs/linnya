import { z } from 'zod';
import type { ChartSeries, LayoutChartControls, LayoutChartStyle, StructuredElement } from '@plugin/slides/shared';
import { isSupportedChartNumberFormat } from '@plugin/slides/shared/chart/numberFormat';

const text = z.string().min(1);
const positive = z.number().finite().positive();
const numberFormat = text.refine(isSupportedChartNumberFormat, '使用 General、0.0、#,##0、0.0% 或带引号单位等简单数字格式。');
const valueAxis = z.object({
  title: text.optional(), visible: z.boolean().optional(),
  min: z.number().finite().optional(), max: z.number().finite().optional(),
  majorUnit: positive.optional(), numberFormat: numberFormat.optional(), showGridlines: z.boolean().optional(),
}).strict().refine(axis => axis.min == null || axis.max == null || axis.min < axis.max, {
  message: 'min 必须小于 max。',
});

const controlsSchema = z.object({
  categoryAxis: z.object({
    title: text.optional(), visible: z.boolean().optional(), labelRotation: z.number().min(-90).max(90).optional(),
  }).strict().optional(),
  valueAxis: valueAxis.optional(), secondaryValueAxis: valueAxis.optional(),
  stacking: z.enum(['none', 'stacked', 'percent']).optional(),
  dataLabelContent: z.enum(['value', 'percentage', 'category']).optional(),
  dataLabelPosition: z.enum(['inside', 'outside', 'center']).optional(),
});

const seriesSchema = z.object({
  name: text, labels: z.array(z.string()), values: z.array(z.number().finite()),
  chartType: z.enum(['bar', 'line', 'area']).optional(),
  axis: z.enum(['primary', 'secondary']).optional(), color: text.optional(),
  lineWidth: positive.optional(), lineDash: z.enum(['solid', 'dash', 'dot']).optional(),
  marker: z.enum(['none', 'circle', 'square', 'diamond', 'triangle']).optional(),
  pointColors: z.array(text.nullable()).optional(),
  showDataLabels: z.boolean().optional(), dataLabelFormat: numberFormat.optional(),
});

const styleSchema = z.object({
  fontFamily: text.optional(),
  axisLabelFontSize: positive.optional(), categoryAxisLabelFontSize: positive.optional(),
  valueAxisLabelFontSize: positive.optional(), dataLabelFontSize: positive.optional(), legendFontSize: positive.optional(),
  legendColor: text.optional(), plotBackgroundColor: text.optional(), seriesLineWidth: positive.optional(),
  axisLabelColor: text.optional(), categoryAxisLabelColor: text.optional(), valueAxisLabelColor: text.optional(),
  dataLabelColor: text.optional(), gridlineColor: text.optional(),
}).strict();

/** 输入解析一次；Flex 与 Direct 使用相同字段族，不在 exporter 猜测作者意图。 */
export function parseChartControls(value: unknown): { value: LayoutChartControls } | { error: string } {
  const result = controlsSchema.safeParse(value);
  return result.success ? { value: result.data } : { error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

export function parseChartSeriesFields(value: unknown): ChartSeries | null {
  const result = seriesSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseChartStyle(value: unknown): { value: LayoutChartStyle } | { error: string } {
  const result = styleSchema.safeParse(value);
  return result.success ? { value: result.data } : { error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

/** 字段合法不等于组合可实现：这里只接纳两端有同一含义的图表组合。 */
export function validateChartSemantics(chart: Extract<StructuredElement, { type: 'chart' }>): void {
  const pie = chart.chartType === 'pie' || chart.chartType === 'doughnut';
  const cartesian = ['bar', 'line', 'area', 'combo'].includes(chart.chartType);
  const fail = (reason: string): never => { throw new Error(`Chart: ${reason}`); };
  if (!cartesian && !pie && (chart.dataLabelContent || chart.dataLabelPosition)) fail('标签内容/位置控制目前只支持柱、线、面积、饼、环和组合图。');
  if (typeof chart.options?.dataLabelFormatCode === 'string' && !isSupportedChartNumberFormat(chart.options.dataLabelFormatCode)) fail('不支持此数据标签数字格式。');
  if (!cartesian && (chart.categoryAxis || chart.valueAxis || chart.secondaryValueAxis)) {
    fail('轴配置目前只支持柱、线、面积和组合图。');
  }
  if (chart.dataLabelContent && chart.dataLabelContent !== 'value' && !pie) fail('percentage/category 标签仅支持饼图和环图。');
  if (pie && chart.data.series.length !== 1) fail('饼图和环图必须只有一个系列。');
  if (chart.stacking && chart.stacking !== 'none' && chart.chartType !== 'bar') fail('堆叠目前只支持柱/条图，不与组合或双轴混用。');
  if (chart.stacking === 'percent' && (chart.valueAxis?.min != null || chart.valueAxis?.max != null)) fail('百分比堆叠使用固定比例轴，不能覆盖 min/max。');
  if (chart.chartType === 'combo' && chart.options?.barDir === 'bar') fail('组合图中的柱系列必须为纵向柱，不使用横向预设。');
  if (chart.chartType === 'combo' && chart.options?.barGrouping && chart.options.barGrouping !== 'clustered') fail('组合图不使用堆叠预设。');
  const secondary = chart.data.series.some(s => s.axis === 'secondary');
  if (secondary !== !!chart.secondaryValueAxis) fail('secondary 系列与 secondaryValueAxis 必须同时声明。');
  if (secondary && chart.chartType !== 'combo') fail('双轴使用 combo，并显式声明每个系列类型和 axis。');
  if (secondary && chart.data.series.every(s => s.axis === 'secondary')) fail('双轴图至少需要一个 primary 系列。');
  for (const s of chart.data.series) {
    const type = s.chartType ?? chart.chartType;
    if (type === 'scatter' && s.color) fail('散点图目前使用 theme.chart.palette，不支持逐系列 color。');
    if (chart.chartType === 'combo' && !s.chartType) fail(`系列 ${s.name} 缺少 chartType。`);
    if (chart.chartType !== 'combo' && s.chartType && s.chartType !== chart.chartType) fail('不同系列类型必须使用 combo。');
    if (s.values.length !== chart.data.categories.length || (s.labels.length > 0 && s.labels.length !== s.values.length)) fail(`系列 ${s.name} 的数值和标签数量必须与 categories 一致。`);
    if (s.labels.length && s.labels.some((label, i) => label !== chart.data.categories[i])) fail(`系列 ${s.name} 的 labels 必须与 categories 一致。`);
    if (s.pointColors && (!['bar', 'pie', 'doughnut'].includes(type) || s.pointColors.length !== s.values.length)) fail(`系列 ${s.name} 的 pointColors 仅支持柱/饼/环且须与 values 等长。`);
    if ((s.lineWidth != null || s.lineDash || s.marker) && type !== 'line') fail(`系列 ${s.name} 的线宽、虚线和 marker 仅支持折线。`);
    if ((s.showDataLabels != null || s.dataLabelFormat != null) && (type === 'scatter' || type === 'radar')) fail('逐系列数据标签目前只支持柱、线、面积、饼和环图。');
    if (pie && s.values.some(v => v < 0)) fail('饼图/环图不接受负值。');
  }
}
