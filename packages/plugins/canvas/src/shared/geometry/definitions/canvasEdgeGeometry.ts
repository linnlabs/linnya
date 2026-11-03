import type { CanvasPoint } from './canvasGeometry';

export type CanvasEdgeSide = 'top' | 'right' | 'bottom' | 'left';
export interface CanvasEdgeGeometry {
  readonly from: CanvasPoint;
  readonly to: CanvasPoint;
  readonly midpoint: CanvasPoint;
  readonly points: readonly CanvasPoint[];
  readonly fromSide: CanvasEdgeSide | null;
  readonly toSide: CanvasEdgeSide | null;
}
