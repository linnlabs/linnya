import type { TextStyle } from '@plugin/slides/shared/deckSpec';
import type { TextEditingTarget } from '../definitions/textEditingTypes';

/** 作者字号保持 pt，CSS em 继承外层的幻灯片缩放与 autofit；绝不反写屏幕像素。 */
export function authorTextCss(style: TextStyle | undefined, target: TextEditingTarget): Record<string, string> {
  if (!style) return {};
  return {
    ...(style.fontSize !== undefined ? { fontSize: `${style.fontSize / target.fontSizePt}em` } : {}),
    ...(style.fontFamily !== undefined ? { fontFamily: style.fontFamily } : {}),
    ...(style.color !== undefined ? { color: style.color } : {}),
    ...(style.bold !== undefined ? { fontWeight: style.bold ? 'bold' : 'normal' } : {}),
    ...(style.italic !== undefined ? { fontStyle: style.italic ? 'italic' : 'normal' } : {}),
    ...(style.underline !== undefined ? { textDecoration: style.underline ? 'underline' : 'none' } : {}),
    ...(style.letterSpacing !== undefined ? { letterSpacing: `${style.letterSpacing / (style.fontSize ?? target.fontSizePt)}em` } : {}),
    ...(style.lineSpacing ? { lineHeight: style.lineSpacing.kind === 'multiple' ? String(style.lineSpacing.value)
      : `${style.lineSpacing.value / (style.fontSize ?? target.fontSizePt)}em` } : {}),
  };
}
