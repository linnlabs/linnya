import type PptxGenJS from 'pptxgenjs';
import { formatChartValue } from '@app/schemas/chart-number-format';
import { resolveChartLayout } from '@plugin/slides/shared/chartLayout';
import type { RenderChartLabelStyle } from '@plugin/slides/shared/renderModel';
import type { ChartElement } from './chartOptions';

/** 两条物化路径只在此把 SDK 内部选项投影为共享布局输入。 */
export function resolveGeneratedChartLayout(chart: ChartElement, options: PptxGenJS.IChartOpts) {
  const radial = chart.chartType === 'pie' || chart.chartType === 'doughnut';
  const font = (fontSize?: number, fontFamily?: string): RenderChartLabelStyle => ({ fontSize, fontFamily });
  const dataFont = font(options.dataLabelFontSize, options.dataLabelFontFace);
  const series = chart.data.series[0];
  const values = series?.values ?? [];
  const total = values.reduce((sum, value) => sum + value, 0);
  const labelsVisible = series?.showDataLabels ?? (options.showValue === true || options.showLabel === true || options.showPercent === true);
  // PowerPoint 的环图标签只能在环内，预留外部标签空间会让预览和导出分叉。
  const outside = chart.chartType !== 'doughnut'
    && options.dataLabelPosition !== 'ctr' && options.dataLabelPosition !== 'inEnd';
  const positions = { t: 'top', b: 'bottom', l: 'left', r: 'right', tr: 'right' } as const;
  return resolveChartLayout({
    width: chart.position.w, height: chart.position.h,
    chartType: chart.chartType === 'bar' ? options.barDir === 'bar' ? 'bar' : 'column' : chart.chartType,
    categories: chart.data.categories, series: chart.data.series,
    categoryAxis: {
      title: options.showCatAxisTitle ? options.catAxisTitle : undefined,
      visible: !options.catAxisHidden, labelRotation: options.catAxisLabelRotate,
      labelStyle: radial ? dataFont : font(options.catAxisLabelFontSize, options.catAxisLabelFontFace),
    },
    valueAxis: {
      title: options.showValAxisTitle ? options.valAxisTitle : undefined,
      visible: !options.valAxisHidden, min: options.valAxisMinVal, max: options.valAxisMaxVal,
      format: options.valAxisLabelFormatCode,
      labelStyle: font(options.valAxisLabelFontSize, options.valAxisLabelFontFace),
    },
    legend: { visible: options.showLegend === true, position: positions[options.legendPos ?? 'r'], labelStyle: font(options.legendFontSize, options.legendFontFace) },
    outsideLabels: radial && labelsVisible && outside ? chart.data.categories.map((category, index) =>
      chart.dataLabelContent === 'category' ? category : formatChartValue(
        chart.dataLabelContent === 'percentage' ? total === 0 ? 0 : (values[index] ?? 0) / total : values[index] ?? 0,
        series?.dataLabelFormat ?? options.dataLabelFormatCode ?? 'General',
      )) : undefined,
  });
}
