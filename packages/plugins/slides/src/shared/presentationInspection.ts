import type { PresentationRenderModel } from './renderModel';
import type { SourceLocationHint } from './toolFeedback';

export type PresentationInspectionSelection =
  | { readonly kind: 'all' }
  | { readonly kind: 'single'; readonly slideNumber: number }
  | {
      readonly kind: 'range';
      readonly fromSlideNumber: number;
      readonly toSlideNumber: number;
    };

export interface PresentationInspectionSourceRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface PresentationInspectionRequest {
  readonly presentationId: string;
  readonly selection: PresentationInspectionSelection;
  readonly maxSlides?: number;
  readonly includeHeuristics: boolean;
  readonly focus?: readonly PresentationInspectionSourceRange[];
}

export interface PresentationInspectionSnapshot {
  readonly versionId: string;
  readonly renderModel: PresentationRenderModel;
}

export interface PresentationInspectionFeedbackOptions {
  readonly includeHeuristics: boolean;
  readonly sourceLocations?: ReadonlyMap<number, SourceLocationHint>;
  readonly sourceSpanUseCounts: ReadonlyMap<string, number>;
  readonly focus?: readonly PresentationInspectionSourceRange[];
}
