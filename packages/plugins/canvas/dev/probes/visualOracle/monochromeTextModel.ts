import { VISUAL_TEXT_LIMITS, type VisualColor, type VisualTextLayout } from './definitions';

type Grapheme = VisualTextLayout['graphemes'][number];
const potentialColorSequence = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u200d\u20e3\ufe0e\ufe0f\u{E0020}-\u{E007F}]/u;

/** 资格只覆盖本固定system-ui普通文字。整簇排除emoji/旗帜/ZWJ/VS/keycap，不按单码点猜。 */
export function qualifiesMonochromeModel(grapheme: Grapheme): boolean {
  return /\S/u.test(grapheme.text) && !potentialColorSequence.test(grapheme.text)
    && grapheme.style.fontFamily === 'system-ui' && grapheme.style.fontAvailable
    && grapheme.style.visibility === 'visible' && grapheme.style.transform === 'none';
}

/** LCD的reference允许各通道覆盖率不同；透明raster必须仍在同一前景→背景的灰阶alpha线段。 */
export function matchesMonochromePaint(reference: Uint8Array, actual: Uint8Array, offset: number, foreground: VisualColor, background: VisualColor): boolean {
  if (reference[offset + 3] !== 255 || actual[offset + 3] !== 255) return false;
  const vector = foreground.map((value, channel) => value - background[channel]);
  const denominator = vector.reduce((sum, value) => sum + value * value, 0);
  if (!denominator) return false;
  const alpha = Math.max(0, Math.min(1, vector.reduce((sum, value, channel) => sum + (actual[offset + channel] - background[channel]) * value, 0) / denominator));
  return vector.every((value, channel) => reference[offset + channel] >= Math.min(foreground[channel], background[channel]) - VISUAL_TEXT_LIMITS.solidColorDelta
    && reference[offset + channel] <= Math.max(foreground[channel], background[channel]) + VISUAL_TEXT_LIMITS.solidColorDelta
    && Math.abs(actual[offset + channel] - background[channel] - alpha * value) <= VISUAL_TEXT_LIMITS.solidColorDelta);
}
