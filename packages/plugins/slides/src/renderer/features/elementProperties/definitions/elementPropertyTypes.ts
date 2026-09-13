import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';

export type ElementPropertyOperation = Extract<
  SlidesManualEditOperation,
  { readonly op: 'set_text_style' | 'set_fill_color' | 'set_visual_size' | 'delete_target' }
>;
