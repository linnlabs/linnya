import type PptxGenJS from 'pptxgenjs';
import type { ChartSeries, ChartType, ThemeSpec } from '@plugin/slides/shared';
import { mapPosition, resolveChartPalette, stripHash } from '../visual/presentationVisualDefaults';
import { resolveChartOptions, type ChartElement } from './chartOptions';

export interface ChartPptxPatch {
  slideIndex: number;
  marker: string;
  labelPosition?: PptxGenJS.IChartOpts['dataLabelPosition'];
  labelContent?: ChartElement['dataLabelContent'];
  series: { source: ChartSeries; order: number; type: ChartType; color: string }[];
}
export interface ChartPptxContext { slideIndex: number; plan: ChartPptxPatch[] }

/** 同类型、同轴的系列必须留在同一原生 chart group，不能为逐系列样式拆散堆叠/簇状柱。 */
export function addNativeChart(
  slide: PptxGenJS.Slide,
  chart: ChartElement,
  theme?: ThemeSpec,
  context?: ChartPptxContext,
): void {
  const palette = resolveChartPalette(theme).map(c => stripHash(c, 'chart.palette'));
  const options = { ...mapPosition(chart.position), chartColors: palette, ...resolveChartOptions(chart) };
  const groups: { type: Exclude<ChartType, 'combo'>; axis: 'primary' | 'secondary'; series: ChartPptxPatch['series'] }[] = [];
  chart.data.series.forEach((source, order) => {
    const type = source.chartType ?? chart.chartType;
    if (type === 'combo') throw new Error('combo 系列必须声明 chartType。');
    const axis = source.axis ?? 'primary';
    let group = groups.find(g => g.type === type && g.axis === axis);
    if (!group) { group = { type, axis, series: [] }; groups.push(group); }
    group.series.push({ source, order, type, color: source.color ? stripHash(source.color, 'series.color') : palette[order % palette.length] });
  });
  const entries = groups.flatMap(g => g.series);
  const requiresSeriesPatch = chart.chartType === 'combo' || chart.dataLabelPosition || chart.dataLabelContent || entries.some(({ source, order }, index) =>
    order !== index || source.pointColors || source.lineWidth != null || source.lineDash || source.marker
    || source.showDataLabels != null || source.dataLabelFormat != null,
  );
  if (requiresSeriesPatch) {
    if (!context) throw new Error('图表系列样式需要正式 PPTX materialization context。');
    options.objectName = `linnya-chart:${context.slideIndex}:${context.plan.length}`;
    context.plan.push({ slideIndex: context.slideIndex, marker: options.objectName, series: entries,
      labelPosition: chart.dataLabelPosition ? options.dataLabelPosition : undefined,
      labelContent: chart.dataLabelContent,
    });
  }
  const data = (entries: ChartPptxPatch['series']): PptxGenJS.OptsChartData[] => entries.map(({ source }) => ({
    name: source.name, labels: source.labels.length ? source.labels : chart.data.categories, values: source.values,
  }));
  if (chart.chartType !== 'combo') {
    // 饼/环的 palette 按扇区取色；其他图按系列取色。
    if (chart.chartType !== 'pie' && chart.chartType !== 'doughnut') options.chartColors = entries.map(s => s.color);
    else if (entries[0]?.source.color) options.chartColors = [entries[0].color];
    slide.addChart(chart.chartType, data(entries), options);
    return;
  }
  const multi: PptxGenJS.IChartMulti[] = groups.map(group => ({
    type: group.type,
    data: data(group.series),
    options: {
      chartColors: group.series.map(s => s.color),
      secondaryValAxis: group.axis === 'secondary',
      secondaryCatAxis: group.axis === 'secondary',
      // 组合图没有全局 dataLabelPosition；按系列族转换，避免 outEnd 被折线丢弃。
      ...(chart.dataLabelPosition ? {
        dataLabelPosition: chart.dataLabelPosition === 'center' ? 'ctr'
          : group.type === 'line' ? (chart.dataLabelPosition === 'outside' ? 't' : 'b')
            : chart.dataLabelPosition === 'outside' ? 'outEnd' : 'inEnd',
      } : {}),
    },
  }));
  if (chart.secondaryValueAxis) options.catAxes = [{}, { catAxisHidden: true, showCatAxisTitle: false }];
  // SDK 在 multi 模式读取第二参数 || 第三参数；空数组会吞掉正式 options。
  slide.addChart(multi, undefined, options);
}
