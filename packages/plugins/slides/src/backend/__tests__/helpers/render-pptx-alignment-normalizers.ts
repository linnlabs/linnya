import type { CapturedElement } from './pptx-spy.js';
import type {
  ChartRenderNode,
  RenderNode,
  ShapeRenderNode,
  TableRenderNode,
  TextRenderNode,
} from '@plugin/slides/shared';
import { DEFAULT_TEXT_LINE_SPACING_MULTIPLE } from '@plugin/slides/shared';

// ═══════════════════════════════════════════════════════════════════════════
// 归一化层：两条管线输出 → NormalizedElement
// ═══════════════════════════════════════════════════════════════════════════

export interface NormalizedGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NormalizedTextProps {
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  lineSpacingPt?: number;
  charSpacingPt?: number;
  align?: string;
  valign?: string;
}

export interface NormalizedChartProps {
  chartType?: string;
  stacking?: string;
  legendVisible?: boolean;
  legendPos?: string;
  legendFontSize?: number;
  showValue?: boolean;
  dataLabelPosition?: string;
  dataLabelFontSize?: number;
  categoryAxisLabelFontSize?: number;
  valueAxisLabelFontSize?: number;
  catAxisHidden?: boolean;
  valAxisHidden?: boolean;
  valAxisMin?: number;
  valAxisMax?: number;
}

export interface NormalizedShapeProps {
  fill?: string;
  borderColor?: string;
  borderWidth?: number;
  cornerRadius?: number;
  opacity?: number;
}

export interface NormalizedTableProps {
  fontSize?: number;
  colW?: number[];
  rowH?: number[];
}

export interface NormalizedElement {
  index: number;
  /** 来源方法名（PPTX 侧）或节点 kind（RenderModel 侧）的统一标签 */
  type: string;
  geometry: NormalizedGeometry;
  text?: NormalizedTextProps;
  chart?: NormalizedChartProps;
  shape?: NormalizedShapeProps;
  table?: NormalizedTableProps;
}

// ─── RenderModel → NormalizedElement ────────────────────────────────────

export function normalizeRenderNode(node: RenderNode, index: number): NormalizedElement {
  const base: NormalizedElement = {
    index,
    type: node.kind,
    geometry: { x: node.box.x, y: node.box.y, w: node.box.w, h: node.box.h },
  };

  switch (node.kind) {
    case 'text':
      base.text = normalizeTextNode(node);
      break;
    case 'chart':
      base.chart = normalizeChartNode(node);
      break;
    case 'shape':
      base.shape = normalizeShapeNode(node);
      if (node.innerText) {
        base.text = normalizeTextNode(node.innerText);
      }
      break;
    case 'table':
      base.table = normalizeTableNode(node);
      break;
    case 'image':
      break;
  }

  return base;
}

function normalizeTextNode(node: TextRenderNode): NormalizedTextProps {
  const firstRun = node.paragraphs?.[0]?.runs?.[0];
  if (!firstRun) return {};
  const firstParagraph = node.paragraphs?.[0];

  return {
    fontSize: firstRun.fontSize,
    fontFamily: normalizeFontFamily(firstRun.fontFamily),
    bold: firstRun.fontWeight === 'bold' ? true : undefined,
    italic: firstRun.fontStyle === 'italic' ? true : undefined,
    underline: firstRun.underline,
    color: normalizeColor(firstRun.color),
    // PPTX spy 只能看到声明值，无法看到 PowerPoint autofit 后的有效字号；
    // 因此这里也比较段落声明，不能用已经 shrink 的最终 line.height 制造假差异。
    lineSpacingPt: resolveDeclaredLineSpacingPt(firstParagraph?.lineSpacing, firstRun.fontSize),
    charSpacingPt: firstRun.letterSpacing,
    align: node.paragraphs?.[0]?.align,
    valign: node.verticalAlign,
  };
}

function resolveDeclaredLineSpacingPt(
  lineSpacing: TextRenderNode['paragraphs'][number]['lineSpacing'],
  fontSizePt: number,
): number {
  if (lineSpacing?.kind === 'exactPt') return lineSpacing.value;
  return fontSizePt * (lineSpacing?.value ?? DEFAULT_TEXT_LINE_SPACING_MULTIPLE);
}

function normalizeChartNode(node: ChartRenderNode): NormalizedChartProps {
  const categoryAxis = node.chartType === 'bar' ? node.axes?.y : node.axes?.x;
  const valueAxis = node.chartType === 'bar' ? node.axes?.x : node.axes?.y;
  return {
    chartType: node.chartType,
    stacking: node.stacking ?? 'none',
    legendVisible: node.legend?.visible,
    legendPos: node.legend?.position,
    legendFontSize: node.legend?.labelStyle?.fontSize,
    showValue: node.dataLabels?.visible,
    dataLabelPosition: node.dataLabels?.position,
    dataLabelFontSize: node.dataLabels?.labelStyle?.fontSize,
    categoryAxisLabelFontSize: categoryAxis?.labelStyle?.fontSize ?? node.labelStyle?.fontSize,
    valueAxisLabelFontSize: valueAxis?.labelStyle?.fontSize,
    catAxisHidden: node.axes?.x?.visible === false || node.axes?.y?.visible === false
      ? true
      : undefined,
    valAxisHidden: (() => {
      if (node.chartType === 'bar') return node.axes?.x?.visible === false ? true : undefined;
      return node.axes?.y?.visible === false ? true : undefined;
    })(),
    valAxisMin: node.chartType === 'bar' ? node.axes?.x?.min : node.axes?.y?.min,
    valAxisMax: node.chartType === 'bar' ? node.axes?.x?.max : node.axes?.y?.max,
  };
}

function normalizeShapeNode(node: ShapeRenderNode): NormalizedShapeProps {
  return {
    fill: normalizeColor(node.fill?.type === 'solid' ? node.fill.color : undefined),
    borderColor: normalizeColor(
      node.stroke?.paint.type === 'solid' ? node.stroke.paint.color : undefined,
    ),
    borderWidth: node.stroke?.width,
    cornerRadius: node.cornerRadius,
    opacity: node.opacity,
  };
}

function normalizeTableNode(node: TableRenderNode): NormalizedTableProps {
  const firstCellRun = node.cells?.[0]?.paragraphs?.[0]?.runs?.[0];
  return {
    fontSize: firstCellRun?.fontSize,
    colW: node.columns,
    rowH: node.rows,
  };
}

// ─── PptxGenJS Capture → NormalizedElement ───────────────────────────────

export function normalizePptxCapture(cap: CapturedElement, index: number): NormalizedElement {
  const opts = cap.opts ?? {};
  const resolvedType = methodToType(cap.method, opts);
  const base: NormalizedElement = {
    index,
    type: resolvedType,
    geometry: {
      x: toNumber(opts.x),
      y: toNumber(opts.y),
      w: toNumber(opts.w),
      h: toNumber(opts.h),
    },
  };

  switch (cap.method) {
    case 'addText':
      base.text = normalizePptxTextOpts(opts);
      // addText(shape=...) 场景：同时提取 shape 属性
      if (opts.shape) {
        base.shape = normalizePptxShapeOpts(opts);
      }
      break;
    case 'addChart':
      base.chart = normalizePptxChartOpts(opts, cap.chartType);
      break;
    case 'addShape':
      base.shape = normalizePptxShapeOpts(opts);
      break;
    case 'addTable':
      base.table = normalizePptxTableOpts(opts);
      break;
    case 'addImage':
      break;
  }

  return base;
}

/** addText 可能来自 title/text/bulletList/numberedList/shape(带text)，通过 opts 辨别 */
function methodToType(method: CapturedElement['method'], opts: Record<string, unknown>): string {
  switch (method) {
    case 'addText':
      if (opts.shape) return 'shape';
      return 'text';
    case 'addChart': return 'chart';
    case 'addTable': return 'table';
    case 'addImage': return 'image';
    case 'addShape': return 'shape';
  }
}

function normalizePptxTextOpts(opts: Record<string, unknown>): NormalizedTextProps {
  const fontSize = toNumberOrUndefined(opts.fontSize);
  const lineSpacing = toNumberOrUndefined(opts.lineSpacing);
  const lineSpacingMultiple = toNumberOrUndefined(opts.lineSpacingMultiple);
  return {
    fontSize,
    fontFamily: normalizeFontFamily(opts.fontFace as string | undefined),
    bold: opts.bold === true ? true : undefined,
    italic: opts.italic === true ? true : undefined,
    underline: opts.underline === true ? true : undefined,
    color: normalizeColor(opts.color as string | undefined),
    lineSpacingPt: lineSpacing ?? (
      lineSpacingMultiple != null && fontSize != null
        ? lineSpacingMultiple * fontSize
        : undefined
    ),
    charSpacingPt: toNumberOrUndefined(opts.charSpacing),
    align: opts.align as string | undefined,
    valign: opts.valign as string | undefined,
  };
}

function normalizePptxChartOpts(opts: Record<string, unknown>, chartType?: string): NormalizedChartProps {
  const legendPosMap: Record<string, string> = { b: 'bottom', t: 'top', l: 'left', r: 'right' };
  const rawLegendPos = opts.legendPos as string | undefined;
  const dataLabelPosMap: Record<string, string> = {
    outEnd: 'outside',
    inEnd: 'inside',
    ctr: 'center',
    inBase: 'inside',
  };
  const rawDlPos = opts.dataLabelPosition as string | undefined;
  const legendVisible = typeof opts.showLegend === 'boolean'
    ? opts.showLegend
    : rawLegendPos != null
      ? true
      : false;

  return {
    chartType: resolveSpiedChartType(chartType, opts),
    stacking: resolveSpiedStacking(opts),
    legendVisible,
    legendPos: rawLegendPos ? (legendPosMap[rawLegendPos] ?? rawLegendPos) : undefined,
    legendFontSize: toNumberOrUndefined(opts.legendFontSize),
    showValue: opts.showValue === true ? true : undefined,
    dataLabelPosition: rawDlPos ? (dataLabelPosMap[rawDlPos] ?? rawDlPos) : undefined,
    dataLabelFontSize: toNumberOrUndefined(opts.dataLabelFontSize),
    categoryAxisLabelFontSize: toNumberOrUndefined(opts.catAxisLabelFontSize),
    valueAxisLabelFontSize: toNumberOrUndefined(opts.valAxisLabelFontSize),
    catAxisHidden: opts.catAxisHidden === true ? true : undefined,
    valAxisHidden: opts.valAxisHidden === true ? true : undefined,
    valAxisMin: toNumberOrUndefined(opts.valAxisMinVal),
    valAxisMax: toNumberOrUndefined(opts.valAxisMaxVal),
  };
}

function resolveSpiedChartType(rawType: string | undefined, opts: Record<string, unknown>): string {
  if (!rawType) return 'column';
  if (rawType === 'bar' && opts.barDir !== 'bar') return 'column';
  if (rawType === 'bar' && opts.barDir === 'bar') return 'bar';
  return rawType;
}

function resolveSpiedStacking(opts: Record<string, unknown>): string {
  if (opts.barGrouping === 'stacked') return 'stacked';
  if (opts.barGrouping === 'percentStacked') return 'percent';
  return 'none';
}

function normalizePptxShapeOpts(opts: Record<string, unknown>): NormalizedShapeProps {
  const fill = opts.fill as Record<string, unknown> | undefined;
  const line = opts.line as Record<string, unknown> | undefined;
  return {
    fill: normalizeColor(fill?.color as string | undefined),
    borderColor: normalizeColor(line?.color as string | undefined),
    borderWidth: toNumberOrUndefined(line?.width),
    cornerRadius: toNumberOrUndefined(opts.rectRadius),
    opacity: (() => {
      if (fill?.transparency != null) return 1 - (fill.transparency as number) / 100;
      return undefined;
    })(),
  };
}

function normalizePptxTableOpts(opts: Record<string, unknown>): NormalizedTableProps {
  return {
    fontSize: toNumberOrUndefined(opts.fontSize),
    colW: Array.isArray(opts.colW) ? opts.colW.map(Number) : undefined,
    rowH: Array.isArray(opts.rowH) ? opts.rowH.map(Number) : undefined,
  };
}

// ─── 颜色与字体归一化 ──────────────────────────────────────────────────

function normalizeColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const hex = c.startsWith('#') ? c.slice(1).toUpperCase() : c.toUpperCase();
  return hex.length === 6 ? `#${hex}` : hex.length === 8 ? `#${hex}` : c;
}

/** 统一取 fontFamily 的第一个名称，忽略 fallback */
function normalizeFontFamily(f: string | undefined): string | undefined {
  if (!f) return undefined;
  return f.split(',')[0]!.trim();
}

function toNumber(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function toNumberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
