export { default as InlineTextEditor } from './ui/InlineTextEditor.vue';
export { createTextEditingTarget } from './functions/createTextEditingTarget';
export { createInlineTextEditorStyle } from './functions/createInlineTextEditorStyle';
export type {
  InlineTextEditorStyle,
  InlineTextEditorViewport,
} from './functions/createInlineTextEditorStyle';
export type {
  TextEditingPadding,
  TextEditingPoint,
  TextEditingTarget,
} from './definitions/textEditingTypes';
export { default as TextDraftPreview } from './ui/TextDraftPreview.vue';
