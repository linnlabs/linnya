import type { CanvasCard, CanvasRectangle } from '../../../shared';

export interface CanvasSpatialEntry {
  card: CanvasCard;
  rank: number;
  bounds: CanvasRectangle;
  readonly opaque: boolean;
  readonly keys: readonly string[];
}
export interface CanvasSpatialCell {
  readonly key: string;
  readonly bounds: CanvasRectangle;
  readonly entries: Set<CanvasSpatialEntry>;
}
export interface CanvasSpatialProjectionStats {
  readonly spatialCards: number;
  readonly spatialCells: number;
  readonly spatialLargeCards: number;
  readonly spatialCachedCells: number;
  readonly spatialCellCapacity: number;
  readonly spatialCandidateCards: number;
  readonly spatialQueryCards: number;
  readonly spatialHitCandidates: number;
  readonly spatialCellBuilds: number;
}
