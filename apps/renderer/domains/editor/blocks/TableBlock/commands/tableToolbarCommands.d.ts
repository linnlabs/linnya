import type { Editor } from '@tiptap/core';

export type CommandExecutingSetter = (isExecuting: boolean) => void;

export function addRowBefore(editor: Editor | null | undefined): boolean;

export function addRowAfter(editor: Editor | null | undefined): boolean;

export function addColumnBefore(
  editor: Editor | null | undefined,
  setCommandExecuting?: CommandExecutingSetter
): boolean;

export function addColumnAfter(
  editor: Editor | null | undefined,
  setCommandExecuting?: CommandExecutingSetter
): boolean;
