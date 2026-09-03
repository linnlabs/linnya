import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Selection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { CellSelection } from '@tiptap/pm/tables';
import type { TableRect, TargetColumn } from '../ui/composables/types/tableAiTypes';

export interface TableAiInputPosition {
  top: number;
  left: number;
  bottom: number;
  targetColumn: TargetColumn;
}

export interface ExtractedColumnReference {
  name: string;
  reference: string;
  range: string;
  rect: TableRect;
}

export interface ExtractedColumnReferenceContext {
  columnRefs: ExtractedColumnReference[];
  selectionRange: string;
  rawRect: TableRect;
  targetColumn: TargetColumn;
  rowCount: number;
  columnCount: number;
}

export function calculateTableAiInputPosition(
  editorView: EditorView,
  selection: Selection
): TableAiInputPosition | null;

export function extractColumnReferences(
  state: EditorState,
  selection: CellSelection
): ExtractedColumnReferenceContext | null;

export function getTableColumnHeaders(tableNode: ProseMirrorNode): string[];
