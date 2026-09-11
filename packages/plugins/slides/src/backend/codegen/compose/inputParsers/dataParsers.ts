/**
 * 图表、表格、图片数据的 tool input 解析器。
 * 依赖 typeGuards 和 styleParsers（parseTextStyle 用于表格单元格样式）。
 */

import {
  normalizeBrushArtworkSourceRef,
  type ImageSourceInput,
} from '@plugin/slides/shared';
import type {
  ChartSeries,
  ChartType,
  SvgGraphicAuthoringSource,
  TableCell,
} from '@plugin/slides/shared';
import {
  isFiniteNumber,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  parseLabelArray,
  parseDisplayString,
} from './typeGuards.js';
import { KNOWN_TEXT_STYLE_KEYS, parseTextStyle } from './styleParsers.js';
import { parseChartSeriesFields } from './chartParsers.js';

// ─── 图表 ─────────────────────────────────────────────────────────────────

export function parseChartSeries(value: unknown): ChartSeries | null {
  if (!isRecord(value) || !isNonEmptyString(value.name)) {
    return null;
  }
  const rawValues = value.values ?? value.data;
  if (!Array.isArray(rawValues) || !rawValues.every(isFiniteNumber)) {
    return null;
  }
  // labels 可选：compose 格式中 categories 在元素级别提供，series 条目可能不含 labels。
  // 但只要调用方显式传入 labels，就必须满足标签数组合同，不能静默降级为空数组。
  const labels = value.labels == null ? [] : parseLabelArray(value.labels);
  if (!labels) {
    return null;
  }
  return parseChartSeriesFields({
    ...value,
    name: value.name,
    labels,
    values: rawValues,
  });
}

export function parseChartSeriesArray(value: unknown): ChartSeries[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const series: ChartSeries[] = [];
  for (const entry of value) {
    const parsedSeries = parseChartSeries(entry);
    if (!parsedSeries) {
      return null;
    }
    series.push(parsedSeries);
  }
  return series;
}

export function parseChartType(value: unknown): ChartType | undefined {
  switch (value) {
    case 'bar': case 'line': case 'pie': case 'doughnut': case 'scatter': case 'area': case 'radar': case 'combo': return value;
    default: return undefined;
  }
}

export interface NormalizedChartData {
  chartType?: ChartType;
  categories: string[];
  series: ChartSeries[];
}

export interface ChartDataParseOptions {
  requireChartType?: boolean;
}

const CHART_CATEGORY_KEYS = ['categories', 'labels', 'xLabels', 'xAxisLabels'] as const;
const CHART_SERIES_KEYS = ['series', 'datasets'] as const;

export function parseChartDataLike(
  value: unknown,
  options?: ChartDataParseOptions,
): { data?: NormalizedChartData; error?: string } {
  if (!isRecord(value)) {
    return { error: '图表数据必须是对象。' };
  }

  const rawChartType = value.chartType;
  const chartType = rawChartType == null ? undefined : parseChartType(rawChartType);
  if (rawChartType != null && chartType == null) {
    return { error: 'chartType 必须是 bar / line / pie / doughnut / scatter / area / radar / combo 之一。' };
  }
  if (options?.requireChartType && chartType == null) {
    return { error: '图表数据缺少 chartType。' };
  }

  const rawSeries = readFirstDefinedValue(value, CHART_SERIES_KEYS);
  if (rawSeries == null) {
    return { error: '图表数据缺少 series/datasets。' };
  }
  const series = parseChartSeriesArray(rawSeries);
  if (!series || series.length === 0) {
    return {
      error: '图表数据的 series/datasets 必须是非空数组；每项需包含 name 和 values（也兼容 data）数字数组。',
    };
  }

  const rawCategories = readFirstDefinedValue(value, CHART_CATEGORY_KEYS);
  let categories = rawCategories == null ? null : parseLabelArray(rawCategories);
  if (rawCategories != null && categories == null) {
    return { error: '图表数据的 categories/labels/xLabels/xAxisLabels 必须是字符串、数字或布尔数组。' };
  }
  if (categories == null || categories.length === 0) {
    const fallbackLabels = series.find((entry) => entry.labels.length > 0)?.labels;
    if (!fallbackLabels || fallbackLabels.length === 0) {
      return { error: '图表数据缺少 categories（也可写 labels/xLabels/xAxisLabels），且无法从 series.labels 推导。' };
    }
    categories = fallbackLabels;
  }

  return {
    data: {
      chartType,
      categories,
      series,
    },
  };
}

// ─── 表格 ─────────────────────────────────────────────────────────────────

export function parseTableCell(value: unknown): TableCell | null {
  const directText = parseDisplayString(value);
  if (directText) {
    return { text: directText };
  }
  if (!isRecord(value)) {
    return null;
  }
  const text = parseDisplayString(value.text)
    ?? parseDisplayString(value.content)
    ?? parseDisplayString(value.value);
  if (!text) {
    return null;
  }
  const cell: TableCell = { text };

  // ── TextStyle 字段兼容：cell 顶层"短手字段"自动 promote 到 cell.style ──
  //
  //   AI 训练数据里 PptxGenJS table cell options 是平铺写法：
  //     { text: 'A', color: '#FFF', bold: true, fill: '#333', align: 'center' }
  //   而我们的合同 TableCell 要求样式收在 `style` 子对象。如果不兼容，AI
  //   写在顶层的 color / bold / align / fontSize 等会被静默 drop。
  //
  //   兼容策略：用 KNOWN_TEXT_STYLE_KEYS 作为单一真值源（与 splitElementStyleInput
  //   保持一致），把 cell 顶层的同名字段收进 inline TextStyle，与显式 cell.style
  //   合并（cell.style 显式优先，与 splitElementStyleInput 的合并语义一致）。
  //
  //   ⚠ 类型不对的短手字段（如 `color: 123`）会被 parseTextStyle 静默丢弃，
  //     与 splitElementStyleInput 行为一致；不与 cell.fill 的严格校验对齐 ——
  //     这是历史遗留的不一致，本次不动。
  const inlineTextPortion: Record<string, unknown> = {};
  for (const key of KNOWN_TEXT_STYLE_KEYS) {
    if (value[key] !== undefined) inlineTextPortion[key] = value[key];
  }
  const inlineStyle = Object.keys(inlineTextPortion).length > 0
    ? parseTextStyle(inlineTextPortion)
    : null;

  const explicitStyle = value.style != null ? parseTextStyle(value.style) : null;
  if (value.style != null && explicitStyle == null) return null;

  if (inlineStyle || explicitStyle) {
    cell.style = { ...(inlineStyle ?? {}), ...(explicitStyle ?? {}) };
  }

  // ── 单元格背景色字段兼容 ──
  //   - `fill` 是 SlideSpec.TableCell 的合同字段名（与 PptxGenJS / 内部模型一致）
  //   - `bgColor` / `backgroundColor` 是 AI 训练数据里更高频的写法
  //     （HTML 老 table 用 bgColor、CSS 用 backgroundColor），允许互相替代以
  //     避免静默 drop。优先级：fill > bgColor > backgroundColor，前者已存在则忽略后者。
  // ⚠ 任意一个字段如果存在但不是非空字符串，必须返回 null（不要静默降级），
  //    与 cell.text / cell.style 的严格校验保持一致。
  const cellFillRaw = value.fill ?? value.bgColor ?? value.backgroundColor;
  if (cellFillRaw != null) {
    if (!isNonEmptyString(cellFillRaw)) return null;
    cell.fill = cellFillRaw;
  }
  if (value.colspan != null) {
    if (!isPositiveInteger(value.colspan)) return null;
    cell.colspan = value.colspan;
  }
  if (value.rowspan != null) {
    if (!isPositiveInteger(value.rowspan)) return null;
    cell.rowspan = value.rowspan;
  }
  return cell;
}

export function parseTableRows(value: unknown): TableCell[][] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const rows: TableCell[][] = [];
  for (const rowValue of value) {
    if (!Array.isArray(rowValue)) {
      return null;
    }
    const row: TableCell[] = [];
    for (const cellValue of rowValue) {
      const cell = parseTableCell(cellValue);
      if (!cell) {
        return null;
      }
      row.push(cell);
    }
    rows.push(row);
  }
  return rows;
}

export interface NormalizedTableData {
  headers?: string[];
  rows: TableCell[][];
}

const TABLE_HEADER_KEYS = ['headers', 'header', 'columns', 'cols'] as const;
const TABLE_ROW_KEYS = ['rows', 'body', 'data'] as const;

export function parseTableDataLike(
  value: unknown,
): { data?: NormalizedTableData; error?: string } {
  if (!isRecord(value)) {
    return { error: '表格数据必须是对象。' };
  }

  const rawHeaders = readFirstDefinedValue(value, TABLE_HEADER_KEYS);

  const rawRows = readFirstDefinedValue(value, TABLE_ROW_KEYS);
  if (rawRows == null) {
    return { error: '表格数据缺少 rows（也可写 body/data）。' };
  }
  let rows = parseTableRows(rawRows);
  if (!rows) {
    return { error: '表格数据的 rows/body/data 必须是合法二维数组；单元格支持字符串、数字、布尔或 { text/content/value }。' };
  }

  // ── headers 双形态兼容 ──
  //
  //   形态 A：plain headers（string[] / 数字 / 布尔数组）—— 走原有 parseLabelArray，
  //          作为 NormalizedTableData.headers 输出，下游 PptxGenJS 会用默认表头样式渲染。
  //
  //   形态 B：styled headers（含 TableCell-like 对象，带 fill/style/bgColor 等）——
  //          整体 promote 成 styled rows[0]，并把 NormalizedTableData.headers 设为
  //          undefined。下游 compiler / render-model / Konva 都把它当作普通带样式
  //          的第一行渲染，AI 自带的 fill/color/bold 完整保留。
  //
  //   设计取舍：不修改 domain `StructuredElement.table.headers: string[]`（影响面
  //   38 个文件），把"styled header"完全收敛到本解析层 promote。AI 可以写：
  //     headers: [{ text: '项目', fill: '#333', bold: true, color: '#FFF' }, ...]
  //   而不需要再用"headers 留空 + rows[0] 充当 styled header"的 hack。
  //
  //   ⚠ 一旦 headers 任意一项是对象（即 TableCell-like），整个 headers 必须能 100%
  //     parseTableRows 通过；否则返回错误。不允许"部分 styled、部分静默 drop"。
  let headers: string[] | undefined;
  if (rawHeaders != null) {
    if (!Array.isArray(rawHeaders)) {
      return { error: '表头必须是数组；支持 headers/header/columns/cols。' };
    }
    const hasStyledHeader = rawHeaders.some((item) => isRecord(item));
    if (hasStyledHeader) {
      const headerCells = parseTableRows([rawHeaders]);
      if (!headerCells) {
        return {
          error: '带样式的表头必须是 (string | { text, style?, fill?, bgColor? })[] 形态；任一单元格非法都会拒绝整个解析。',
        };
      }
      // promote：styled header 作为第一行 prepend 到 rows，headers 字段置空
      rows = [...headerCells, ...rows];
      headers = undefined;
    } else {
      const labelHeaders = parseLabelArray(rawHeaders);
      if (labelHeaders == null) {
        return { error: '表头必须是字符串、数字或布尔数组；支持 headers/header/columns/cols。' };
      }
      headers = labelHeaders;
    }
  }

  return { data: { headers: headers ?? undefined, rows } };
}

// ─── 图片 ─────────────────────────────────────────────────────────────────

export function parseImageSourceInput(
  value: unknown,
): { source?: ImageSourceInput; error?: string } {
  if (isNonEmptyString(value)) {
    return { source: value.trim() };
  }
  if (!isRecord(value)) {
    return { error: 'image source must be a string or a formal image source object.' };
  }

  const kind = value.kind;
  switch (kind) {
    case 'external_url':
      return isNonEmptyString(value.url)
        ? { source: { kind, url: value.url.trim() } }
        : { error: 'external_url source requires url.' };
    case 'data_uri':
      return isNonEmptyString(value.dataUri)
        ? { source: { kind, dataUri: value.dataUri.trim() } }
        : { error: 'data_uri source requires dataUri.' };
    case 'local_path':
      return isNonEmptyString(value.path)
        ? { source: { kind, path: value.path.trim() } }
        : { error: 'local_path source requires path.' };
    case 'generated_asset':
      return isNonEmptyString(value.assetId)
        ? { source: { kind, assetId: value.assetId.trim() } }
        : { error: 'generated_asset source requires assetId.' };
    case 'brush_artwork':
      try {
        return { source: normalizeBrushArtworkSourceRef(value) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Invalid Brush artwork source.' };
      }
    default:
      return { error: 'image source kind must be external_url / data_uri / local_path / generated_asset / brush_artwork.' };
  }
}

export function parseSvgGraphicAuthoringSource(
  value: unknown,
): { source?: SvgGraphicAuthoringSource; error?: string } {
  if (isNonEmptyString(value)) {
    return { source: { kind: 'inline_svg', svg: value } };
  }
  if (!isRecord(value)) {
    return { error: 'SVG Graphic source must be inline SVG text or a formal source object.' };
  }

  switch (value.kind) {
    case 'inline_svg':
      return isNonEmptyString(value.svg)
        ? { source: { kind: 'inline_svg', svg: value.svg } }
        : { error: 'inline_svg source requires non-empty svg.' };
    case 'local_path':
      return isNonEmptyString(value.path)
        ? { source: { kind: 'local_path', path: value.path.trim() } }
        : { error: 'local_path SVG Graphic source requires path.' };
    case 'conversation_file':
      return isNonEmptyString(value.locator)
        ? { source: { kind: 'conversation_file', locator: value.locator.trim() } }
        : { error: 'conversation_file SVG Graphic source requires locator.' };
    default:
      return {
        error: 'SVG Graphic source kind must be inline_svg / local_path / conversation_file.',
      };
  }
}

// ─── 内部辅助 ─────────────────────────────────────────────────────────────

function readFirstDefinedValue(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}
