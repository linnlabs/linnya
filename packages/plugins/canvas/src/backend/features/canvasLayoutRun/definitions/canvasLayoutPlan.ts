import type { CanvasCard, CanvasCardId, CanvasEdge, CanvasLayoutDiagnostic, CanvasLayoutRequest, CanvasPoint } from '../../../../shared';

export interface CanvasLayoutScope {
  readonly cards: readonly CanvasCard[];
  readonly obstacles: readonly CanvasCard[];
  readonly edges: readonly CanvasEdge[];
  readonly diagnostics: readonly CanvasLayoutDiagnostic[];
}
export interface CanvasLayoutPosition extends CanvasPoint { readonly id: CanvasCardId }
export interface CanvasLayoutAlgorithm {
  (cards: readonly CanvasCard[], edges: readonly CanvasEdge[], options: CanvasLayoutRequest): Promise<readonly CanvasLayoutPosition[]>;
}
