import type {
  PresentationRenderModel,
  ToolFeedbackPayload,
} from '@plugin/slides/shared';
import type { DiagnosticFinding } from '../../../engine/quality/definitions';

/** 完整诊断事实只在 backend 组合，不进入跨端 shared DTO。 */
export interface DiagnosticToolFeedbackPayload extends ToolFeedbackPayload {
  readonly findings: readonly DiagnosticFinding[];
}

export interface PresentationInspectionResult {
  readonly versionId: string;
  readonly renderModel: PresentationRenderModel;
  readonly totalSlideCount: number;
  readonly requestedSlideNumbers: readonly number[];
  readonly truncated: boolean;
  readonly feedback: DiagnosticToolFeedbackPayload;
}
