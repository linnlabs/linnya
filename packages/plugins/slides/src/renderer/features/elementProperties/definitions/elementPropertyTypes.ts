import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';

export type ElementPropertyOperation = Extract<
  SlidesManualEditOperation,
  { readonly op: 'set_text_style' | 'set_fill_color' | 'set_visual_size' }
>;

/** 排列动作与编辑命令中的 SelectionArrangement 同名；页面对齐用于单选，选区对齐与分布用于多选。 */
export type ElementArrangement = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distributeX' | 'distributeY';
export type ElementLayerDirection = 'front' | 'forward' | 'backward' | 'back';

/** 同级绘制顺序中还能移动的方向；已在最顶层时不能置顶、上移。 */
export interface ElementLayerAvailability {
  readonly front: boolean;
  readonly forward: boolean;
  readonly backward: boolean;
  readonly back: boolean;
}

export type ElementPropertyMenuValue =
  | `text-align:${'left' | 'center' | 'right'}`
  | `arrange:${ElementArrangement}`
  | `layer:${ElementLayerDirection}`
  | 'copy'
  | 'duplicate';
