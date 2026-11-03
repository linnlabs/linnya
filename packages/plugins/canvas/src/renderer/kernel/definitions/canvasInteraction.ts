import type { CanvasCamera, CanvasCardId, CanvasPoint } from '../../../shared';

export interface CanvasPointerGesture {
  readonly pointer: number;
  readonly screen: CanvasPoint;
  readonly world: CanvasPoint;
  readonly camera: CanvasCamera;
  readonly id: CanvasCardId | null;
  readonly pan: boolean;
  readonly selection: readonly CanvasCardId[];
  readonly additive: boolean;
  moved: boolean;
}

