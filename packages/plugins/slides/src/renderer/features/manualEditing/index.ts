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
export {
  submitManualEdit,
  type SubmitManualEditOutcome,
  type SubmitManualEditPorts,
} from './orchestration/submitManualEdit';
export { useSlidesManualEditingStore } from './store/slidesManualEditingStore';
export { useSlideManualEditingInteraction } from './orchestration/useSlideManualEditingInteraction';
export { useManualEditingLocalization } from './ui/useManualEditingLocalization';
export { default as ManualSelectionBreadcrumb } from './ui/ManualSelectionBreadcrumb.vue';
export {
  ManualEditPresentationTrace,
  manualEditPresentationTrace,
  type ManualEditPresentationTraceDeps,
} from './orchestration/ManualEditPresentationTrace';
export type { ManualEditPresentationTracePort } from './definitions/manualEditPresentationTrace';
