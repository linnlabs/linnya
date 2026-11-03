import type { CanvasHistoryEntry } from '../../../shared/history';

export interface CanvasUserHistoryScope {
  readonly documentId: string;
  readonly viewId: string;
  readonly undo: readonly CanvasHistoryEntry[];
  readonly redo: readonly CanvasHistoryEntry[];
}
export interface CanvasHistoryViewBaseline {
  readonly documentId: string;
  readonly viewId: string;
  readonly sequence: number;
}
