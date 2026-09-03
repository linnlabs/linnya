import type { Extension } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import type { ActiveColumnRefs, OutputRect, TableInfo } from '../ui/composables/types/tableAiTypes';

export const TABLE_SELECTION_DECORATOR_KEY: 'tableSelectionDecorator';
export const COLUMN_REFS_DECORATOR_KEY: 'columnRefsDecorator';

export const TableSelectionDecoratorExtension: Extension;

export function setColumnRefs(
  tr: Transaction,
  refs: ActiveColumnRefs,
  tableInfo: Pick<TableInfo, 'node' | 'pos' | 'rootBlockId'>
): Transaction;

export function setKeepTableSelectionVisible(
  tr: Transaction,
  keepVisible: boolean,
  outputRect?: OutputRect | null,
  suppressOutputCalc?: boolean
): Transaction;
