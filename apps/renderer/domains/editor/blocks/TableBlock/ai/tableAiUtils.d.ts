import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import type { TableRect } from '../ui/composables/types/tableAiTypes';

export type { TableCellWriteEditor, TableStateReadEditor } from './tableCellWriter.js';
export { insertOrAppendTextInCell } from './tableCellWriter.js';

export interface RegionCellInfo {
  pos: number;
  node: ProseMirrorNode;
  rowIndex: number;
  colIndex: number;
  isHeader: boolean;
  content: string;
  coordinate: string;
}

export type TableCellContentFormat = 'text' | 'html' | 'json';
export type SerializedTableFormat = 'json' | 'csv' | 'markdown';

export interface SerializedSelectionData {
  data: unknown;
  coordinates: {
    start: string;
    end: string;
    range: string;
  } | null;
  rect: TableRect;
}

export interface TableSelectionForAiOptions {
  format?: SerializedTableFormat;
  withHeaders?: boolean;
}

export interface TableSelectionForAiResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  data: unknown;
}

export interface AiSourceDataRef {
  refKey: string;
  label: string;
  rect: TableRect;
}

export function getCellsInRegion(
  state: EditorState,
  tableNode: ProseMirrorNode,
  tablePos: number,
  rect: TableRect
): RegionCellInfo[];

export function getCellContent(
  cellNode: ProseMirrorNode,
  format?: TableCellContentFormat
): string | Record<string, unknown>;

export function getTableDataAsArray(
  state: EditorState,
  tableNode: ProseMirrorNode,
  tablePos: number,
  rect?: TableRect | null
): string[][];

export function serializeTableRegion(
  state: EditorState,
  tableNode: ProseMirrorNode,
  tablePos: number,
  rect: TableRect,
  format?: SerializedTableFormat
): unknown;

export function getSerializedSelectionData(
  state: EditorState,
  format?: SerializedTableFormat
): SerializedSelectionData | null;

export function getTableSelectionForAi(
  state: EditorState,
  options?: TableSelectionForAiOptions
): TableSelectionForAiResult;
