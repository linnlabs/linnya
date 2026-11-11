import { contrastRatio, mixColors, parseColor, toHex } from '@linnya/color-core';
import { TABLE_DEFAULT_BACKGROUND_FILL, type StructuredSlideSpec } from '@plugin/slides/shared';
import type { TableDefaultFills } from '../definitions/tableDefaultFills';

/** 表头底色里主题强调色的占比：浅到正文色在上面仍清楚，又看得出属于这套配色。 */
const HEADER_ACCENT_RATIO = 0.14;
/** 没有强调色时，表头只比底色略深（深底上略浅）一点；白底上等于原来的 #F2F2F2。 */
const HEADER_INK_RATIO = 0.05;
/** 与 Renderer 没写颜色时的文字色一致（renderer/shared/constants 的 textFallbackFill）。 */
const FALLBACK_TEXT = '#333333';
/** 单元格文字按正文字号算，取 WCAG AA 正文门槛。 */
const MIN_TEXT_CONTRAST = 4.5;
const DARK_TEXT = '#111111';
const LIGHT_TEXT = '#FFFFFF';

/**
 * 没写逐格 fill 时表格的底色。正文取表格所在页的底色（读不出纯色时取主题底色），放上去就像没有底；
 * 表头取主题强调色往正文底色里淡淡染一层。主题和页面都没写颜色时，等于原来的白底灰表头。
 */
export function resolveTableDefaultFills(
  colors: Readonly<Record<string, string>> | undefined,
  pageColor?: string,
): TableDefaultFills {
  const body = readHex(pageColor) ?? readHex(colors?.background) ?? TABLE_DEFAULT_BACKGROUND_FILL;
  const accent = readHex(colors?.accent1);
  const header = accent
    ? mixColors(body, accent, HEADER_ACCENT_RATIO)
    : mixColors(body, pickInk(body), HEADER_INK_RATIO);
  return { header: header.toUpperCase(), body };
}

/**
 * 没写文字颜色的单元格用什么字色：主题文字色、默认深灰里第一个在这格底色上够清楚的；
 * 都不够（深色底）就在近黑与白之间取对比更高的。
 */
export function resolveTableTextColor(
  fill: string,
  colors: Readonly<Record<string, string>> | undefined,
): string {
  const background = parseColor(fill);
  if (!background) return FALLBACK_TEXT;
  for (const candidate of [readHex(colors?.text), FALLBACK_TEXT]) {
    const text = candidate ? parseColor(candidate) : null;
    if (candidate && text && contrastRatio(text.channels, background.channels) >= MIN_TEXT_CONTRAST) return candidate;
  }
  return pickInk(fill) === '#FFFFFF' ? LIGHT_TEXT : DARK_TEXT;
}

/** 表格所在页的纯色底；背景是图片或渐变时读不出单一颜色，返回 undefined。没写背景的页是白底。 */
export function resolveTablePageColor(background: StructuredSlideSpec['background']): string | undefined {
  if (!background) return TABLE_DEFAULT_BACKGROUND_FILL;
  if (background.image) return undefined;
  const paint = background.paint ?? background.gradient;
  if (paint) return paint.type === 'solid' ? paint.color : undefined;
  return background.color ?? TABLE_DEFAULT_BACKGROUND_FILL;
}

/** 在这个底色上对比更高的是黑还是白。 */
function pickInk(color: string): '#000000' | '#FFFFFF' {
  const parsed = parseColor(color);
  if (!parsed) return '#000000';
  const black = contrastRatio([0, 0, 0], parsed.channels);
  const white = contrastRatio([255, 255, 255], parsed.channels);
  return white > black ? '#FFFFFF' : '#000000';
}

function readHex(value: string | undefined): string | undefined {
  const parsed = value ? parseColor(value) : null;
  return parsed ? toHex(parsed.channels).toUpperCase() : undefined;
}
