import type { CanvasCardId } from '@plugin/canvas/shared';
export type CanvasNavigationDirection = 'next' | 'previous' | 'left' | 'right' | 'up' | 'down';
export interface CanvasKeyboardActions {
  isEditing(): boolean;
  treeMode?(): boolean;
  createTree?(kind: 'child' | 'sibling'): Promise<void>;
  selection(): readonly CanvasCardId[];
  allIds(): readonly CanvasCardId[];
  zoomValue(): number;
  duplicate(): Promise<void>;
  /** 把选中的卡放进新分区。 */
  group(): Promise<void>;
  undo(direction: 'undo' | 'redo'): Promise<void>;
  remove(): Promise<void>;
  edit(): Promise<void>;
  escape(): Promise<void>;
  select(ids: readonly CanvasCardId[]): Promise<void>;
  fit(selected?: boolean): void;
  zoom(value: number): void;
  move(ids: readonly CanvasCardId[], dx: number, dy: number): Promise<void>;
  navigation(direction: CanvasNavigationDirection): (() => Promise<void>) | null;
}
export type CanvasShortcut =
  | 'delete'
  | 'edit'
  | 'escape'
  | 'all'
  | 'actual'
  | 'fit'
  | 'fit-selection'
  | 'zoom-in'
  | 'zoom-out'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'group'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'tree-child'
  | 'tree-sibling'
  | 'navigate';
