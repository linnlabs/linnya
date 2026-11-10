import type { CanvasCard, CanvasCardId } from '../../../../shared';

export interface CanvasLayoutTree {
  readonly nodes: ReadonlyMap<CanvasCardId, CanvasCard>;
  readonly children: ReadonlyMap<CanvasCardId, readonly CanvasCardId[]>;
  readonly depth: ReadonlyMap<CanvasCardId, number>;
  readonly roots: readonly CanvasCardId[];
  readonly order: readonly CanvasCardId[];
  readonly repeated: ReadonlySet<CanvasCardId>;
}
export interface CanvasTreeDimensions {
  readonly cross: ReadonlyMap<CanvasCardId, number>;
  readonly mainOffsets: readonly number[];
}
