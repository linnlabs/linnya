import { defaultTextMeasureService } from '@linnya/text-measurement-core';
import { formatChartValue } from '@app/schemas/chart-number-format';
import type { RenderChartAxis, RenderChartLabelStyle, RenderChartLegend, RenderChartType } from '../../renderModel';
import { CHART_DEFAULT_LABEL_FONT_SIZE_PT } from '../../renderModel';
import type { ChartLayoutBox, ResolvedChartLayout } from '../definitions/chartLayout';

export interface ChartLayoutInput {
  width: number;
  height: number;
  chartType: RenderChartType;
  categories: string[];
  series: { name: string; values: number[] }[];
  categoryAxis?: RenderChartAxis;
  valueAxis?: RenderChartAxis;
  legend?: RenderChartLegend;
  /** 饼/环外部标签的最终显示文本；仅为标签预留空间，不修改数据。 */
  outsideLabels?: string[];
}

const EDGE = 8 / 96;
const LABEL_GAP = 8 / 96;

/**
 * 共享的确定性占位规则。portable 文本测量与表格一致，是字宽估算，不能冒充 Office 字形实测。
 * 自动刻度仅参与标签空间预算；这里不产生轴 min/max/majorUnit。
 */
export function resolveChartLayout(input: ChartLayoutInput): ResolvedChartLayout | undefined {
  const { width, height, chartType } = input;
  const radial = chartType === 'pie' || chartType === 'doughnut';
  if (!['bar', 'column', 'line', 'pie', 'doughnut'].includes(chartType)) return undefined;
  // 高密度饼图仍由各引擎避让；有限标签才承诺共享 inner plot。
  if (radial && input.categories.length > 8) return undefined;
  const area = { x: EDGE, y: EDGE, w: width - EDGE * 2, h: height - EDGE * 2 };
  const legend = input.legend?.visible ? placeLegend(input, area) : undefined;
  let categoryTitleGap = 0;
  let valueTitleGap = 0;
  if (radial) {
    if (input.outsideLabels?.length) {
      const labelWidth = Math.max(...input.outsideLabels.map(text => measure(text, input.categoryAxis?.labelStyle).w));
      area.x += labelWidth + LABEL_GAP;
      area.w -= (labelWidth + LABEL_GAP) * 2;
      area.y += fontHeight(input.categoryAxis?.labelStyle);
      area.h -= fontHeight(input.categoryAxis?.labelStyle) * 2;
    }
    const diameter = Math.min(area.w, area.h);
    area.x += (area.w - diameter) / 2;
    area.y += (area.h - diameter) / 2;
    area.w = area.h = diameter;
  } else {
    const horizontal = chartType === 'bar';
    const cat = input.categoryAxis;
    const val = input.valueAxis;
    const categoryBoxes = input.categories.map(text => measure(text, cat?.labelStyle));
    const angle = (cat?.labelRotation ?? 0) * Math.PI / 180;
    const labelWidth = Math.max(0, ...categoryBoxes.map(box => Math.abs(box.w * Math.cos(angle)) + Math.abs(box.h * Math.sin(angle))));
    const labelHeight = Math.max(0, ...categoryBoxes.map(box => Math.abs(box.w * Math.sin(angle)) + Math.abs(box.h * Math.cos(angle))));
    const values = [0, ...input.series.flatMap(series => series.values), val?.min ?? 0, val?.max ?? 0];
    const valueWidth = Math.max(...values.map(value => measure(formatChartValue(value, val?.format ?? 'General'), val?.labelStyle).w));
    // 横向类目标签以右边缘锚定，portable 字宽低估会直接裁掉首字（如 Gamma）。
    // 用半行高保留字形外延；两端共享这份占位，不能让 Office 再自行挤压 plot。
    const catDepth = cat?.visible === false ? 0 : (horizontal ? labelWidth + fontHeight(cat?.labelStyle) / 2 : labelHeight) + LABEL_GAP;
    // 给自动取整后的刻度文本留一个字宽，但不指定其数值或步长。
    const valDepth = val?.visible === false ? 0 : (horizontal ? fontHeight(val?.labelStyle) : valueWidth + fontHeight(val?.labelStyle)) + LABEL_GAP;
    categoryTitleGap = catDepth + fontHeight(cat?.labelStyle) / 2;
    valueTitleGap = valDepth + fontHeight(val?.labelStyle) / 2;
    const catGutter = catDepth + (cat?.title && cat.visible !== false ? fontHeight(cat.labelStyle) + LABEL_GAP : 0);
    const valGutter = valDepth + (val?.title && val.visible !== false ? fontHeight(val.labelStyle) + LABEL_GAP : 0);
    // 水平值轴的首尾刻度居中于端点，左右各需要半个文本宽度。
    const valueEndInset = horizontal && val?.visible !== false ? valueWidth / 2 : 0;
    const leftGutter = horizontal ? Math.max(catGutter, valueEndInset) : valGutter;
    area.x += leftGutter;
    area.w -= leftGutter + valueEndInset;
    area.h -= horizontal ? valGutter : catGutter;
    // 居中的轴标题可能长于绘图区；移动 plot 中心，仍让标题留在 chart 外框内。
    const yTitle = horizontal ? cat : val;
    if (yTitle?.title && yTitle.visible !== false) {
      const minCenter = EDGE + measure(yTitle.title, yTitle.labelStyle).w / 2;
      const shift = Math.max(0, minCenter - (area.y + area.h / 2));
      area.y += shift * 2;
      area.h -= shift * 2;
    }
  }
  if (area.w <= 0 || area.h <= 0) throw new Error('图表空间不足以容纳绘图区、标签和图例，请增大图表或减少标签。');
  return {
    plot: normalize(area, width, height), legend,
    categoryTitleGap, valueTitleGap,
  };
}

function placeLegend(input: ChartLayoutInput, area: ChartLayoutBox): ResolvedChartLayout['legend'] {
  const { width, height } = input;
  const position = input.legend?.position ?? 'right';
  const style = input.legend?.labelStyle;
  const horizontal = position === 'top' || position === 'bottom';
  const radial = input.chartType === 'pie' || input.chartType === 'doughnut';
  const labels = radial ? input.categories : input.series.map(series => series.name);
  if (!labels.length) return undefined;
  const font = (style?.fontSize ?? CHART_DEFAULT_LABEL_FONT_SIZE_PT) / 72;
  const itemGap = font * 0.75;
  const rowHeight = font * 1.4;
  const items = labels.map(label => {
    const text = measure(label, style);
    return { w: text.w + font * 1.65, h: Math.max(rowHeight, text.h) };
  });
  const lines: string[][] = [[]];
  const lengths = [0];
  const crossSizes = [0];
  for (const [index, label] of labels.entries()) {
    const itemLength = horizontal ? items[index].w : items[index].h;
    let line = lines.length - 1;
    const next = lengths[line] + (lines[line].length ? itemGap : 0) + itemLength;
    if (lines[line].length && next > (horizontal ? area.w : area.h)) {
      lines.push([]); lengths.push(0); crossSizes.push(0); line += 1;
    }
    lengths[line] += (lines[line].length ? itemGap : 0) + itemLength;
    crossSizes[line] = Math.max(crossSizes[line], horizontal ? items[index].h : items[index].w);
    lines[line].push(label);
  }
  const along = Math.max(...lengths);
  const across = crossSizes.reduce((sum, size) => sum + size, 0) + (lines.length - 1) * itemGap;
  const w = horizontal ? along : across;
  const h = horizontal ? across : along;
  const x = horizontal ? (width - w) / 2 : position === 'left' ? EDGE : width - EDGE - w;
  const y = horizontal ? position === 'top' ? EDGE : height - EDGE - h : (height - h) / 2;
  if (position === 'left') { area.x += w + EDGE; area.w -= w + EDGE; }
  if (position === 'right') area.w -= w + EDGE;
  if (position === 'top') { area.y += h + EDGE; area.h -= h + EDGE; }
  if (position === 'bottom') area.h -= h + EDGE;
  if (x < 0 || y < 0) throw new Error('图表空间不足以容纳完整图例，请增大图表或缩短图例。');
  return { box: normalize({ x, y, w, h }, width, height), orient: horizontal ? 'horizontal' : 'vertical', lines };
}

function fontHeight(style?: RenderChartLabelStyle): number {
  return (style?.fontSize ?? CHART_DEFAULT_LABEL_FONT_SIZE_PT) / 72 * 1.4;
}

function measure(text: string, style?: RenderChartLabelStyle): { w: number; h: number } {
  const result = defaultTextMeasureService.measure({
    paragraphs: [{ text }],
    style: { fontFamily: style?.fontFamily ?? 'Arial', fontSizePt: style?.fontSize ?? CHART_DEFAULT_LABEL_FONT_SIZE_PT, lineHeightMultiplier: 1.4 },
    box: { widthInches: 1, wrap: 'none', padding: { left: 0, right: 0, top: 0, bottom: 0 } },
    sourceKind: 'generated',
  });
  return { w: result.maxLineWidthInches, h: result.totalHeightInches };
}

function normalize(box: ChartLayoutBox, width: number, height: number): ChartLayoutBox {
  return { x: box.x / width, y: box.y / height, w: box.w / width, h: box.h / height };
}
