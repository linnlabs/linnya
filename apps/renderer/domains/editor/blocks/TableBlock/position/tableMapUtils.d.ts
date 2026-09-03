import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { TableMap } from '@tiptap/pm/tables';
import type { TableRect } from '../ui/composables/types/tableAiTypes';

export interface TableCellInfo extends TableRect {
  row: number;
  col: number;
  posInTableContent: number | undefined;
}

export function getTableMap(tableNode: ProseMirrorNode | null | undefined): TableMap | null;

export function getCellOffsetAtLogicalPosition(
  map: TableMap | null | undefined,
  rowIndex: number,
  colIndex: number
): number | null;

export function getCellInfoFromTableMap(
  map: TableMap | null | undefined,
  tableNode: ProseMirrorNode | null | undefined,
  offsetFromTableContentStart: number
): TableCellInfo | null;

export function getCellRectFromCellNodePos(
  map: TableMap | null | undefined,
  cellNodeDocPos: number,
  tableStartPos: number
): TableRect | null;
