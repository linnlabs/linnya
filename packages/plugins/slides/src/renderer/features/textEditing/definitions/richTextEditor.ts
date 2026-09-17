import type { SlidesTextSelectionStyle } from '@plugin/slides/shared/authoringEditing';

export interface InlineTextSelection {
  readonly style: SlidesTextSelectionStyle;
  /** 浏览器 viewport CSS 坐标；Stage 装配层转换为自己的 pane 坐标。 */
  readonly rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}
