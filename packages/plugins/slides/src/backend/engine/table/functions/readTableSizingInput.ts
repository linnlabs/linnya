import { isRecord } from '@linnya/foundation';
import type { TableCellPadding } from '@plugin/slides/shared';

/**
 * 单元格内边距上限（英寸）。PptxGenJS 把小于 1 的边距当英寸、不小于 1 的当磅，
 * 上限远低于 1，导出时不会被误读成磅；也挡住把边距当列宽用的写法。
 */
export const TABLE_CELL_PADDING_MAX_INCHES = 0.5;

export type TableSizingReadResult<T> = { readonly value: T | undefined } | { readonly error: string };

/**
 * `Table.columnWidths` 的准入：大于 0 的数字，个数等于表格列数。
 * deck.js 编译与 compose JSON 读取共用，保证布局函数拿到的比例总是合法的。
 */
export function readTableColumnWidths(
  value: unknown,
  columnCount: number,
  path: string,
): TableSizingReadResult<number[]> {
  if (value == null) return { value: undefined };
  if (!Array.isArray(value) || value.length === 0) {
    return { error: `${path} 必须是非空的数字数组。` };
  }
  const widths: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item) || item <= 0) {
      return { error: `${path} 的每一项都必须是大于 0 的数字。` };
    }
    widths.push(item);
  }
  if (widths.length !== columnCount) {
    return {
      error: `${path} 需要 ${columnCount} 个数（与表格列数一致，合并单元格按占据的列计），实际 ${widths.length} 个。`,
    };
  }
  return { value: widths };
}

/** `Table.cellPadding` 的准入：一个数表示四边相同，`{ x, y }` 分别设左右与上下，单位英寸。 */
export function readTableCellPadding(value: unknown, path: string): TableSizingReadResult<TableCellPadding> {
  if (value == null) return { value: undefined };
  if (typeof value === 'number') {
    const error = checkPaddingValue(value, path);
    return error ? { error } : { value: { x: value, y: value } };
  }
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'x' && key !== 'y')) {
    return { error: `${path} 必须是数字或 { x, y }。` };
  }
  if (value.x == null && value.y == null) {
    return { error: `${path} 至少要写 x 或 y。` };
  }
  const padding: TableCellPadding = {};
  for (const side of ['x', 'y'] as const) {
    const sideValue = value[side];
    if (sideValue == null) continue;
    const error = checkPaddingValue(sideValue, `${path}.${side}`);
    if (error) return { error };
    if (typeof sideValue === 'number') padding[side] = sideValue;
  }
  return { value: padding };
}

function checkPaddingValue(value: unknown, path: string): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} 必须是数字（英寸）。`;
  if (value < 0 || value > TABLE_CELL_PADDING_MAX_INCHES) {
    return `${path} 必须在 0 到 ${TABLE_CELL_PADDING_MAX_INCHES} 英寸之间。`;
  }
  return undefined;
}
