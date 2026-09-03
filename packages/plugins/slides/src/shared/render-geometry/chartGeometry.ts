import type {
  ChartRenderNode,
  RenderChartLegend,
  RenderChartSeries,
  RenderChartType,
} from '../renderModel';

export interface ChartFrame {
  width: number;
  height: number;
  plotX: number;
  plotY: number;
  plotWidth: number;
  plotHeight: number;
  leftGutter: number;
  topGutter: number;
  rightGutter: number;
  bottomGutter: number;
}

export interface ChartFrameOptions {
  chartType?: RenderChartType;
  categoryAxisLabelFontSizePx?: number;
  valueAxisLabelFontSizePx?: number;
  legendLabelFontSizePx?: number;
  legendItemWidthsPx?: number[];
  xAxisVisible?: boolean;
  yAxisVisible?: boolean;
}

export interface ChartValueRange {
  min: number;
  max: number;
}

export interface ChartPoint {
  x: number;
  y: number;
}

export interface SnappedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RadarPoint extends ChartPoint {
  label: string;
}

export const CHART_LABEL_FONT_FAMILY = 'Arial';
export const CHART_LABEL_FONT_SIZE = 12;
export const CHART_GAP_WIDTH_RATIO = 1.5;

export function resolveChartPalette(node: ChartRenderNode): string[] {
  return node.series.map((series, index) => series.color ?? node.palette[index % node.palette.length]);
}

export function buildChartFrame(
  width: number,
  height: number,
  legend?: RenderChartLegend,
  options?: ChartFrameOptions,
): ChartFrame {
  const categoryAxisLabelFontSizePx = options?.categoryAxisLabelFontSizePx ?? CHART_LABEL_FONT_SIZE;
  const valueAxisLabelFontSizePx = options?.valueAxisLabelFontSizePx ?? CHART_LABEL_FONT_SIZE;
  const legendLabelFontSizePx = options?.legendLabelFontSizePx ?? CHART_LABEL_FONT_SIZE;
  const chartType = options?.chartType;
  const xAxisVisible = options?.xAxisVisible !== false;
  const yAxisVisible = options?.yAxisVisible !== false;

  let leftGutter = chartType === 'bar' && yAxisVisible
    ? Math.max(78, Math.round(categoryAxisLabelFontSizePx * 6.4))
    : (yAxisVisible ? Math.max(52, Math.round(valueAxisLabelFontSizePx * 4.2)) : 20);
  let topGutter = 20;
  let rightGutter = 20;
  let bottomGutter = chartType === 'bar'
    ? (xAxisVisible ? Math.max(42, Math.round(valueAxisLabelFontSizePx + 30)) : 20)
    : (xAxisVisible ? Math.max(44, Math.round(categoryAxisLabelFontSizePx + 32)) : 20);

  if (legend?.visible) {
    const legendBlock = measureLegendBlock(
      width,
      height,
      legend.position ?? 'right',
      options?.legendItemWidthsPx ?? [],
      Math.max(legendLabelFontSizePx + 8, 16),
    );
    switch (legend.position) {
      case 'left':
        leftGutter = Math.max(leftGutter, Math.ceil(legendBlock.width) + 20);
        break;
      case 'bottom':
        bottomGutter += Math.max(34, Math.ceil(legendBlock.height) + 8);
        break;
      case 'top':
        topGutter = Math.max(topGutter, Math.ceil(legendBlock.height) + 14);
        break;
      case 'right':
      default:
        rightGutter = Math.max(rightGutter, Math.ceil(legendBlock.width) + 20);
        break;
    }
  }

  return {
    width,
    height,
    plotX: leftGutter,
    plotY: topGutter,
    plotWidth: Math.max(width - leftGutter - rightGutter, 32),
    plotHeight: Math.max(height - topGutter - bottomGutter, 32),
    leftGutter,
    topGutter,
    rightGutter,
    bottomGutter,
  };
}

/**
 * 测量图例块的占位尺寸。
 * 水平布局(top/bottom)使用 16px 间距，与图表渲染节点中的图例项间距保持一致。
 */
function measureLegendBlock(
  width: number,
  _height: number,
  position: NonNullable<RenderChartLegend['position']>,
  itemWidths: number[],
  rowHeight: number,
): { width: number; height: number } {
  const widths = itemWidths.length > 0 ? itemWidths : [92];
  if (position === 'left' || position === 'right') {
    return {
      width: Math.max(...widths, 92) + 16,
      height: widths.length * rowHeight,
    };
  }

  const maxLineWidth = Math.max(width - 24, 72);
  let currentLineWidth = 0;
  let maxMeasuredLineWidth = 0;
  let lineCount = 1;

  for (const itemWidth of widths) {
    const nextWidth = currentLineWidth === 0 ? itemWidth : currentLineWidth + 16 + itemWidth;
    if (nextWidth > maxLineWidth && currentLineWidth > 0) {
      maxMeasuredLineWidth = Math.max(maxMeasuredLineWidth, currentLineWidth);
      currentLineWidth = itemWidth;
      lineCount += 1;
      continue;
    }
    currentLineWidth = nextWidth;
  }
  maxMeasuredLineWidth = Math.max(maxMeasuredLineWidth, currentLineWidth);

  return {
    width: maxMeasuredLineWidth,
    height: lineCount * rowHeight,
  };
}

export function isRadialChart(chartType: RenderChartType): boolean {
  return chartType === 'pie' || chartType === 'doughnut' || chartType === 'radar';
}

export function resolveSeriesType(node: ChartRenderNode, series: RenderChartSeries): RenderChartType {
  if (node.chartType !== 'combo') {
    return node.chartType;
  }

  return series.chartType ?? 'column';
}

export function buildCartesianRange(node: ChartRenderNode): ChartValueRange {
  if (node.series.length === 0) {
    return applyAxisOverrides({ min: 0, max: 1 }, node);
  }

  const stacking = node.stacking ?? 'none';
  const isBarOrColumn = node.chartType === 'bar' || node.chartType === 'column';

  // 百分比堆叠：范围固定为 0-100。
  if (isBarOrColumn && stacking === 'percent') {
    return applyAxisOverrides({ min: 0, max: 100 }, node);
  }

  // 普通堆叠：按类目求和，负值独立累加到下界。
  if (isBarOrColumn && stacking === 'stacked') {
    let stackMin = 0;
    let stackMax = 0;
    for (let i = 0; i < node.categories.length; i++) {
      let positiveSum = 0;
      let negativeSum = 0;
      for (const series of node.series) {
        const v = series.values[i] ?? 0;
        if (v >= 0) positiveSum += v;
        else negativeSum += v;
      }
      stackMax = Math.max(stackMax, positiveSum);
      stackMin = Math.min(stackMin, negativeSum);
    }
    if (stackMin === 0 && stackMax === 0) stackMax = 1;
    return applyAxisOverrides({ min: stackMin, max: stackMax }, node);
  }

  const values = node.series.flatMap((series) => series.values);
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 0);

  if (rawMin === rawMax) {
    const base = rawMin === 0
      ? { min: 0, max: 1 }
      : { min: Math.min(0, rawMin * 0.8), max: rawMax * 1.2 };
    return applyAxisOverrides(base, node);
  }

  return applyAxisOverrides({
    min: rawMin > 0 ? 0 : rawMin,
    max: rawMax < 0 ? 0 : rawMax,
  }, node);
}

/** 按图表方向读取数值轴 override，覆盖自动计算的范围。 */
function applyAxisOverrides(base: ChartValueRange, node: ChartRenderNode): ChartValueRange {
  // 横向 bar 图的数值轴在 x；其余笛卡尔图的数值轴在 y。
  const valueAxis = node.chartType === 'bar'
    ? node.axes?.x
    : node.axes?.y;
  return {
    min: valueAxis?.min != null ? valueAxis.min : base.min,
    max: valueAxis?.max != null ? valueAxis.max : base.max,
  };
}

export function valueToY(value: number, range: ChartValueRange, frame: ChartFrame): number {
  const denominator = range.max - range.min || 1;
  const ratio = (value - range.min) / denominator;
  return frame.plotY + frame.plotHeight - ratio * frame.plotHeight;
}

export function valueToX(value: number, range: ChartValueRange, frame: ChartFrame): number {
  const denominator = range.max - range.min || 1;
  const ratio = (value - range.min) / denominator;
  return frame.plotX + ratio * frame.plotWidth;
}

export function buildRadarPoints(
  values: readonly number[],
  categories: readonly string[],
  width: number,
  height: number,
): RadarPoint[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(Math.min(width, height) / 2 - 28, 24);
  const maxValue = Math.max(...values, 1);

  return categories.map((label, index) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / Math.max(categories.length, 1));
    const scaledRadius = radius * ((values[index] ?? 0) / maxValue);
    return {
      label,
      x: centerX + Math.cos(angle) * scaledRadius,
      y: centerY + Math.sin(angle) * scaledRadius,
    };
  });
}

export function pointsToFlatArray(points: readonly ChartPoint[]): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

export function buildClusterBarThickness(
  step: number,
  seriesCount: number,
  maxThickness: number,
): number {
  const normalizedSeriesCount = Math.max(seriesCount, 1);
  return Math.min(step / (normalizedSeriesCount + CHART_GAP_WIDTH_RATIO), maxThickness);
}

export function snapStrokeCenter(value: number): number {
  return Math.round(value) + 0.5;
}

export function snapRect(x: number, y: number, width: number, height: number): SnappedRect {
  const left = Math.round(x);
  const top = Math.round(y);
  const right = Math.round(x + width);
  const bottom = Math.round(y + height);

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}
