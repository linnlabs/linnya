import type { LayoutPlainTextRun, LayoutTextStyleInput } from '../../flexComposeContract';

/** 与 Text.content 相同的作者值；公式不属于本期手动编辑合同。 */
export type SlidesEditableTextContent = string | LayoutPlainTextRun[];
export interface SlidesTextStylePatch {
  readonly fontSizePt?: number;
  readonly color?: string;
}
export interface SlidesTextSelectionStyle {
  /** null 表示选区内混合样式，不能用首字冒充整个选区。 */
  readonly fontSizePt: number | null;
  readonly color: string | null;
}
export type SlidesAuthorTextStyle = LayoutTextStyleInput;
