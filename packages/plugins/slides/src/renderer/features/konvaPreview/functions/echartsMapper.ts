/**
 * ChartRenderNode → ECharts Option 映射层
 *
 * 将后端 RenderModel 中的图表节点转换为 ECharts 配置对象，
 * 由 renderChartResources feature 消费，替代手写 Konva 图表渲染。
 *
 * 设计原则：
 * - 前端预览不追求像素级匹配 PPT，但必须"看起来是正确的图表"
 * - 标签碰撞、堆叠标签居中、图例换行等边界场景交给 ECharts 内置逻辑
 * - 颜色、字体、间距尽量对齐 PPT 风格
 */

import type {
  ChartPptxHints,
  ChartRenderNode,
  RenderChartLabelStyle,
  RenderChartType,
} from '../../../types/render';
import { CHART_DEFAULT_LABEL_FONT_SIZE_PT } from '@plugin/slides/shared/renderModel';
import { SLIDES_RENDER_COLORS } from '../../../shared/constants';

// ─── 常量 ────────────────────────────────────────────────────────────────

/** pt → px 转换系数（96 DPI / 72 pt/in） */
const POINTS_TO_PX = 96 / 72;

const CHART_BG = 'transparent';

/**
 * PPT（PptxGenJS）视觉默认值对照表。
 * 所有数值来自 PptxGenJS 4.0.1 源码（dist/pptxgen.es.js）中的实际常量。
 * echartsMapper 的所有 fallback 值都从此表读取，不再使用 ECharts 自身的默认值体系。
 */
const PPT = {
  /** DEF_CHART_GRIDLINE.color — 轴线和网格线共用 */
  axisLineColor: SLIDES_RENDER_COLORS.chartAxisStroke,
  gridLineColor: SLIDES_RENDER_COLORS.chartGridLine,
  /** DEF_FONT_COLOR — 标签、图例、数据标签文字色 */
  labelColor: SLIDES_RENDER_COLORS.chartLabelFill,
  dataLabelColor: SLIDES_RENDER_COLORS.chartDataLabelFill,
  /** 图表内标签/轴/图例的默认字号（pt） */
  defaultFontSizePt: CHART_DEFAULT_LABEL_FONT_SIZE_PT,
  /** 非堆叠柱状图的默认 barGapWidthPct（dist ~1828 行） */
  barGapWidthPct: 150,
  /** 堆叠柱状图的默认 barGapWidthPct（dist ~1744 行） */
  barGapWidthPctStacked: 50,
  /** 环形图默认内孔百分比（dist ~4384 行） */
  doughnutHoleSize: 50,
  /** 折线默认线宽 pt（types @default 2） */
  lineWidthPt: 2,
} as const;

// ─── 主入口 ──────────────────────────────────────────────────────────────

export function mapChartNodeToEChartsOption(
  node: ChartRenderNode,
): Record<string, unknown> {
  if (node.series.length === 0) {
    return { animation: false, backgroundColor: CHART_BG };
  }

  const palette = resolveColorPalette(node);
  // 饼图/甜甜圈按 categories 数量取色（每个扇区一个颜色），而非按 series
  const piePalette = node.categories.map((_cat, idx) =>
    node.palette[idx % node.palette.length],
  );

  switch (node.chartType) {
    case 'pie': return buildPieChart(node, piePalette, ['0%', '70%']);
    case 'doughnut': {
      const hole = node.pptxHints?.holeSize ?? 50;
      // PPT holeSize 是相对于图表直径的比例，需换算为 ECharts 绝对半径
      const outerPct = 58;
      const innerPct = Math.round(hole * outerPct / 100);
      return buildPieChart(node, piePalette, [`${innerPct}%`, `${outerPct}%`]);
    }
    case 'radar': return buildRadarChart(node, palette);
    default: return buildCartesianChart(node, palette);
  }
}

// ─── 笛卡尔坐标系图表（bar / column / line / area / scatter / combo） ────

function buildCartesianChart(
  node: ChartRenderNode,
  palette: string[],
): Record<string, unknown> {
  const isBar = node.chartType === 'bar';
  const stacking = node.stacking ?? 'none';
  const isStacked = stacking === 'stacked' || stacking === 'percent';
  const isPercent = stacking === 'percent';

  const seriesValues = isPercent
    ? computePercentValues(node)
    : node.series.map(s => [...s.values]);

  const hints = node.pptxHints;

  const series = node.series.map((s, idx) => {
    const seriesType = resolveEChartsSeriesType(node.chartType, s.chartType);
    const values = seriesValues[idx] ?? [];

    const item: Record<string, unknown> = {
      name: s.name,
      type: seriesType,
      data: values,
      itemStyle: { color: palette[idx % palette.length] },
      label: buildSeriesLabel(node, isBar, isStacked),
    };

    if (isStacked) item.stack = 'total';

    // 柱状图间距：从 pptxHints 读取，PPT 堆叠/非堆叠默认值不同
    if (seriesType === 'bar') {
      item.barGap = resolveBarGap(hints, isStacked);
      item.barCategoryGap = resolveBarCategoryGap(hints);
    }

    // 面积图
    if (node.chartType === 'area' || s.chartType === 'area') {
      item.areaStyle = { opacity: 0.3 };
    }

    // 折线图样式
    if (seriesType === 'line') {
      item.symbol = 'circle';
      item.symbolSize = 6;
      const lineWidth = (hints?.lineSize ?? PPT.lineWidthPt) * POINTS_TO_PX;
      item.lineStyle = { width: lineWidth };
      if (hints?.lineSmooth) {
        item.smooth = true;
      }
    }

    if (seriesType === 'scatter') {
      item.symbolSize = 10;
    }

    return item;
  });

  // ── 类目轴 ──
  const catAxisConfig = isBar ? node.axes?.y : node.axes?.x;
  const catFont = resolveFontStyle(
    isBar ? node.axes?.y?.labelStyle : node.axes?.x?.labelStyle,
    node.labelStyle,
  );
  // catAxisOrientation: 'maxMin' → inverse，'minMax' → 正序；横向 bar 默认反向
  const shouldInverse = hints?.catAxisOrientation === 'maxMin'
    || (hints?.catAxisOrientation == null && isBar);

  const categoryAxis: Record<string, unknown> = {
    type: 'category',
    data: node.categories,
    axisLine: { show: true, lineStyle: { color: PPT.axisLineColor } },
    axisTick: { show: false },
    axisLabel: {
      show: catAxisConfig?.visible !== false,
      color: catFont.color ?? PPT.labelColor,
      fontSize: catFont.fontSize,
      fontFamily: catFont.fontFamily,
    },
    ...(shouldInverse ? { inverse: true } : {}),
  };

  // ── 数值轴 ──
  const valAxisConfig = isBar ? node.axes?.x : node.axes?.y;
  const valFont = resolveFontStyle(
    isBar ? node.axes?.x?.labelStyle : node.axes?.y?.labelStyle,
    node.labelStyle,
  );
  const valueAxis: Record<string, unknown> = {
    type: 'value',
    axisLine: { show: true, lineStyle: { color: PPT.axisLineColor } },
    axisLabel: {
      show: valAxisConfig?.visible !== false,
      color: valFont.color ?? PPT.labelColor,
      fontSize: valFont.fontSize,
      fontFamily: valFont.fontFamily,
    },
    splitLine: {
      show: isBar
        ? node.gridlines?.x?.visible !== false
        : node.gridlines?.y?.visible !== false,
      lineStyle: {
        color: isBar
          ? node.gridlines?.x?.color ?? PPT.gridLineColor
          : node.gridlines?.y?.color ?? PPT.gridLineColor,
      },
    },
  };

  if (valAxisConfig?.min != null) valueAxis.min = valAxisConfig.min;
  if (valAxisConfig?.max != null) valueAxis.max = valAxisConfig.max;
  if (isPercent) {
    valueAxis.min = 0;
    valueAxis.max = 100;
  }

  // ── Combo 双 Y 轴 ──
  let xAxis: unknown;
  let yAxis: unknown;

  if (isBar) {
    xAxis = valueAxis;
    yAxis = categoryAxis;
  } else if (node.chartType === 'combo' && node.axes?.y2) {
    xAxis = categoryAxis;
    const y2Font = resolveFontStyle(node.axes.y2.labelStyle, node.labelStyle);
    yAxis = [
      valueAxis,
      {
        type: 'value',
        axisLine: { show: true, lineStyle: { color: PPT.axisLineColor } },
        axisLabel: {
          show: node.axes.y2.visible !== false,
          color: y2Font.color ?? PPT.labelColor,
          fontSize: y2Font.fontSize,
        },
        splitLine: { show: false },
      },
    ];
    // 把非 bar/column 系列分配到第二 Y 轴
    series.forEach((s, idx) => {
      const orig = node.series[idx];
      if (orig?.chartType === 'line' || orig?.chartType === 'area') {
        s.yAxisIndex = 1;
      }
    });
  } else {
    xAxis = categoryAxis;
    yAxis = valueAxis;
  }

  return {
    animation: false,
    backgroundColor: CHART_BG,
    color: palette,
    grid: buildGrid(node),
    xAxis,
    yAxis,
    series,
    legend: buildLegendConfig(node),
  };
}

// ─── 饼图 / 甜甜圈 ──────────────────────────────────────────────────────

function buildPieChart(
  node: ChartRenderNode,
  palette: string[],
  radius: [string, string],
): Record<string, unknown> {
  const firstSeries = node.series[0];
  if (!firstSeries) return { animation: false, backgroundColor: CHART_BG };

  const data = node.categories.map((name, idx) => ({
    name,
    value: Math.max(firstSeries.values[idx] ?? 0, 0),
    itemStyle: { color: palette[idx % palette.length] },
  }));

  const dlVisible = node.dataLabels?.visible === true;
  const dlFormat = node.dataLabels?.format;
  const dlFont = resolveFontStyle(node.dataLabels?.labelStyle, node.labelStyle);

  return {
    animation: false,
    backgroundColor: CHART_BG,
    color: palette,
    series: [{
      type: 'pie',
      data,
      radius,
      center: ['50%', '50%'],
      label: {
        show: dlVisible,
        color: dlFont.color ?? node.pptxHints?.dataLabelColor ?? PPT.dataLabelColor,
        fontSize: dlFont.fontSize,
        fontFamily: dlFont.fontFamily,
        formatter: dlVisible
          ? (params: Record<string, unknown>) => {
            const value = typeof params.value === 'number' ? params.value : 0;
            const name = typeof params.name === 'string' ? params.name : '';
            if (dlFormat) return formatDataLabelValue(value, dlFormat);
            return `${name}: ${value}`;
          }
          : undefined,
      },
      labelLine: { show: dlVisible },
    }],
    legend: buildLegendConfig(node),
  };
}

// ─── 雷达图 ──────────────────────────────────────────────────────────────

function buildRadarChart(
  node: ChartRenderNode,
  palette: string[],
): Record<string, unknown> {
  // 统一使用全局最大值做雷达图刻度，与 PPT 行为一致
  const globalMax = Math.max(
    ...node.series.flatMap(s => s.values.map(Math.abs)),
    1,
  );

  const indicator = node.categories.map(name => ({
    name,
    max: globalMax,
  }));

  // PPT 默认雷达图只有线条无填充，仅 'filled' 模式才有面积填充
  const radarStyle = node.pptxHints?.radarStyle ?? 'standard';

  const radarData = node.series.map((s, idx) => {
    const color = palette[idx % palette.length];
    const item: Record<string, unknown> = {
      name: s.name,
      value: s.values,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      symbol: 'none',
      symbolSize: 0,
    };
    if (radarStyle === 'filled') {
      item.areaStyle = { color, opacity: 0.5 };
    }
    if (radarStyle === 'marker') {
      item.symbol = 'circle';
      item.symbolSize = 6;
    }
    return item;
  });

  const labelFont = resolveFontStyle(node.labelStyle);

  return {
    animation: false,
    backgroundColor: CHART_BG,
    color: palette,
    radar: {
      indicator,
      shape: 'polygon' as const,
      // PPT 雷达图不显示刻度数值标签
      axisLabel: { show: false },
      axisLine: { lineStyle: { color: PPT.axisLineColor } },
      splitLine: {
        lineStyle: {
          color: node.gridlines?.y?.color ?? node.gridlines?.x?.color ?? PPT.gridLineColor,
        },
      },
      splitArea: { show: false },
      // 维度名称字体
      axisName: {
        color: node.axes?.x?.labelStyle?.color ?? node.labelStyle?.color ?? PPT.labelColor,
        fontSize: labelFont.fontSize,
        fontFamily: labelFont.fontFamily,
      },
    },
    series: [{
      type: 'radar',
      data: radarData,
    }],
    legend: buildLegendConfig(node),
  };
}

// ─── Grid 布局 ───────────────────────────────────────────────────────────

function buildGrid(node: ChartRenderNode): Record<string, unknown> {
  const legendVisible = node.legend?.visible === true;
  const pos = node.legend?.position ?? 'right';

  return {
    containLabel: true,
    left: legendVisible && pos === 'left' ? '18%' : '5%',
    right: legendVisible && pos === 'right' ? '18%' : '5%',
    top: legendVisible && pos === 'top' ? '18%' : '8%',
    bottom: legendVisible && pos === 'bottom' ? '18%' : '10%',
  };
}

// ─── 图例 ────────────────────────────────────────────────────────────────

function buildLegendConfig(node: ChartRenderNode): Record<string, unknown> {
  if (!node.legend?.visible) return { show: false };

  const pos = node.legend.position ?? 'right';
  const font = resolveFontStyle(node.legend.labelStyle);

  const config: Record<string, unknown> = {
    show: true,
    data: node.series.map(s => s.name),
    textStyle: {
      fontSize: font.fontSize,
      fontFamily: font.fontFamily,
      color: PPT.labelColor,
    },
    itemWidth: Math.max(Math.round(font.fontSize * 0.9), 8),
    itemHeight: Math.max(Math.round(font.fontSize * 0.7), 6),
  };

  // 饼图/甜甜圈图例数据来自 categories
  if (node.chartType === 'pie' || node.chartType === 'doughnut') {
    config.data = node.categories;
  }

  switch (pos) {
    case 'top':
      config.top = 0;
      config.left = 'center';
      config.orient = 'horizontal';
      break;
    case 'bottom':
      config.bottom = 0;
      config.left = 'center';
      config.orient = 'horizontal';
      break;
    case 'left':
      config.left = 0;
      config.top = 'middle';
      config.orient = 'vertical';
      break;
    default:
      config.right = 0;
      config.top = 'middle';
      config.orient = 'vertical';
      break;
  }

  return config;
}

// ─── 数据标签 ────────────────────────────────────────────────────────────

function buildSeriesLabel(
  node: ChartRenderNode,
  isBar: boolean,
  isStacked: boolean,
): Record<string, unknown> {
  if (!node.dataLabels?.visible) return { show: false };

  const pos = node.dataLabels.position ?? (isStacked ? 'inside' : 'outside');
  const format = node.dataLabels.format;
  const font = resolveFontStyle(node.dataLabels.labelStyle, node.labelStyle);

  // 映射 position 到 ECharts 标签位置
  let echartsPosition: string;
  if (pos === 'inside' || pos === 'center' || isStacked) {
    echartsPosition = 'inside';
  } else if (isBar) {
    echartsPosition = 'right';
  } else {
    echartsPosition = 'top';
  }

  const labelConfig: Record<string, unknown> = {
    show: true,
    position: echartsPosition,
    fontSize: font.fontSize,
    fontFamily: font.fontFamily,
    formatter: format
      ? (params: Record<string, unknown>) => {
        const val = typeof params.value === 'number' ? params.value : 0;
        return formatDataLabelValue(val, format);
      }
      : undefined,
  };

  labelConfig.color = font.color ?? node.pptxHints?.dataLabelColor ?? PPT.dataLabelColor;

  return labelConfig;
}

// ─── 数据处理 ────────────────────────────────────────────────────────────

/** 百分比堆叠：将各系列值转换为占该类目总量的百分比 */
function computePercentValues(node: ChartRenderNode): number[][] {
  const catCount = node.categories.length;
  const totals: number[] = [];
  for (let i = 0; i < catCount; i++) {
    totals.push(
      node.series.reduce((sum, s) => sum + Math.abs(s.values[i] ?? 0), 0) || 1,
    );
  }
  return node.series.map(s =>
    s.values.map((v, i) => (v / (totals[i] ?? 1)) * 100),
  );
}

function resolveColorPalette(node: ChartRenderNode): string[] {
  return node.series.map((s, idx) =>
    s.color ?? node.palette[idx % node.palette.length],
  );
}

/** 将我们的图表类型映射到 ECharts series type */
function resolveEChartsSeriesType(
  chartType: RenderChartType,
  seriesChartType?: RenderChartType,
): string {
  // combo 图表中各系列可以有不同类型
  if (chartType === 'combo') {
    const t = seriesChartType ?? 'column';
    if (t === 'column' || t === 'bar') return 'bar';
    if (t === 'area') return 'line';
    return t;
  }

  if (chartType === 'bar' || chartType === 'column') return 'bar';
  if (chartType === 'area') return 'line';
  return chartType;
}

// ─── 字体与格式化 ────────────────────────────────────────────────────────

interface FontStyle {
  fontSize: number;
  fontFamily: string;
  color?: string;
}

function resolveFontStyle(
  primary?: RenderChartLabelStyle | null,
  fallback?: RenderChartLabelStyle | null,
): FontStyle {
  const rawSizePt = primary?.fontSize ?? fallback?.fontSize ?? PPT.defaultFontSizePt;
  return {
    fontSize: Math.round(rawSizePt * POINTS_TO_PX),
    fontFamily: primary?.fontFamily ?? fallback?.fontFamily ?? 'Arial',
    color: primary?.color ?? fallback?.color,
  };
}

// ─── pptxHints → ECharts 柱状图间距 ─────────────────────────────────────

/**
 * PPT barGapWidthPct 含义：同类目柱子之间的间距占柱宽的百分比。
 * ECharts barGap 含义完全一致，因此可以直接使用。
 * PPT 默认值：非堆叠 150（柱间距 = 1.5 倍柱宽），堆叠 50。
 */
function resolveBarGap(hints?: ChartPptxHints, isStacked = false): string {
  if (hints?.barGapWidthPct != null) {
    return `${hints.barGapWidthPct}%`;
  }
  const defaultPct = isStacked ? PPT.barGapWidthPctStacked : PPT.barGapWidthPct;
  return `${defaultPct}%`;
}

/**
 * barCategoryGap 控制类目之间的留白。
 * PPT 没有独立的 categoryGap 参数（其 barGapWidthPct 已包含间距语义），
 * 这里设置一个视觉上与 PPT 接近的固定值。
 */
function resolveBarCategoryGap(hints?: ChartPptxHints): string {
  if (hints?.barOverlapPct != null) {
    const gap = Math.max(0, 50 - hints.barOverlapPct);
    return `${Math.round(gap)}%`;
  }
  return '20%';
}

/**
 * 数据标签值格式化，兼容 PptxGenJS 常见格式码：
 * - '$#,##0.0'   → '$1,234.5'
 * - '$#,##0.0"B"' → '$1,234.5B'
 * - '#0"%"'      → '42%'
 * - '#,##0.0'    → '1,234.5'
 * - '#,##0'      → '1,234'
 * - '0.0%'       → '42.0%'（乘以 100 再加 %）
 */
export function formatDataLabelValue(value: number, format: string): string {
  // 百分比格式（0.0% 类 — 值乘 100）
  if (format.includes('%') && !format.includes('"')) {
    const decimals = (format.match(/\.(0+)/) ?? [])[1]?.length ?? 0;
    return (value * 100).toFixed(decimals) + '%';
  }
  // 引号百分比（"%"）
  if (format.includes('"%"')) {
    return Math.round(value) + '%';
  }

  // 通用数字格式：提取前缀（如 $）、引号后缀（如 "B"）、小数位
  const prefix = extractFormatPrefix(format);
  const suffix = extractFormatSuffix(format);

  if (format.includes('#,##0.0')) {
    const formatted = value.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${prefix}${formatted}${suffix}`;
  }
  if (format.includes('#,##0')) {
    const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return `${prefix}${formatted}${suffix}`;
  }

  const base = Number.isInteger(value) ? `${value}` : value.toFixed(1);
  return `${prefix}${base}${suffix}`;
}

/** 提取格式码的字面前缀，如 '$#,##0.0' → '$' */
function extractFormatPrefix(format: string): string {
  const match = format.match(/^([^#0]+?)(?=[#0])/);
  return match?.[1] ?? '';
}

/** 提取格式码的引号后缀，如 '$#,##0.0"B"' → 'B' */
function extractFormatSuffix(format: string): string {
  const match = format.match(/"([^"]+)"\s*$/);
  return match?.[1] ?? '';
}
