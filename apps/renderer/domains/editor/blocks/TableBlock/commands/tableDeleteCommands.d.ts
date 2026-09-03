import type { Editor } from '@tiptap/core';

export function deleteRow(editor: Editor | null | undefined): boolean;

export function deleteColumn(editor: Editor | null | undefined): boolean;

export function deleteColumnByIndex(
  editor: Editor | null | undefined,
  tablePos: number,
  columnIndex: number
): boolean;
