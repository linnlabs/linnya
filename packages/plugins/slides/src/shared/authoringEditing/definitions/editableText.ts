import type { LayoutPlainTextRun, LayoutTextStyleInput } from '../../flexComposeContract';

/** 与 Text.content 相同的作者值；公式不属于本期手动编辑合同。 */
export type SlidesEditableTextContent = string | LayoutPlainTextRun[];
export interface SlidesTextStylePatch {
  readonly fontSizePt?: number;
  readonly color?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly align?: 'left' | 'center' | 'right';
}
export interface SlidesTextSelectionStyle {
  /** null 表示选区内混合样式，不能用首字冒充整个选区。 */
  readonly fontSizePt: number | null;
  readonly color: string | null;
  readonly bold: boolean | null;
  readonly italic: boolean | null;
  readonly underline: boolean | null;
}
export type SlidesAuthorTextStyle = LayoutTextStyleInput;

export interface SlidesTextStyleBase {
  readonly fontSizePt: number;
  readonly color: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
}
export const SLIDES_TEXT_STYLE_FIELDS = ['fontSizePt', 'color', 'bold', 'italic', 'underline', 'align'] as const;
