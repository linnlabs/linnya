import type { CanvasCardId } from '@plugin/canvas/shared';
export interface CanvasElementActionSelection {
  read(): readonly CanvasCardId[];
  select(ids: readonly CanvasCardId[]): Promise<void>;
}
