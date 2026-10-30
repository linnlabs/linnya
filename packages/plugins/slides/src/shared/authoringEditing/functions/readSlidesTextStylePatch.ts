import type { SlidesTextStylePatch } from '../definitions/editableText';
import { SLIDES_MANUAL_FONT_SIZE_PT } from '../definitions/textStyleLimits';

/** 只校验文本样式字段；外层命令/源码 codec 分别拥有可接受的完整字段集合。 */
export function readSlidesTextStylePatch(value: { readonly fontSizePt?: unknown; readonly color?: unknown; readonly bold?: unknown; readonly italic?: unknown; readonly underline?: unknown; readonly align?: unknown }): { value: SlidesTextStylePatch } | { error: string } {
  const { fontSizePt, color, bold, italic, underline, align } = value;
  if (fontSizePt !== undefined && (typeof fontSizePt !== 'number' || !Number.isFinite(fontSizePt)
    || fontSizePt < SLIDES_MANUAL_FONT_SIZE_PT.min || fontSizePt > SLIDES_MANUAL_FONT_SIZE_PT.max)) return { error: '文本字号必须是 1–400 pt 内的有限数字。' };
  if (color !== undefined && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/iu.test(color))) return { error: '文本颜色必须是 #RRGGBB。' };
  if (bold !== undefined && typeof bold !== 'boolean') return { error: 'bold 必须是 boolean。' };
  if (italic !== undefined && typeof italic !== 'boolean') return { error: 'italic 必须是 boolean。' };
  if (underline !== undefined && typeof underline !== 'boolean') return { error: 'underline 必须是 boolean。' };
  if (align !== undefined && align !== 'left' && align !== 'center' && align !== 'right') return { error: 'align 必须是 left / center / right。' };
  return { value: { ...(fontSizePt !== undefined ? { fontSizePt } : {}), ...(color !== undefined ? { color } : {}),
    ...(bold !== undefined ? { bold } : {}), ...(italic !== undefined ? { italic } : {}),
    ...(underline !== undefined ? { underline } : {}), ...(align !== undefined ? { align } : {}) } };
}
