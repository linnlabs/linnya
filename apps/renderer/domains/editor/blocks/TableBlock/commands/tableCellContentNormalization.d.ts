import type { Editor } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

export type TableCellContentNormalizationReason =
  | 'empty-cell'
  | 'content-block-attrs'
  | 'multiple-content-blocks'
  | 'wrapped-non-content-children';

export interface TableCellContentNormalizationResult {
  contentBlock: PMNode;
  reason: TableCellContentNormalizationReason;
}

export interface TableCellContentNormalizationTarget extends TableCellContentNormalizationResult {
  pos: number;
  cellNode: PMNode;
}

export interface TableCellContentNormalizationTransactionResult {
  tr: Transaction;
  count: number;
  reasons: TableCellContentNormalizationReason[];
}

export interface TableCellContentNormalizationOptions {
  createId?: () => string;
  metaKey?: string;
}

export function createNormalizedTableCellContentBlock(params: {
  schema: Schema;
  cellNode: PMNode;
  createId?: () => string;
}): TableCellContentNormalizationResult | null;

export function collectTableCellContentNormalizationTargets(
  state: EditorState,
  options?: TableCellContentNormalizationOptions
): TableCellContentNormalizationTarget[];

export function buildTableCellContentNormalizationTransaction(
  state: EditorState,
  options?: TableCellContentNormalizationOptions
): TableCellContentNormalizationTransactionResult | null;

export function dispatchTableCellContentNormalization(
  editor: Editor | null | undefined,
  options?: TableCellContentNormalizationOptions
): boolean;
