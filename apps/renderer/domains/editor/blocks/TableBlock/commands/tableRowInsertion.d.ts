import type { Transaction } from '@tiptap/pm/state';
import type { TableInsertionRect } from './tableColumnInsertion';

export interface TableRowInsertionResult {
  readonly firstInsertedContentPos: number;
  readonly insertedCellCount: number;
  readonly expandedCellCount: number;
}

export function insertTableRowAt(params: {
  readonly tr: Transaction;
  readonly rect: TableInsertionRect;
  readonly row: number;
  readonly createId?: () => string;
}): TableRowInsertionResult | null;
