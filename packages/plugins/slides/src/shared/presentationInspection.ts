import type { DirectionDeclaration } from './designDirection/definitions/directionContract';
import type { FontDeliveryTarget } from './fontDelivery';
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
  readonly manualEditWarnings?: readonly string[];
  readonly versionId: string;
  readonly renderModel: PresentationRenderModel;
  /** 生成稿的字体目标环境；导入稿不检查可交付性，留空。 */
  readonly fontTarget?: FontDeliveryTarget;
  /** 生成稿声明的视觉方向；导入稿与未声明时留空。 */
  readonly direction?: DirectionDeclaration;
}

export interface PresentationInspectionFeedbackOptions {
  readonly includeHeuristics: boolean;
  readonly sourceLocations?: ReadonlyMap<number, SourceLocationHint>;
  readonly sourceSpanUseCounts: ReadonlyMap<string, number>;
  readonly focus?: readonly PresentationInspectionSourceRange[];
  readonly fontTarget?: FontDeliveryTarget;
  readonly direction?: DirectionDeclaration;
}
