import type { CanvasCamera, CanvasCardId, CanvasEdgeId, CanvasPoint, CanvasRectangle } from '../../../shared';

export interface CanvasInteractionPreferences { readonly wheelZoom: boolean; readonly snapping: boolean }
export interface CanvasInteractionOptions { readonly readonly?: boolean; readonly readReadonly?: () => boolean; readonly readPreferences?: () => CanvasInteractionPreferences }
export interface CanvasSnapAxisTarget { readonly value: number; readonly start: number; readonly end: number }
export interface CanvasSnapTargets { readonly bounds: CanvasRectangle; readonly x: readonly CanvasSnapAxisTarget[]; readonly y: readonly CanvasSnapAxisTarget[] }

export interface CanvasPointerGesture {
  readonly pointer: number;
  readonly screen: CanvasPoint;
  readonly world: CanvasPoint;
  readonly camera: CanvasCamera;
  readonly id: CanvasCardId | null;
  readonly edgeId: CanvasEdgeId | null;
  readonly pan: boolean;
  readonly locked: boolean;
  readonly selection: readonly CanvasCardId[];
  readonly additive: boolean;
  moved: boolean;
}

