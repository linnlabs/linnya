import type PptxGenJS from 'pptxgenjs';
import type { LayoutChartValueAxis, StructuredElement } from '@plugin/slides/shared';
import { CHART_DEFAULT_LABEL_FONT_SIZE_PT } from '@plugin/slides/shared/renderModel';
import { stripHash } from '../visual/presentationVisualDefaults';

export type ChartElement = Extract<StructuredElement, { type: 'chart' }>;

/** 预设/内部选项是基线，公开语义最后覆盖；generated preview 与 exporter 共享此解析。 */
export function resolveChartOptions(chart: ChartElement): PptxGenJS.IChartOpts {
  const fontSize = CHART_DEFAULT_LABEL_FONT_SIZE_PT;
  const options: PptxGenJS.IChartOpts = {
    catAxisLabelFontSize: fontSize, valAxisLabelFontSize: fontSize,
    catAxisTitleFontSize: fontSize, valAxisTitleFontSize: fontSize,
    dataLabelFontSize: fontSize, legendFontSize: fontSize, showPercent: false,
    ...chart.options,
  };
  const style = chart.chartStyle;
  if (style) {
    if (style.fontFamily) {
      options.catAxisLabelFontFace = options.valAxisLabelFontFace = options.dataLabelFontFace = options.legendFontFace = style.fontFamily;
      options.catAxisTitleFontFace = options.valAxisTitleFontFace = style.fontFamily;
    }
    if (style.legendColor) options.legendColor = stripHash(style.legendColor, 'chartStyle.legendColor');
    if (style.plotBackgroundColor) options.plotArea = { fill: { color: stripHash(style.plotBackgroundColor, 'chartStyle.plotBackgroundColor') } };
    if (style.seriesLineWidth != null) options.lineSize = style.seriesLineWidth;
    const categoryColor = style.categoryAxisLabelColor ?? style.axisLabelColor;
    const valueColor = style.valueAxisLabelColor ?? style.axisLabelColor;
    if (categoryColor) options.catAxisLabelColor = stripHash(categoryColor, 'chartStyle.categoryAxisLabelColor');
    if (valueColor) options.valAxisLabelColor = stripHash(valueColor, 'chartStyle.valueAxisLabelColor');
    if (style.dataLabelColor) options.dataLabelColor = stripHash(style.dataLabelColor, 'chartStyle.dataLabelColor');
    if (style.gridlineColor) {
      options.catGridLine = { color: stripHash(style.gridlineColor, 'chartStyle.gridlineColor') };
      options.valGridLine = { color: stripHash(style.gridlineColor, 'chartStyle.gridlineColor') };
    }
    const catSize = style.categoryAxisLabelFontSize ?? style.axisLabelFontSize;
    const valSize = style.valueAxisLabelFontSize ?? style.axisLabelFontSize;
    if (catSize != null) options.catAxisLabelFontSize = options.catAxisTitleFontSize = catSize;
    if (valSize != null) options.valAxisLabelFontSize = options.valAxisTitleFontSize = valSize;
    if (style.legendFontSize != null) options.legendFontSize = style.legendFontSize;
    if (style.dataLabelFontSize != null) options.dataLabelFontSize = style.dataLabelFontSize;
  }
  if (chart.categoryAxis) {
    const axis = chart.categoryAxis;
    if (axis.title != null) { options.catAxisTitle = axis.title; options.showCatAxisTitle = true; }
    if (axis.visible != null) options.catAxisHidden = !axis.visible;
    if (axis.labelRotation != null) options.catAxisLabelRotate = axis.labelRotation;
  }
  const primaryAxis = mapValueAxisOptions(chart.valueAxis);
  if (primaryAxis.valGridLine) primaryAxis.valGridLine = { ...options.valGridLine, ...primaryAxis.valGridLine };
  Object.assign(options, primaryAxis);
  if (chart.secondaryValueAxis) {
    // SDK 合并公共 options 与每根轴；右轴不能继承左轴的量纲、范围和标题。
    options.valAxes = [{}, {
      valAxisTitle: undefined, showValAxisTitle: false, valAxisHidden: false,
      valAxisMinVal: undefined, valAxisMaxVal: undefined, valAxisMajorUnit: undefined,
      valAxisLabelFormatCode: 'General', valGridLine: { style: 'none' },
      ...mapValueAxisOptions(chart.secondaryValueAxis),
    }];
    if (chart.secondaryValueAxis.showGridlines === true) options.valAxes[1].valGridLine = { ...options.valGridLine, style: 'solid' };
  }
  if (chart.stacking != null) {
    options.barGrouping = chart.stacking === 'percent' ? 'percentStacked' : chart.stacking === 'stacked' ? 'stacked' : 'clustered';
    options.barOverlapPct = chart.stacking === 'none' ? 0 : 100;
  }
  if (options.barGrouping === 'percentStacked') {
    options.valAxisLabelFormatCode = chart.valueAxis?.numberFormat ?? '0%';
  }
  if (chart.dataLabelContent != null) {
    const visible = options.showValue !== false;
    options.showValue = visible && chart.dataLabelContent === 'value';
    options.showPercent = visible && chart.dataLabelContent === 'percentage';
    options.showLabel = visible && chart.dataLabelContent === 'category';
  }
  options.dataLabelFormatCode ??= chart.dataLabelContent === 'percentage' ? '0%' : 'General';
  if (chart.dataLabelPosition) {
    const pos = chart.dataLabelPosition;
    const line = chart.chartType === 'line' || chart.chartType === 'scatter';
    options.dataLabelPosition = pos === 'center' ? 'ctr' : line ? (pos === 'outside' ? 't' : 'b') : (pos === 'outside' ? 'outEnd' : 'inEnd');
  }
  return options;
}

export function mapValueAxisOptions(axis?: LayoutChartValueAxis): PptxGenJS.IChartPropsAxisVal {
  if (!axis) return {};
  return {
    ...(axis.title != null ? { valAxisTitle: axis.title, showValAxisTitle: true } : {}),
    ...(axis.visible != null ? { valAxisHidden: !axis.visible } : {}),
    ...(axis.min != null ? { valAxisMinVal: axis.min } : {}),
    ...(axis.max != null ? { valAxisMaxVal: axis.max } : {}),
    ...(axis.majorUnit != null ? { valAxisMajorUnit: axis.majorUnit } : {}),
    ...(axis.numberFormat ? { valAxisLabelFormatCode: axis.numberFormat } : {}),
    ...(axis.showGridlines != null ? { valGridLine: { style: axis.showGridlines ? 'solid' : 'none' } } : {}),
  };
}
