import type { CanvasCardId } from '@plugin/canvas/shared';
export interface CanvasKeyboardActions {
  isEditing(): boolean;
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
