import type {
  PresentationInspectionSourceRange,
  PresentationRenderModel,
  ToolFeedbackPayload,
} from '@plugin/slides/shared';
import type {
  DiagnosticFinding,
  DiagnosticNodeRef,
  DiagnosticSourceRef,
} from '../../../engine/quality/definitions';

export interface FocusedInspectionNode {
  readonly rangeIndexes: readonly number[];
  readonly slideNumber: number;
  readonly node: DiagnosticNodeRef;
  readonly sourceRef: DiagnosticSourceRef;
}

export interface FocusedInspectionAxisRelation {
  readonly kind: 'gap' | 'overlap';
  readonly inches: number;
}

export interface FocusedInspectionRelation {
  readonly slideNumber: number;
  readonly rangeIndexes: readonly [number, number];
  readonly nodes: readonly [DiagnosticNodeRef, DiagnosticNodeRef];
  readonly horizontal: FocusedInspectionAxisRelation;
  readonly vertical: FocusedInspectionAxisRelation;
}

export interface FocusedInspectionResult {
  readonly ranges: readonly PresentationInspectionSourceRange[];
  readonly nodes: readonly FocusedInspectionNode[];
  readonly relations: readonly FocusedInspectionRelation[];
}

/** 完整诊断事实只在 backend 组合，不进入跨端 shared DTO。 */
export interface DiagnosticToolFeedbackPayload extends ToolFeedbackPayload {
  readonly findings: readonly DiagnosticFinding[];
  readonly focus?: FocusedInspectionResult;
}

export interface PresentationInspectionResult {
  readonly versionId: string;
  readonly renderModel: PresentationRenderModel;
  readonly totalSlideCount: number;
  readonly requestedSlideNumbers: readonly number[];
  readonly truncated: boolean;
  readonly feedback: DiagnosticToolFeedbackPayload;
}
