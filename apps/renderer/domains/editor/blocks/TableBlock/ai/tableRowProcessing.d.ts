import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { AiSourceDataRef } from './tableAiUtils.js';
import type { TableStateReadEditor } from './tableCellWriter.js';

export function getRowDataContext(
  editor: TableStateReadEditor,
  tableNode: ProseMirrorNode,
  tablePos: number,
  activeInputRefs: AiSourceDataRef[],
  rowIndex: number
): Record<string, string>;

export function constructPromptForRow(
  editor: TableStateReadEditor,
  tableNode: ProseMirrorNode,
  tablePos: number,
  userPromptTemplate: string,
  activeInputRefs: AiSourceDataRef[],
  rowIndex: number
): string | null;
