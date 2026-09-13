export type {
  ManualEditableTarget,
  ManualEditingTranslationPreview,
} from './definitions/manualEditingTypes';
export {
  collectManualEditableTargets,
  findManualEditableTargetAtPoint,
} from './functions/manualEditableTargets';
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
export {
  ManualEditPresentationTrace,
  manualEditPresentationTrace,
  type ManualEditPresentationTraceDeps,
} from './orchestration/ManualEditPresentationTrace';
export type { ManualEditPresentationTracePort } from './definitions/manualEditPresentationTrace';
