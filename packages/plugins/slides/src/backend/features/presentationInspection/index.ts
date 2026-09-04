export { buildSourceLocationMap } from './functions/buildSourceLocationMap';
export { countSourceSpanUses } from './functions/countSourceSpanUses';
export type { PresentationSourceStructure } from './functions/buildSourceLocationMap';
export {
  resolvePresentationInspectionSelection,
} from './functions/resolvePresentationInspectionSelection';
export type {
  ResolvedPresentationInspectionSelection,
} from './functions/resolvePresentationInspectionSelection';
export { PresentationInspectionRuntime } from './orchestration/PresentationInspectionRuntime';
export type {
  PresentationInspectionRuntimeDeps,
} from './orchestration/PresentationInspectionRuntime';
export type {
  DiagnosticToolFeedbackPayload,
  FocusedInspectionAxisRelation,
  FocusedInspectionNode,
  FocusedInspectionRelation,
  FocusedInspectionResult,
  PresentationInspectionResult,
} from './definitions/presentationInspection';
export { buildInspectionObservation } from './functions/buildInspectionObservation';
export type { InspectionObservationInput } from './functions/buildInspectionObservation';
export {
  projectDiagnosticFindings,
  summarizeDiagnosticProjection,
} from './functions/projectDiagnosticFindings';
export type {
  DiagnosticDeclaredRootGroup,
  DiagnosticProjection,
  DiagnosticProjectionBlock,
  DiagnosticProjectionSummary,
  DiagnosticRootGroup,
  DiagnosticSharedSourceRootGroup,
} from './functions/projectDiagnosticFindings';
