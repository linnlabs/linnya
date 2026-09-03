export type {
  SourceSelectionEditSubmitPayload,
  SourceSelectableElement,
  SourceSelectionMarquee,
  SourceSelectionPoint,
  SourceSelectionRect,
} from './definitions/sourceSelectionTypes';
export {
  collectSourceElementsInRect,
  collectSourceSelectableElements,
  findSourceElementAtPoint,
  findSourceElementsByIds,
} from './functions/renderNodeSourceSelection';
export {
  normalizeSourceSelectionIds,
  resolveSourceElementClickSelection,
  resolveSourceMarqueeSelection,
} from './functions/sourceSelectionState';
export {
  rectFromPoints,
} from './functions/sourceSelectionGeometry';
export {
  resolveSourceSelectionPromptPosition,
  type SourceSelectionPromptPosition,
} from './functions/sourceSelectionPromptPosition';
export {
  resolveSourceSelectionAvailability,
  formatSourceSelectionUnavailableReason,
  type SourceSelectionAvailability,
  type SourceSelectionUnavailableReason,
} from './functions/sourceSelectionAvailability';
export { useSlideSourceSelectionInteraction } from './orchestration/useSlideSourceSelectionInteraction';
export { useSlidesSourceSelectionStore } from './store/slidesSourceSelectionStore';
export { default as SourceSelectionPromptPopover } from './ui/SourceSelectionPromptPopover.vue';
