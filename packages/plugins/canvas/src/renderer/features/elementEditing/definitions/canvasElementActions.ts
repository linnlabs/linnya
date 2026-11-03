import type { CanvasCardId } from '@plugin/canvas/shared';
export interface CanvasElementActionSelection {
  read(): readonly CanvasCardId[];
  select(ids: readonly CanvasCardId[]): Promise<void>;
}

export type CanvasAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'grid';
export type CanvasDistribution = 'horizontal' | 'vertical';
