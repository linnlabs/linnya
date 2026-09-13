/** 作者对象允许执行的有限人工操作。 */
export type SlidesAuthoringEditCapability =
  | 'translate'
  | 'set_text_content'
  | 'set_text_style'
  | 'set_fill_color'
  | 'set_visual_size'
  | 'delete';

/** 文本编辑事实来自作者输入，不能根据排版后的字体 run 反推。 */
export type SlidesAuthoringTextEditProjection =
  | {
      readonly kind: 'plain_text';
      readonly content: string;
      readonly fontSizePt?: number;
      readonly color?: string;
    }
  | { readonly kind: 'rich_text' };

export type SlidesAuthoringFillEditProjection =
  | { readonly kind: 'solid'; readonly color: string }
  | { readonly kind: 'non_solid' };

/**
 * 编译器投影给 Renderer 的最小编辑合同。
 *
 * 该合同描述作者语义和能力；RenderNode 的 paragraphs/layout 仍只描述显示结果。
 */
export interface SlidesAuthoringEditProjection {
  readonly capabilities: readonly SlidesAuthoringEditCapability[];
  readonly text?: SlidesAuthoringTextEditProjection;
  readonly fill?: SlidesAuthoringFillEditProjection;
}
