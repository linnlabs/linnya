import { mixColors, parseColor, toHex } from '@linnya/color-core';
import { TABLE_DEFAULT_BACKGROUND_FILL } from '@plugin/slides/shared';
import type { TableDefaultFills } from '../definitions/tableDefaultFills';

/** 表头底色里主题强调色的占比：浅到正文色在上面仍清楚，又看得出属于这套配色。 */
const HEADER_ACCENT_RATIO = 0.14;
/** 没有强调色时，表头只比底色略深一点，白底上等于原来的 #F2F2F2。 */
const HEADER_INK_RATIO = 0.05;

/**
 * 没写逐格 fill 时表格的底色。正文取主题底色，放在同底色的页面上就像没有底；
 * 表头取主题强调色往底色里淡淡染一层。主题没声明颜色时，等于原来的白底灰表头。
 */
export function resolveTableDefaultFills(
  colors: Readonly<Record<string, string>> | undefined,
): TableDefaultFills {
  const body = readHex(colors?.background) ?? TABLE_DEFAULT_BACKGROUND_FILL;
  const accent = readHex(colors?.accent1);
  const header = accent
    ? mixColors(body, accent, HEADER_ACCENT_RATIO)
    : mixColors(body, readHex(colors?.text) ?? '#000000', HEADER_INK_RATIO);
  return { header: header.toUpperCase(), body };
}

function readHex(value: string | undefined): string | undefined {
  const parsed = value ? parseColor(value) : null;
  return parsed ? toHex(parsed.channels).toUpperCase() : undefined;
}
