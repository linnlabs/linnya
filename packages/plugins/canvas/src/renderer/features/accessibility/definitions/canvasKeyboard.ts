import type { CanvasCardId } from '@plugin/canvas/shared';
export interface CanvasKeyboardActions {
  isEditing(): boolean;
  treeMode?(): boolean;
  createTree?(kind: 'child' | 'sibling'): Promise<void>;
  selection(): readonly CanvasCardId[];
  allIds(): readonly CanvasCardId[];
  zoomValue(): number;
  duplicate(): Promise<void>;
  undo(direction: 'undo' | 'redo'): Promise<void>;
  remove(): Promise<void>;
  edit(): Promise<void>;
  escape(): Promise<void>;
  select(ids: readonly CanvasCardId[]): Promise<void>;
  fit(selected?: boolean): void;
  zoom(value: number): void;
  move(ids: readonly CanvasCardId[], dx: number, dy: number): Promise<void>;
}
export type CanvasShortcut = 'delete' | 'edit' | 'escape' | 'all' | 'actual' | 'fit' | 'fit-selection' | 'zoom-in' | 'zoom-out' | 'undo' | 'redo' | 'duplicate' | 'left' | 'right' | 'up' | 'down' | 'tree-child' | 'tree-sibling';
