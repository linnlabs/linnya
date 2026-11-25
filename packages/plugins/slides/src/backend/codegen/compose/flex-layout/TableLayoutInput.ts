import type { TableCell, TableCellPadding } from '@plugin/slides/shared';
import type { LayoutTableNode } from './LayoutTypes';
import { parseTableDataLike } from '../inputParsers/dataParsers';
import { FlexComposeContractError } from './FlexComposeContractError';
import {
  countGeneratedTableColumns,
  readTableCellPadding,
  readTableColumnWidths,
} from '../../../engine/table';

export interface LayoutTableData {
  headers?: string[];
  rows: TableCell[][];
  columnWidths?: number[];
  cellPadding?: TableCellPadding;
}

/** 测量与最终元素构建消费相同的 tableData/top-level 优先级、严格单元格准入和列宽/内边距准入。 */
export function readLayoutTableData(node: LayoutTableNode): LayoutTableData {
  const parsed = parseTableDataLike({
    ...(node.tableData ?? {}),
    headers: node.headers ?? node.tableData?.headers,
    rows: node.rows ?? node.tableData?.rows ?? node.tableData?.body ?? node.tableData?.data,
  });
  if (parsed.error || !parsed.data) {
    throw new FlexComposeContractError(parsed.error ?? 'Table 数据解析失败。');
  }
  const columnWidths = readTableColumnWidths(
    node.columnWidths,
    countGeneratedTableColumns(parsed.data),
    'Table.columnWidths',
  );
  if ('error' in columnWidths) throw new FlexComposeContractError(columnWidths.error);
  const cellPadding = readTableCellPadding(node.cellPadding, 'Table.cellPadding');
  if ('error' in cellPadding) throw new FlexComposeContractError(cellPadding.error);
  return {
    ...parsed.data,
    ...(columnWidths.value ? { columnWidths: columnWidths.value } : {}),
    ...(cellPadding.value ? { cellPadding: cellPadding.value } : {}),
  };
}
