/**
 * 图表预设注册表（Chart Preset Registry）
 *
 * 为每种图表类型提供精调过的 PptxGenJS IChartOpts 子集。
 * Agent 通过 chartPreset 字段选择预设，tool 层自动展开为 chartOptions，
 * 下游 StructuredCompiler / pptxHints / echartsMapper 管线完全不变。
 *
 * 预设的 options 值与 PPT_DEFAULTS 常量表对齐，保证 pptxHints 自动透传后
 * 前端 ECharts 渲染与 PPT 导出视觉一致。
 */

import type { ChartType, LayoutChartPresetName } from '@plugin/slides/shared';

// ─── 类型定义 ──────────────────────────────────────────────────────────────

export interface ChartPreset {
  /** 预设对应的图表类型 */
  chartType: ChartType;
  /** 精调过的 PptxGenJS IChartOpts 子集 */
  options: Record<string, unknown>;
  /** Agent 可读的简短描述 */
  label: string;
}

// ─── 共用字号常量 ─────────────────────────────────────────────────────────

/** 所有预设共用的字号设置，确保 PPT 导出和 ECharts 前端一致 */
const FONT = {
  catAxisLabelFontSize: 8,
  valAxisLabelFontSize: 8,
  dataLabelFontSize: 8,
  legendFontSize: 7,
} as const;

/** 所有预设名称列表，供 tool schema enum 使用 */
export const CHART_PRESET_NAMES = [
  'clean-column',
  'stacked-column',
  'horizontal-bar',
  'stacked-bar',
  'smooth-line',
  'straight-line',
  'area',
  'pie',
  'doughnut',
  'radar',
  'radar-filled',
  'scatter',
] as const satisfies readonly LayoutChartPresetName[];

const chartPresetListIsComplete: Exclude<
  LayoutChartPresetName,
  typeof CHART_PRESET_NAMES[number]
> extends never ? true : never = true;
void chartPresetListIsComplete;

export type ChartPresetName = LayoutChartPresetName;

// ─── 预设常量表 ────────────────────────────────────────────────────────────

export const CHART_PRESETS = {
  // ── 柱状图族 ──

  'clean-column': {
    chartType: 'bar',
    options: {
      ...FONT,
      barGapWidthPct: 150,
    },
    label: '简洁纵向柱状图',
  },

  'stacked-column': {
    chartType: 'bar',
    options: {
      ...FONT,
      barGrouping: 'stacked',
      barGapWidthPct: 50,
    },
    label: '堆叠纵向柱状图',
  },

  'horizontal-bar': {
    chartType: 'bar',
    options: {
      ...FONT,
      barDir: 'bar',
      barGapWidthPct: 150,
      catAxisOrientation: 'maxMin',
    },
    label: '水平柱状图',
  },

  'stacked-bar': {
    chartType: 'bar',
    options: {
      ...FONT,
      barDir: 'bar',
      barGrouping: 'stacked',
      barGapWidthPct: 50,
      catAxisOrientation: 'maxMin',
    },
    label: '水平堆叠柱状图',
  },

  // ── 折线/面积族 ──

  'smooth-line': {
    chartType: 'line',
    options: {
      ...FONT,
      lineSmooth: true,
      lineSize: 2,
    },
    label: '平滑折线图',
  },

  'straight-line': {
    chartType: 'line',
    options: {
      ...FONT,
      lineSmooth: false,
      lineSize: 2,
    },
    label: '直线折线图',
  },

  'area': {
    chartType: 'area',
    options: {
      ...FONT,
      lineSmooth: true,
      lineSize: 2,
    },
    label: '面积图',
  },

  // ── 饼图族 ──
  // 默认对齐前端 ECharts pie 的 label 形态：
  //   外引线 + "类别: 数值" + 底部图例
  // 不开 showPercent，避免与 showValue 叠加导致 PPT 端出现 "58 / 58%" 双行。
  // deck.js 可用 dataLabelContent 显式改为 value / percentage / category。

  'pie': {
    chartType: 'pie',
    options: {
      ...FONT,
      showLabel: true,
      dataLabelPosition: 'outEnd',
      showLeaderLines: true,
    },
    label: '标准饼图',
  },

  'doughnut': {
    chartType: 'doughnut',
    options: {
      ...FONT,
      holeSize: 50,
      showLabel: true,
      dataLabelPosition: 'outEnd',
      showLeaderLines: true,
    },
    label: '甜甜圈图',
  },

  // ── 雷达族 ──

  'radar': {
    chartType: 'radar',
    options: {
      ...FONT,
      radarStyle: 'standard',
      lineDataSymbolSize: 0,
    },
    label: '标准雷达图',
  },

  'radar-filled': {
    chartType: 'radar',
    options: {
      ...FONT,
      radarStyle: 'filled',
      lineDataSymbolSize: 0,
    },
    label: '填充雷达图',
  },

  // ── 散点图 ──

  'scatter': {
    chartType: 'scatter',
    options: {
      ...FONT,
    },
    label: '标准散点图',
  },
} as const satisfies Record<ChartPresetName, ChartPreset>;

/**
 * 根据预设名称查找预设定义。
 * 未找到时返回 undefined（容错处理，不报错）。
 */
export function resolveChartPreset(name: string): ChartPreset | undefined {
  return isChartPresetName(name) ? CHART_PRESETS[name] : undefined;
}

function isChartPresetName(name: string): name is ChartPresetName {
  return Object.prototype.hasOwnProperty.call(CHART_PRESETS, name);
}

/**
 * 将 Agent 的简单图表参数翻译为 PptxGenJS chartOptions。
 * 这些参数是 Agent 可控的语义化"旋钮"，
 * 预设提供基线 → 简单参数覆盖 → 内部 DirectCompose 的 chartOptions 再覆盖。
 */
export function buildChartOptionsFromParams(params: {
  chartPreset?: string;
  showDataLabels?: boolean;
  dataLabelFormat?: string;
  legendPosition?: string;
  chartOptions?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  const preset = params.chartPreset ? resolveChartPreset(params.chartPreset) : undefined;

  // 简单参数 → PptxGenJS 选项翻译
  const simpleOpts: Record<string, unknown> = {};
  if (params.showDataLabels != null) {
    simpleOpts.showValue = params.showDataLabels;
    if (!params.showDataLabels) { simpleOpts.showPercent = false; simpleOpts.showLabel = false; }
  }
  if (params.dataLabelFormat) {
    simpleOpts.dataLabelFormatCode = params.dataLabelFormat;
  }
  if (params.legendPosition && params.legendPosition !== 'none') {
    simpleOpts.showLegend = true;
    simpleOpts.legendPos = mapLegendPosition(params.legendPosition);
  }
  if (params.legendPosition === 'none') simpleOpts.showLegend = false;

  const merged = {
    ...preset?.options,
    ...simpleOpts,
    ...params.chartOptions,
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** 将语义化图例位置映射为 PptxGenJS legendPos */
function mapLegendPosition(pos: string): string {
  switch (pos) {
    case 'top': return 't';
    case 'bottom': return 'b';
    case 'left': return 'l';
    case 'right': return 'r';
    default: return 'r';
  }
}
