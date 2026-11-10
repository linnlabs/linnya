import type { CanvasCardId, CanvasElement } from '@plugin/canvas/shared';
export interface CanvasDuplicationInput {
  readonly elements: readonly CanvasElement[];
  readonly ids: readonly CanvasCardId[];
  readonly dx: number;
  readonly dy: number;
  readonly allocateReferenceId: () => string;
}
