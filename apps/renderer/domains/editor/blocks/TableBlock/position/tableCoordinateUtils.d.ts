import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import type { TableRect } from '../ui/composables/types/tableAiTypes';

export interface CellPosition {
  rowIndex: number;
  colIndex: number;
}

export interface CoordinateRange {
  start: string;
  end: string;
  range: string;
}

export interface SelectionCoordinates extends CoordinateRange {
  rect: TableRect;
}

export function columnIndexToLetters(colIndex: number): string;

export function lettersToColumnIndex(letters: string): number;

export function cellPositionToCoordinate(rowIndex: number, colIndex: number): string;

export function coordinateToCellPosition(coordinate: string): CellPosition | null;

export function getCellCoordinate(
  tableNode: ProseMirrorNode,
  tablePos: number,
  cellNodePos: number
): string | null;

export function getCellPosByCoordinate(
  tableNode: ProseMirrorNode,
  tablePos: number,
  coordinate: string
): number | null;

export function getRegionCoordinates(
  tableNode: ProseMirrorNode,
  rect: TableRect
): CoordinateRange | null;

export function parseCoordinateRange(range: string): TableRect | null;

export function getSelectionCoordinates(state: EditorState): SelectionCoordinates | null;

export function getColumnHeaders(
  tableNode: ProseMirrorNode,
  hasHeaderRow?: boolean
): Record<number, string> | null;

export class TableCoordinateManager {
  static rectToRange(rect: TableRect): string | null;
  static adjustForColumnInsertion<T extends TableRect>(originalRect: T, insertedAt: number): T;
  static adjustForColumnDeletion<T extends TableRect>(originalRect: T, deletedAt: number): T | null;
  static calculateTableContentOffset(cellNodeDocPos: number, tableStartPos: number): number;
}
