import type { Editor } from '@tiptap/core';

const projecting = new WeakSet<Editor>();
export const isPendingProjectionBatch = (editor: Editor): boolean => projecting.has(editor);
export function setPendingProjectionBatch(editor: Editor, active: boolean): void {
  if (active) projecting.add(editor);
  else projecting.delete(editor);
}
