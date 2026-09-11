import type { StructuredElement, TextStyle } from '@plugin/slides/shared';
import type {
  ChartPptxHints,
  ChartRenderNode,
  RenderChartAxes,
  RenderChartDataLabels,
  RenderChartGridlines,
  RenderChartLabelStyle,
  RenderChartType,
  RenderStroke,
  TablePptxHints,
  TableRenderNode,
} from '@plugin/slides/shared';
import { TABLE_DEFAULT_HEADER_FILL } from '@plugin/slides/shared';
import {
  clamp,
  buildTableColumnWidths,
  buildTableRowHeights,
  estimateTableDensity,
  resolveGeneratedRenderChartType,
} from '../../visual/presentationVisualDefaults';
import {
  resolveChartLegend,
  resolveChartType,
} from './RenderModelShared.js';
import { resolveTextStyleLineSpacing, textStyleToRuns } from './RenderModelText.js';
import type { RenderBaseNode, RenderDefaultsContext } from './RenderModelShared.js';

export function resolveTextStyle(
  element: StructuredElement | undefined,
): TextStyle {
  if (!element) {
    return {};
  }

  switch (element.type) {
    case 'title':
    case 'text':
    case 'bulletList':
    case 'numberedList':
      return element.style ?? {};
    case 'shape':
    case 'chart':
    case 'table':
    case 'image':
    case 'svgGraphic':
    case 'formula':
      return {};
  }
}

export function mapStructuredChartNode(
  base: RenderBaseNode,
  element: Extract<StructuredElement, { type: 'chart' }>,
  defaults: RenderDefaultsContext,
): ChartRenderNode {
  const opts = (element.options ?? {}) as Record<string, unknown>;
  // barDir 决定横向/纵向：'bar' = 横向，'col'/默认 = 纵向
  const rawType = resolveGeneratedRenderChartType(element.chartType);
  const chartType = (rawType === 'column' && opts.barDir === 'bar')
    ? 'bar' as const
    : resolveChartType(rawType);
  const baseLabelStyle = resolveChartTextStyle(
    opts,
    'catAxisLabelFontFace',
    'catAxisLabelFontSize',
    defaults.minorFontFamily,
    element.chartStyle?.categoryAxisLabelColor ?? element.chartStyle?.axisLabelColor,
    'catAxisLabelColor',
  );
  const hints = extractChartPptxHints(opts);
  const node: ChartRenderNode = {
    ...base,
    kind: 'chart',
    chartType,
    categories: element.data.categories,
    series: element.data.series.map((series, index) => ({
      name: series.name,
      values: series.values,
      color: defaults.chartPalette[index % defaults.chartPalette.length],
    })),
    palette: defaults.chartPalette,
    legend: resolveChartLegendStyle(element.options, element.chartStyle?.legendColor, defaults.minorFontFamily),
    plotBackgroundColor: element.chartStyle?.plotBackgroundColor,
    seriesLineWidth: element.chartStyle?.seriesLineWidth,
    stacking: resolveChartStacking(opts),
    axes: resolveChartAxes(opts, chartType, baseLabelStyle, element.chartStyle),
    dataLabels: resolveChartDataLabels(opts, element.chartStyle?.dataLabelColor),
    gridlines: resolveChartGridlines(opts, chartType, element.chartStyle?.gridlineColor),
    labelStyle: baseLabelStyle,
    ...(hints ? { pptxHints: hints } : {}),
  };

  return node;
}

// ─── Chart options -> RenderModel 辅助映射 ──────────────────────────────────

function resolveChartStacking(
  opts: Record<string, unknown>,
): ChartRenderNode['stacking'] {
  const grouping = opts.barGrouping;
  if (grouping === 'stacked') return 'stacked';
  if (grouping === 'percentStacked') return 'percent';
  return undefined;
}

function resolveChartAxes(
  opts: Record<string, unknown>,
  chartType: RenderChartType,
  categoryLabelStyle: RenderChartLabelStyle | undefined,
  chartStyle: Extract<StructuredElement, { type: 'chart' }>['chartStyle'],
): RenderChartAxes | undefined {
  const catVisible = opts.catAxisHidden !== true;
  const valVisible = opts.valAxisHidden !== true;
  const valMax = typeof opts.valAxisMaxVal === 'number' ? opts.valAxisMaxVal : undefined;
  const valMin = typeof opts.valAxisMinVal === 'number' ? opts.valAxisMinVal : undefined;
  const valueLabelStyle = resolveChartTextStyle(
    opts,
    'valAxisLabelFontFace',
    'valAxisLabelFontSize',
    undefined,
    chartStyle?.valueAxisLabelColor ?? chartStyle?.axisLabelColor,
    'valAxisLabelColor',
  );

  if (chartType === 'bar') {
    return {
      x: { visible: valVisible, min: valMin, max: valMax, labelStyle: valueLabelStyle },
      y: { visible: catVisible, labelStyle: categoryLabelStyle },
    };
  }

  return {
    x: { visible: catVisible, labelStyle: categoryLabelStyle },
    y: { visible: valVisible, min: valMin, max: valMax, labelStyle: valueLabelStyle },
  };
}

function resolveChartDataLabels(
  opts: Record<string, unknown>,
  colorOverride?: string,
): RenderChartDataLabels | undefined {
  if (opts.showValue !== true) return undefined;

  const posMap: Record<string, RenderChartDataLabels['position']> = {
    outEnd: 'outside',
    inEnd: 'inside',
    ctr: 'center',
    inBase: 'inside',
  };

  return {
    visible: true,
    format: typeof opts.dataLabelFormatCode === 'string' ? opts.dataLabelFormatCode : undefined,
    position: typeof opts.dataLabelPosition === 'string'
      ? (posMap[opts.dataLabelPosition] ?? 'outside')
      : 'outside',
    labelStyle: resolveChartTextStyle(
      opts,
      'dataLabelFontFace',
      'dataLabelFontSize',
      undefined,
      colorOverride,
      'dataLabelColor',
    ),
  };
}

function resolveChartGridlines(
  opts: Record<string, unknown>,
  chartType: RenderChartType,
  colorOverride?: string,
): RenderChartGridlines | undefined {
  const catHidden = opts.catGridLine === false;
  const valHidden = opts.valGridLine === false;
  const catColor = colorOverride ?? readGridlineColor(opts.catGridLine);
  const valColor = colorOverride ?? readGridlineColor(opts.valGridLine);
  if (!catHidden && !valHidden && !catColor && !valColor) return undefined;

  if (chartType === 'bar') {
    return {
      x: valHidden ? { visible: false } : valColor ? { color: valColor } : undefined,
      y: catHidden ? { visible: false } : catColor ? { color: catColor } : undefined,
    };
  }

  return {
    x: catHidden ? { visible: false } : catColor ? { color: catColor } : undefined,
    y: valHidden ? { visible: false } : valColor ? { color: valColor } : undefined,
  };
}

export function mapStructuredTableNode(
  base: RenderBaseNode,
  element: Extract<StructuredElement, { type: 'table' }>,
  defaults: RenderDefaultsContext,
): TableRenderNode {
  const bodyColumnCount = element.rows.reduce((max, row) => {
    const rowSpanCount = row.reduce((sum, cell) => sum + (cell.colspan ?? 1), 0);
    return Math.max(max, rowSpanCount);
  }, 0);
  const columnCount = Math.max(element.headers?.length ?? 0, bodyColumnCount, 1);
  const totalRows = element.rows.length + (element.headers ? 1 : 0);
  const density = estimateTableDensity(element.headers, element.rows);
  const dense = density > 110 || totalRows >= 5 || base.box.h <= 1.9;
  const requestedFontSize = resolveRequestedFontSize(element.options);
  const baseFontSize = clamp(
    requestedFontSize ?? (dense ? 9.5 : 11),
    8.5,
    base.box.h <= 1.6 ? 9.5 : 11.5,
  );
  const columnWidths = buildTableColumnWidths(base.box.w, element.headers, element.rows)
    ?? Array.from({ length: columnCount }, () => Number((base.box.w / columnCount).toFixed(3)));
  const rowHeights = buildTableRowHeights(base.box.h, Math.max(totalRows, 1), dense)
    ?? Array.from(
      { length: Math.max(totalRows, 1) },
      () => Number((base.box.h / Math.max(totalRows, 1)).toFixed(3)),
    );
  const cells: TableRenderNode['cells'] = [];
  const tableBorder = element.border ? toRenderStroke(element.border) : undefined;
  const cellBorders = tableBorder ? {
    top: tableBorder,
    right: tableBorder,
    bottom: tableBorder,
    left: tableBorder,
  } : undefined;

  if (element.headers) {
    for (const [columnIndex, header] of element.headers.entries()) {
      cells.push({
        row: 0,
        col: columnIndex,
        paragraphs: [{
          runs: textStyleToRuns(header, {
            fontFamily: defaults.minorFontFamily,
            fontSize: Math.min(baseFontSize + 0.5, 11.5),
            bold: true,
          }, defaults.minorFontFamily),
        }],
        fill: TABLE_DEFAULT_HEADER_FILL,
        ...(cellBorders ? { borders: cellBorders } : {}),
        padding: resolveCellPadding(dense),
        verticalAlign: 'middle',
      });
    }
  }

  const bodyOffset = element.headers ? 1 : 0;
  for (const [rowIndex, row] of element.rows.entries()) {
    let columnCursor = 0;
    for (const cell of row) {
      cells.push({
        row: rowIndex + bodyOffset,
        col: columnCursor,
        rowSpan: cell.rowspan,
        colSpan: cell.colspan,
        paragraphs: [{
          runs: textStyleToRuns(cell.text, cell.style, defaults.minorFontFamily, baseFontSize),
          lineSpacing: resolveTextStyleLineSpacing(cell.style?.lineSpacing),
        }],
        fill: cell.fill,
        ...(cellBorders ? { borders: cellBorders } : {}),
        padding: resolveCellPadding(dense),
        verticalAlign: 'middle',
      });
      columnCursor += cell.colspan ?? 1;
    }
  }

  const tableHints = extractTablePptxHints(element.options);
  return {
    ...base,
    kind: 'table',
    columns: columnWidths,
    rows: rowHeights,
    cells,
    headerRows: element.headers ? 1 : undefined,
    ...(tableHints ? { pptxHints: tableHints } : {}),
  };
}

function resolveChartLegendStyle(
  options: Record<string, unknown> | undefined,
  color?: string,
  fontFamily?: string,
): ChartRenderNode['legend'] {
  const legend = resolveChartLegend(options);
  if (!legend) {
    return undefined;
  }
  return {
    ...legend,
    labelStyle: resolveChartTextStyle(
      options ?? {},
      'legendFontFace',
      'legendFontSize',
      fontFamily,
      color,
      'legendColor',
    ),
  };
}

function resolveChartTextStyle(
  options: Record<string, unknown>,
  fontFaceKey: string,
  fontSizeKey: string,
  fallbackFontFamily?: string,
  colorOverride?: string,
  colorKey?: string,
): RenderChartLabelStyle | undefined {
  const fontFamily = typeof options[fontFaceKey] === 'string'
    ? options[fontFaceKey] as string
    : fallbackFontFamily;
  const fontSize = typeof options[fontSizeKey] === 'number'
    ? options[fontSizeKey] as number
    : undefined;
  const rawColor = colorOverride
    ?? (colorKey && typeof options[colorKey] === 'string' ? options[colorKey] as string : undefined);
  const color = rawColor ? normalizeHexColor(rawColor) : undefined;
  if (fontFamily == null && fontSize == null && color == null) {
    return undefined;
  }
  return { fontFamily, fontSize, color };
}

function resolveRequestedFontSize(
  options: Record<string, unknown> | undefined,
): number | undefined {
  return typeof options?.fontSize === 'number' ? options.fontSize : undefined;
}

function resolveCellPadding(dense: boolean): TableRenderNode['cells'][number]['padding'] {
  const inset = dense ? 0.03 : 0.05;
  return {
    top: inset,
    right: inset,
    bottom: inset,
    left: inset,
  };
}

// ─── PptxHints 提取：纯字段拷贝，不做语义转换 ─────────────────────────────

/**
 * 从 el.options（PptxGenJS IChartOpts）中提取影响视觉效果的关键字段，
 * 透传给前端 ECharts mapper 用于微调渲染。
 */
function extractChartPptxHints(opts: Record<string, unknown>): ChartPptxHints | undefined {
  const hints: ChartPptxHints = {};
  let hasAny = false;

  if (typeof opts.barGapWidthPct === 'number') {
    hints.barGapWidthPct = opts.barGapWidthPct;
    hasAny = true;
  }
  if (typeof opts.barOverlapPct === 'number') {
    hints.barOverlapPct = opts.barOverlapPct;
    hasAny = true;
  }
  if (opts.radarStyle === 'standard' || opts.radarStyle === 'marker' || opts.radarStyle === 'filled') {
    hints.radarStyle = opts.radarStyle;
    hasAny = true;
  }
  if (typeof opts.lineSize === 'number') {
    hints.lineSize = opts.lineSize;
    hasAny = true;
  }
  if (typeof opts.lineSmooth === 'boolean') {
    hints.lineSmooth = opts.lineSmooth;
    hasAny = true;
  }
  if (typeof opts.holeSize === 'number') {
    hints.holeSize = opts.holeSize;
    hasAny = true;
  }
  if (opts.catAxisOrientation === 'minMax' || opts.catAxisOrientation === 'maxMin') {
    hints.catAxisOrientation = opts.catAxisOrientation;
    hasAny = true;
  }
  if (typeof opts.dataLabelColor === 'string') {
    hints.dataLabelColor = opts.dataLabelColor;
    hasAny = true;
  }
  return hasAny ? hints : undefined;
}

/**
 * 从 el.options（PptxGenJS ITableOptions）中提取影响表格视觉效果的字段，
 * 透传给前端 KonvaTableNode 用于微调渲染。
 */
function extractTablePptxHints(
  options: Record<string, unknown> | undefined,
): TablePptxHints | undefined {
  if (!options) return undefined;
  const hints: TablePptxHints = {};
  let hasAny = false;

  // PptxGenJS 的 fill 可以是字符串或对象
  const fill = options.fill;
  if (typeof fill === 'string') {
    hints.tableFill = normalizeHexColor(fill);
    hasAny = true;
  } else if (fill && typeof fill === 'object' && 'color' in fill) {
    const colorVal = Reflect.get(fill, 'color');
    if (typeof colorVal === 'string') {
      hints.tableFill = normalizeHexColor(colorVal);
      hasAny = true;
    }
  }

  const border = options.border;
  if (border && typeof border === 'object' && 'color' in border) {
    const borderColor = Reflect.get(border, 'color');
    if (typeof borderColor === 'string') {
      hints.borderColor = normalizeHexColor(borderColor);
      hasAny = true;
    }
  }

  return hasAny ? hints : undefined;
}

function readGridlineColor(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('color' in value)) return undefined;
  const color = Reflect.get(value, 'color');
  return typeof color === 'string' ? normalizeHexColor(color) : undefined;
}

function toRenderStroke(
  border: NonNullable<Extract<StructuredElement, { type: 'table' }>['border']>,
): RenderStroke {
  const paint = border.paint;
  if (!paint || paint.type === 'none') {
    throw new Error('Table.border 必须是可见的纯色描边。');
  }
  if (paint.type !== 'solid') {
    throw new Error('Table.border 暂不支持渐变描边。');
  }
  return {
    paint: { type: 'solid', color: paint.color, ...(paint.opacity == null ? {} : { opacity: paint.opacity }) },
    width: border.width,
    dash: border.dash,
  };
}

/** 确保颜色值带 # 前缀 */
function normalizeHexColor(color: string): string {
  if (color.startsWith('#')) return color;
  return `#${color}`;
}
