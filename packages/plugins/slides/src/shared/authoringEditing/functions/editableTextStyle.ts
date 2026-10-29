import type { SlidesAuthorTextStyle, SlidesEditableTextContent, SlidesTextSelectionStyle, SlidesTextStylePatch, SlidesTextStyleBase } from '../definitions/editableText';

export function authorTextStylePatch(patch: SlidesTextStylePatch): SlidesAuthorTextStyle {
  return { ...(patch.fontSizePt !== undefined ? { fontSize: patch.fontSizePt } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.bold !== undefined ? { bold: patch.bold } : {}), ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
    ...(patch.underline !== undefined ? { underline: patch.underline } : {}), ...(patch.align !== undefined ? { align: patch.align } : {}) };
}

/** 整框修改覆盖每个 run 的对应字段，保留加粗等其他作者样式。字符串继续继承节点样式。 */
export function patchWholeTextContent(content: SlidesEditableTextContent, patch: SlidesTextStylePatch): SlidesEditableTextContent {
  const style = authorTextStylePatch(patch);
  if (typeof content === 'string' || Object.keys(style).length === 0) return content;
  return content.map(run => ({ ...run, style: { ...run.style, ...style } }));
}

export function wholeTextStyle(content: SlidesEditableTextContent, base: SlidesTextStyleBase): SlidesTextSelectionStyle {
  const runs = typeof content === 'string' ? [{ text: content }] : content;
  const sizes = new Set(runs.map(run => run.style?.fontSize ?? base.fontSizePt));
  const colors = new Set(runs.map(run => (run.style?.color ?? base.color).toUpperCase()));
  function flag(key: 'bold' | 'italic' | 'underline'): boolean | null {
    const values = new Set(runs.map(run => run.style?.[key] ?? base[key] ?? false));
    return values.size > 1 ? null : [...values][0] ?? false;
  }
  return { bold: flag('bold'), italic: flag('italic'), underline: flag('underline'), fontSizePt: sizes.size > 1 ? null : [...sizes][0] ?? base.fontSizePt,
    color: colors.size > 1 ? null : [...colors][0] ?? base.color.toUpperCase() };
}
