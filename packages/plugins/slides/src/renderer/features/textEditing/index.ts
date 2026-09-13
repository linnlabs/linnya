export { default as InlineTextEditor } from './ui/InlineTextEditor.vue';
export { createTextEditingTarget } from './functions/createTextEditingTarget';
export { createInlineTextEditorStyle } from './functions/createInlineTextEditorStyle';
export { useSlideTextEditingSession } from './orchestration/useSlideTextEditingSession';
export { useSlidesTextEditingStore } from './store/slidesTextEditingStore';
export type {
  InlineTextEditorStyle,
  InlineTextEditorViewport,
} from './functions/createInlineTextEditorStyle';
export type {
  TextEditingCommitResult,
  TextEditingPadding,
  TextEditingPoint,
  TextEditingTarget,
} from './definitions/textEditingTypes';
