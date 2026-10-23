/**
 * @file serializeMarkdownChartSpec.ts
 * @description 图表规格的 canonical 文本与 `linnya-chart` 围栏。
 *
 * canonical 文本是 Agent 读写图表的唯一形态，必须确定、稳定且便于精确编辑：
 * 固定键序、LF、两空格缩进；每个系列一行；标量数组与小对象单行；
 * 省略 v1 合同下等于默认值的字段；数字使用 JS 最短往返表示，-0 归为 0。
 * 默认值只依赖规格本身，不读取主题、语言环境或窗口宽度。
 */

import { MARKDOWN_CHART_DEFAULT_PALETTE, MARKDOWN_CHART_FENCE_LANGUAGE } from '../definitions/markdownChartConstants';
import type { MarkdownChartSpec } from '../definitions/markdownChartSpec';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

type JsonRecord = { readonly [key: string]: JsonValue | undefined };

const TOP_LEVEL_ORDER = [
  'version', 'chartType', 'title', 'description', 'categories', 'series',
  'barDirection', 'stacking', 'categoryAxis', 'xAxis', 'valueAxis', 'secondaryValueAxis',
  'pointLabels', 'radarScale', 'showDataLabels', 'dataLabelFormat', 'dataLabelContent',
  'legendPosition', 'size', 'palette',
] as const;
const SERIES_ORDER = [
  'name', 'values', 'chartType', 'axis', 'color', 'pointColors', 'lineDash', 'marker',
  'showDataLabels', 'dataLabelFormat',
] as const;
const VALUE_AXIS_ORDER = ['title', 'min', 'max', 'majorUnit', 'numberFormat', 'showGridlines'] as const;
const CATEGORY_AXIS_ORDER = ['title', 'labelRotation'] as const;
const RADAR_SCALE_ORDER = ['min', 'max'] as const;

const AXIS_ORDERS: Readonly<Record<string, readonly string[]>> = {
  categoryAxis: CATEGORY_AXIS_ORDER,
  xAxis: VALUE_AXIS_ORDER,
  valueAxis: VALUE_AXIS_ORDER,
  secondaryValueAxis: VALUE_AXIS_ORDER,
  radarScale: RADAR_SCALE_ORDER,
};

/** v1 合同下的上下文无关默认值；canonical 文本省略它们。 */
const TOP_LEVEL_DEFAULTS: Readonly<Record<string, JsonValue>> = {
  version: 1,
  barDirection: 'vertical',
  stacking: 'none',
  size: 'medium',
  dataLabelContent: 'value',
  palette: MARKDOWN_CHART_DEFAULT_PALETTE,
};
const SERIES_DEFAULTS: Readonly<Record<string, JsonValue>> = {
  axis: 'primary',
  lineDash: 'solid',
};

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isJsonRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeScalar(key: string, value: JsonValue): JsonValue {
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
  if (typeof value === 'string' && key === 'color') return value.toUpperCase();
  return value;
}

function normalizeValue(key: string, value: JsonValue): JsonValue {
  if (isJsonArray(value)) {
    const elementKey = key === 'pointColors' ? 'color' : key;
    return value.map(item => normalizeValue(elementKey, item));
  }
  if (isJsonRecord(value)) return value;
  return normalizeScalar(key, value);
}

function orderedObject(
  source: JsonRecord,
  order: readonly string[],
  defaults: Readonly<Record<string, JsonValue>>,
): JsonRecord {
  const result: Record<string, JsonValue> = {};
  for (const key of order) {
    const value = source[key];
    if (value === undefined || defaults[key] === value) continue;
    result[key] = normalizeValue(key, value);
  }
  return result;
}

function formatInline(value: JsonValue): string {
  if (isJsonArray(value)) {
    return value.length === 0 ? '[]' : `[${value.map(formatInline).join(', ')}]`;
  }
  if (isJsonRecord(value)) {
    const entries = Object.entries(value).flatMap(([key, item]) =>
      item === undefined ? [] : [`${JSON.stringify(key)}: ${formatInline(item)}`]);
    return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
  }
  return JSON.stringify(value);
}

function canonicalTopLevelValue(key: string, value: JsonValue): JsonValue | undefined {
  const axisOrder = AXIS_ORDERS[key];
  if (axisOrder && isJsonRecord(value)) {
    const axis = orderedObject(value, axisOrder, {});
    // 次轴对象的存在表示系列有独立坐标轴，即使采用默认样式也不能在 canonical 中删掉。
    return Object.keys(axis).length === 0 && key !== 'secondaryValueAxis' ? undefined : axis;
  }
  return normalizeValue(key, value);
}

/**
 * 把已准入的规格写成 canonical JSON 文本（不含围栏）。
 * 调用方必须先完成准入；这里不重复校验，只负责确定性输出。
 */
export function serializeMarkdownChartSpec(spec: MarkdownChartSpec): string {
  const source: JsonRecord = spec;
  const lines: string[] = [];

  for (const key of TOP_LEVEL_ORDER) {
    const value = source[key];
    if (value === undefined || TOP_LEVEL_DEFAULTS[key] === value) continue;

    if (key === 'series' && isJsonArray(value)) {
      const rows = value.flatMap(item => isJsonRecord(item)
        ? [`    ${formatInline(orderedObject(item, SERIES_ORDER, SERIES_DEFAULTS))}`]
        : []);
      lines.push(`  "series": [\n${rows.join(',\n')}\n  ]`);
      continue;
    }

    const canonical = canonicalTopLevelValue(key, value);
    if (canonical === undefined) continue;
    lines.push(`  ${JSON.stringify(key)}: ${formatInline(canonical)}`);
  }

  return `{\n${lines.join(',\n')}\n}`;
}

/** 选择比正文中任何反引号序列都长的 delimiter，保证围栏不会被正文提前闭合。 */
function resolveFenceDelimiter(body: string): string {
  const runs = body.match(/`+/g) ?? [];
  const length = runs.reduce((longest, run) => Math.max(longest, run.length + 1), 3);
  return '`'.repeat(length);
}

/** 完整的 `linnya-chart` 围栏（canonical 投影）。 */
export function encodeMarkdownChartFence(spec: MarkdownChartSpec): string {
  const body = serializeMarkdownChartSpec(spec);
  const delimiter = resolveFenceDelimiter(body);
  return `${delimiter}${MARKDOWN_CHART_FENCE_LANGUAGE}\n${body}\n${delimiter}`;
}
