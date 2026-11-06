import type {
  CanvasCard,
  CanvasCardId,
  CanvasEdge,
  CanvasLayoutDiagnostic,
  CanvasLayoutRequest,
  CanvasLayoutResult,
  CanvasPoint,
} from '../../../../shared';

export interface CanvasLayoutScope {
  readonly cards: readonly CanvasCard[];
  readonly obstacles: readonly CanvasCard[];
  readonly edges: readonly CanvasEdge[];
  readonly diagnostics: readonly CanvasLayoutDiagnostic[];
}
export interface CanvasLayoutPosition extends CanvasPoint {
  readonly id: CanvasCardId;
}
export interface CanvasLayoutAlgorithm {
  (
    cards: readonly CanvasCard[],
    edges: readonly CanvasEdge[],
    options: CanvasLayoutRequest
  ): Promise<readonly CanvasLayoutPosition[]>;
}

/** 纯规则计划没有时钟；真实线程执行完成后才补充computation。 */
export type CanvasLayoutPlan = Pick<CanvasLayoutResult, 'sequence' | 'operations' | 'diagnostics'>;
