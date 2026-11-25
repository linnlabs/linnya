import type { TableCell, TableCellPadding } from '@plugin/slides/shared';

export interface GeneratedTableCell {
  cell: TableCell;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  isHeader: boolean;
}

export interface GeneratedTableLayoutInput {
  width?: number;
  height?: number;
  headers?: string[];
  rows: TableCell[][];
  fontSize?: number;
  /** 作者声明的列宽比例；个数必须等于列数，由准入入口先校验。 */
  columnWidths?: readonly number[];
  /** 作者声明的内边距（英寸）；未写的一侧按密度自动取值。 */
  cellPadding?: TableCellPadding;
}

/** 单元格内边距（英寸）：x 用于左右，y 用于上下。 */
export interface GeneratedTableCellPadding {
  x: number;
  y: number;
}

export interface GeneratedTableLayout {
  columns: number[];
  rows: number[];
  cells: GeneratedTableCell[];
  width: number;
  height: number;
  /** 盒高小于固有高度时的压缩比例（1 = 未压缩）；fontSize、headerFontSize、padding 已乘过它。 */
  fontScale: number;
  fontSize: number;
  headerFontSize: number;
  padding: GeneratedTableCellPadding;
}
