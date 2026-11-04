import { VISUAL_TEXT_LIMITS, type VisualColor, type VisualTextLayout } from './definitions';
import { meanChannelAlpha } from './visualInkCoverage';

type Grapheme = VisualTextLayout['graphemes'][number];
const potentialColorSequence = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u200d\u20e3\ufe0e\ufe0f\u{E0020}-\u{E007F}]/u;
// 只收本正式fixture的精确CSS family；来源分别为请求system-ui、core pre/code、KaTeX0.18.10。
const fixtureFamilies = new Set(['system-ui', 'monospace', 'KaTeX_Math', 'KaTeX_Main, math, "Times New Roman", serif']);

/** 资格只覆盖固定fixture的已知family普通文字；未知/潜彩字簇仍禁止，不按单码点猜。 */
export function qualifiesMonochromeModel(grapheme: Grapheme): boolean {
  return /\S/u.test(grapheme.text) && !potentialColorSequence.test(grapheme.text)
    && fixtureFamilies.has(grapheme.style.fontFamily) && grapheme.style.fontAvailable
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

/** RGB平均alpha转回原对比单位；不能直接乘255把低对比文字的24门槛偷偷改掉。 */
export function monochromeStructureContrast(reference: Uint8Array, actual: Uint8Array, offset: number, foreground: VisualColor, background: VisualColor) {
  if (!matchesMonochromePaint(reference, actual, offset, foreground, background)) return null;
  const contrast = Math.max(...foreground.map((value, channel) => Math.abs(value - background[channel])));
  return { reference: meanChannelAlpha(reference, offset, foreground, background) * contrast,
    actual: meanChannelAlpha(actual, offset, foreground, background) * contrast };
}
