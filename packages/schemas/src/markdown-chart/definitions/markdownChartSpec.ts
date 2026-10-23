/**
 * @file markdownChartSpec.ts
 * @description Markdown 图表块的语义规格（v1）：只描述数据与阅读语义，不含渲染库配置。
 *
 * 形状层由「图表类型判别 + strict 对象」承担：未知键和对该类型不适用的键都会被拒绝，
 * 不接纳后再忽略。字段之间的数值关系（等长、范围、双轴对应、份额合法性等）由
 * `checkMarkdownChartRules` 执行，二者共同构成 {@link MarkdownChartSpecSchema}。
 */

import { z } from 'zod';
import { isSupportedChartNumberFormat } from '../../chart-number-format';
import { MARKDOWN_CHART_LIMITS, MARKDOWN_CHART_PALETTES } from './markdownChartConstants';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** 单行、非空白文本：标题、系列名、类目名和轴标题都不允许控制字符。 */
function singleLineText(maxLength: number) {
  return z
    .string()
    .max(maxLength)
    .refine(value => value.trim().length > 0 && !CONTROL_CHARACTERS.test(value), {
      message: 'must be non-blank single-line text',
    });
}

const label = singleLineText(MARKDOWN_CHART_LIMITS.maxLabelLength);
const finite = z.number().finite();
const hexColor = z.string().regex(HEX_COLOR, 'must be a #RRGGBB color');
const numberFormat = z.string().refine(isSupportedChartNumberFormat, {
  message: 'must be General or a simple format such as 0.0, #,##0, 0.0% or 0.0"unit"',
});

export const MarkdownChartCategoryAxisSchema = z
  .object({
    title: label.optional(),
    labelRotation: finite.min(-90).max(90).optional(),
  })
  .strict();

export const MarkdownChartValueAxisSchema = z
  .object({
    title: label.optional(),
    min: finite.optional(),
    max: finite.optional(),
    majorUnit: finite.positive().optional(),
    numberFormat: numberFormat.optional(),
    showGridlines: z.boolean().optional(),
  })
  .strict();

const lineDash = z.enum(['solid', 'dash', 'dot']);
const marker = z.enum(['none', 'circle', 'square', 'diamond', 'triangle']);
const pointColors = z.array(hexColor.nullable()).min(1);
const values = z.array(finite).min(1);

const dataLabelFields = {
  showDataLabels: z.boolean().optional(),
  dataLabelFormat: numberFormat.optional(),
};

const BarSeriesSchema = z
  .object({
    name: label,
    values,
    color: hexColor.optional(),
    pointColors: pointColors.optional(),
    ...dataLabelFields,
  })
  .strict();

const LineSeriesSchema = z
  .object({
    name: label,
    values,
    color: hexColor.optional(),
    lineDash: lineDash.optional(),
    marker: marker.optional(),
    ...dataLabelFields,
  })
  .strict();

const AreaSeriesSchema = z
  .object({
    name: label,
    values,
    color: hexColor.optional(),
    ...dataLabelFields,
  })
  .strict();

/** 饼/环按类目取色：不接受系列级 color，逐点色用 pointColors。 */
const PieSeriesSchema = z
  .object({
    name: label,
    values,
    pointColors: pointColors.optional(),
    ...dataLabelFields,
  })
  .strict();

const ScatterSeriesSchema = z
  .object({
    name: label,
    values,
    color: hexColor.optional(),
    marker: marker.optional(),
  })
  .strict();

const RadarSeriesSchema = z
  .object({
    name: label,
    values,
    color: hexColor.optional(),
  })
  .strict();

const ComboSeriesSchema = z
  .object({
    name: label,
    values,
    chartType: z.enum(['bar', 'line', 'area']),
    axis: z.enum(['primary', 'secondary']).optional(),
    color: hexColor.optional(),
    pointColors: pointColors.optional(),
    lineDash: lineDash.optional(),
    marker: marker.optional(),
    ...dataLabelFields,
  })
  .strict();

const categoryValue = z.union([label, finite]);

/** 所有图表类型共有的展示字段。 */
const commonFields = {
  version: z.literal(1).optional(),
  title: singleLineText(MARKDOWN_CHART_LIMITS.maxTitleLength).optional(),
  description: singleLineText(MARKDOWN_CHART_LIMITS.maxDescriptionLength).optional(),
  size: z.enum(['small', 'medium', 'large']).optional(),
  legendPosition: z.enum(['top', 'bottom', 'left', 'right', 'none']).optional(),
  /** 整张图的色系；系列与逐点的显式 color 优先于它。 */
  palette: z.enum(MARKDOWN_CHART_PALETTES).optional(),
};

const dataLabelContentValueOnly = z.literal('value').optional();
const dataLabelContentShare = z.enum(['value', 'percentage', 'category']).optional();

const BarChartSpecSchema = z
  .object({
    ...commonFields,
    chartType: z.literal('bar'),
    categories: z.array(categoryValue).min(1),
    series: z.array(BarSeriesSchema).min(1),
    barDirection: z.enum(['vertical', 'horizontal']).optional(),
    stacking: z.enum(['none', 'stacked', 'percent']).optional(),
    /** 单系列比较可按类目着色；分组/堆叠必须保持系列身份。 */
    colorBy: z.enum(['series', 'category']).optional(),
    categoryAxis: MarkdownChartCategoryAxisSchema.optional(),
    valueAxis: MarkdownChartValueAxisSchema.optional(),
    ...dataLabelFields,
    dataLabelContent: dataLabelContentValueOnly,
  })
  .strict();

const LineChartSpecSchema = z
  .object({
    ...commonFields,
    chartType: z.literal('line'),
    categories: z.array(categoryValue).min(1),
    series: z.array(LineSeriesSchema).min(1),
    categoryAxis: MarkdownChartCategoryAxisSchema.optional(),
    valueAxis: MarkdownChartValueAxisSchema.optional(),
    ...dataLabelFields,
    dataLabelContent: dataLabelContentValueOnly,
  })
  .strict();

const AreaChartSpecSchema = z
  .object({
    ...commonFields,
    chartType: z.literal('area'),
    categories: z.array(categoryValue).min(1),
    series: z.array(AreaSeriesSchema).min(1),
    categoryAxis: MarkdownChartCategoryAxisSchema.optional(),
    valueAxis: MarkdownChartValueAxisSchema.optional(),
    ...dataLabelFields,
    dataLabelContent: dataLabelContentValueOnly,
  })
  .strict();

const PieChartSpecSchema = z
  .object({
    ...commonFields,
    chartType: z.literal('pie'),
    categories: z.array(categoryValue).min(1),
    series: z.array(PieSeriesSchema).min(1),
    ...dataLabelFields,
    dataLabelContent: dataLabelContentShare,
  })
  .strict();

const DoughnutChartSpecSchema = z
  .object({
    ...commonFields,
    chartType: z.literal('doughnut'),
    categories: z.array(categoryValue).min(1),
    series: z.array(PieSeriesSchema).min(1),
    ...dataLabelFields,
    dataLabelContent: dataLabelContentShare,
  })
  .strict();

const ScatterChartSpecSchema = z
  .object({
    ...commonFields,
    chartType: z.literal('scatter'),
    /** 散点的 categories 是数值 X，不是等距类目。 */
    categories: z.array(finite).min(1),
    series: z.array(ScatterSeriesSchema).min(1),
    pointLabels: z.array(label).min(1).optional(),
    xAxis: MarkdownChartValueAxisSchema.optional(),
    valueAxis: MarkdownChartValueAxisSchema.optional(),
  })
  .strict();

const RadarChartSpecSchema = z
  .object({
    ...commonFields,
    chartType: z.literal('radar'),
    categories: z.array(categoryValue).min(3),
    series: z.array(RadarSeriesSchema).min(1),
    /** 所有维度共用固定量尺；不按各维度自身最大值偷偷归一化。 */
    radarScale: z.object({ min: z.literal(0), max: finite.positive() }).strict(),
  })
  .strict();

const ComboChartSpecSchema = z
  .object({
    ...commonFields,
    chartType: z.literal('combo'),
    categories: z.array(categoryValue).min(1),
    series: z.array(ComboSeriesSchema).min(2),
    categoryAxis: MarkdownChartCategoryAxisSchema.optional(),
    valueAxis: MarkdownChartValueAxisSchema.optional(),
    secondaryValueAxis: MarkdownChartValueAxisSchema.optional(),
    ...dataLabelFields,
    dataLabelContent: dataLabelContentValueOnly,
  })
  .strict();

/** 仅形状：用于需要先拿到类型化对象再执行组合规则的调用方。 */
export const MarkdownChartSpecShapeSchema = z.discriminatedUnion('chartType', [
  BarChartSpecSchema,
  LineChartSpecSchema,
  AreaChartSpecSchema,
  PieChartSpecSchema,
  DoughnutChartSpecSchema,
  ScatterChartSpecSchema,
  RadarChartSpecSchema,
  ComboChartSpecSchema,
]);

export type MarkdownChartSpec = z.infer<typeof MarkdownChartSpecShapeSchema>;
export type MarkdownChartSeries = MarkdownChartSpec['series'][number];
export type MarkdownChartValueAxis = z.infer<typeof MarkdownChartValueAxisSchema>;
export type MarkdownChartCategoryAxis = z.infer<typeof MarkdownChartCategoryAxisSchema>;

export type BarMarkdownChartSpec = Extract<MarkdownChartSpec, { chartType: 'bar' }>;
export type LineMarkdownChartSpec = Extract<MarkdownChartSpec, { chartType: 'line' }>;
export type AreaMarkdownChartSpec = Extract<MarkdownChartSpec, { chartType: 'area' }>;
export type PieMarkdownChartSpec = Extract<MarkdownChartSpec, { chartType: 'pie' | 'doughnut' }>;
export type ScatterMarkdownChartSpec = Extract<MarkdownChartSpec, { chartType: 'scatter' }>;
export type RadarMarkdownChartSpec = Extract<MarkdownChartSpec, { chartType: 'radar' }>;
export type ComboMarkdownChartSpec = Extract<MarkdownChartSpec, { chartType: 'combo' }>;

/** 全部图表类型可能出现的顶层字段，用于区分“未知字段”和“对当前类型不适用的字段”。 */
export const MARKDOWN_CHART_SPEC_FIELD_NAMES: ReadonlySet<string> = new Set(
  MarkdownChartSpecShapeSchema.options.flatMap(option => Object.keys(option.shape)),
);

/** 全部系列类型可能出现的字段。 */
export const MARKDOWN_CHART_SERIES_FIELD_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(BarSeriesSchema.shape),
  ...Object.keys(LineSeriesSchema.shape),
  ...Object.keys(AreaSeriesSchema.shape),
  ...Object.keys(PieSeriesSchema.shape),
  ...Object.keys(ScatterSeriesSchema.shape),
  ...Object.keys(RadarSeriesSchema.shape),
  ...Object.keys(ComboSeriesSchema.shape),
]);
