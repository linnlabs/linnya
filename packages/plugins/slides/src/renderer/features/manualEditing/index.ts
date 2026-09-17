export type {
  ManualEditableTarget,
  ManualEditableTargetPath,
  ManualEditingSelectionFragment,
  ManualEditIntent,
  ManualEditingTranslationPreview,
  ManualEditingVisualOperation,
  ManualEditingVisualPreview,
} from './definitions/manualEditingTypes';
export {
  collectManualEditableTargets,
  createPresentedTextEditingTarget,
  type ManualEditingHitProjection,
  findManualEditableTargetAtPoint,
  findManualEditableTargetPathAtPoint,
  findManualEditableTargetPathByElementId,
} from './functions/manualEditableTargets';
export { resolveManualClickSelection } from './functions/resolveManualClickSelection';
export { appendManualEditIntent } from './functions/appendManualEditIntent';
export {
  createManualVisualPreview,
  projectManualEditableTargetSelection,
  projectManualVisualPreviewsToRenderNode,
  projectManualVisualPreviewsToSelectionPolygon,
} from './functions/manualVisualPreview';
export {
  collectManualTranslationPreviews,
  collectManualVisualPreviews,
  mergeManualTranslationPreviews,
  resolveManualTargetTranslation,
} from './functions/manualIntentPreviews';
export {
  resolveManualEditingAvailability,
  type ManualEditingAvailability,
  type ManualEditingUnavailableReason,
} from './functions/manualEditingAvailability';
export { createManualEditCommand } from './functions/createManualEditCommand';
export {
  createManualDeleteOperation,
  type ManualDeleteOperation,
} from './functions/createManualDeleteOperation';
export { shouldHandleManualDeleteShortcut } from './functions/manualDeleteShortcut';
export {
  resolveManualEditingCursor,
  type ManualEditingCursor,
} from './functions/manualEditingCursor';
export { readManualEditErrorMessage } from './functions/manualEditOutcomeMessage';
export { submitManualEdit } from './orchestration/submitManualEdit';
export type { SubmitManualEditOutcome, SubmitManualEditPorts } from './definitions/manualEditSubmission';
export { useSlidesManualEditingStore } from './store/slidesManualEditingStore';
export { useManualEditQueue } from './orchestration/useManualEditQueue';
export { provideManualEditSubmission, useManualEditSubmission } from './ports/manualEditSubmission';
export type { ManualEditQueueEntry, ManualEditSubmissionState, ManualEditSettlement, ManualEditTicket, ManualEditSubmissionPort } from './definitions/manualEditQueue';
export type { ManualEditQueuePorts } from './definitions/manualEditQueuePorts';
export { useManualEditingLocalization } from './ui/useManualEditingLocalization';
export { default as ManualResizeHandles } from './ui/ManualResizeHandles.vue';
export { canResizeManualTarget } from './functions/manualResize';
export {
  ManualEditPresentationTrace,
  manualEditPresentationTrace,
  type ManualEditPresentationTraceDeps,
} from './orchestration/ManualEditPresentationTrace';
export type { ManualEditPresentationTracePort } from './definitions/manualEditPresentationTrace';
