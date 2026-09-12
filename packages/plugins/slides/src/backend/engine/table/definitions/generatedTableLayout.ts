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
  fontSize: number;
  headerFontSize: number;
  padding: number;
}
