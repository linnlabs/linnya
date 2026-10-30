import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import type { RenderNode } from '../../../types/render';

export type EditingPreviewProjector = (node: RenderNode, previews: readonly EditingVisualPreview[]) => RenderNode;

export type EditingVisualOperation = Extract<SlidesManualEditOperation,
  { readonly op: 'set_text_content' | 'set_text_style' | 'set_fill_color' | 'set_visual_size' | 'set_text_width' | 'delete_target' }>;

/** revision 上的有序视觉输入；提交队列与预览派生各自持有自己的职责。 */
export interface EditingVisualPreview {
  readonly elementId: string;
  readonly affectedElementIds: readonly string[];
  readonly operation: EditingVisualOperation;
  /** 左宽度手柄的锚点补偿，与宽度一起发布；只存在于预览，不进入命令。 */
  readonly translationDelta?: { readonly dx: number; readonly dy: number };
}
