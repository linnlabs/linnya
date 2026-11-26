import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { TableMap } from '@tiptap/pm/tables';

export interface TableInsertionRect {
  readonly map: TableMap;
  readonly table: ProseMirrorNode;
  readonly tableStart: number;
}

export interface TableColumnInsertionResult {
  readonly firstInsertedContentPos: number;
  readonly insertedCellCount: number;
  readonly expandedCellCount: number;
}

export function insertTableColumnAt(params: {
  readonly tr: Transaction;
  readonly rect: TableInsertionRect;
  readonly col: number;
  readonly createId?: () => string;
  readonly defaultColumnWidth?: number;
}): TableColumnInsertionResult | null;
