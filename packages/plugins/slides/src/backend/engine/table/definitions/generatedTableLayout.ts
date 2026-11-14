import type { TableCell } from '@plugin/slides/shared';

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
  padding: number;
}
