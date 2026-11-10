import type { CanvasEdgeId, CanvasPoint, CanvasRectangle } from '../../../../shared';

export interface CanvasGeometryPairReport {
  readonly total: number;
  readonly samples: string[][];
}
export interface CanvasCheckedEdgeGeometry {
  readonly id: CanvasEdgeId;
  readonly points: readonly CanvasPoint[];
  readonly bounds: CanvasRectangle;
}
