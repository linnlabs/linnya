import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';

export type EditingVisualOperation = Extract<SlidesManualEditOperation,
  { readonly op: 'set_text_content' | 'set_text_style' | 'set_fill_color' | 'set_visual_size' | 'delete_target' }>;

/** revision 上的有序视觉输入；提交队列与预览派生各自持有自己的职责。 */
export interface EditingVisualPreview {
  readonly elementId: string;
  readonly affectedElementIds: readonly string[];
  readonly operation: EditingVisualOperation;
}
