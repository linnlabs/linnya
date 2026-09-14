export type {
  ManualEditableTarget,
  ManualEditableTargetPath,
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
