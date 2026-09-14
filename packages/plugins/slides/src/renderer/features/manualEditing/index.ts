export type {
  ManualEditableTarget,
  ManualEditableTargetPath,
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
export {
  createManualVisualPreview,
  projectManualVisualPreviewToRenderNode,
  projectManualVisualPreviewToSelectionPolygon,
} from './functions/manualVisualPreview';
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
