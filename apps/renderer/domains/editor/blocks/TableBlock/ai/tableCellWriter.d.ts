import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

export interface TableStateReadEditor {
  state: EditorState;
}

export interface TableCellWriteEditor extends TableStateReadEditor {
  view: {
    editable: boolean;
    dispatch(transaction: Transaction): void;
  };
}

export function insertOrAppendTextInCell(
  editor: TableCellWriteEditor,
  tableNode: ProseMirrorNode,
  tablePos: number,
  rowIndex: number,
  colIndex: number,
  textChunk: string,
  isAppend: boolean
): boolean;
