import type { Editor } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';

export type TableCellAlignment = 'left' | 'center' | 'right';

export interface TableAlignmentCommandProps {
  tr: Transaction;
  state: EditorState;
  dispatch?: (transaction: Transaction) => void;
  editor?: Editor;
}

export function setCellAlignment(
  alignment: TableCellAlignment
): (props: TableAlignmentCommandProps) => boolean;

export function alignCellLeft(editor: Editor | null | undefined): boolean;

export function alignCellCenter(editor: Editor | null | undefined): boolean;

export function alignCellRight(editor: Editor | null | undefined): boolean;
