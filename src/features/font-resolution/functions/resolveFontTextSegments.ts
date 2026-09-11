/// <reference lib="es2022.intl" />
import type { FontRequest, ResolvedFont } from '../definitions/types.js';
import { classifyDominantScript } from './scriptClassifier.js';
import { collectRequiredGlyphCodePoints } from './glyphCoverage.js';

/** 按完整 grapheme 回退，避免拆开组合音标、变体选择符和 emoji 序列。 */
export function resolveFontTextSegments(
  text: string,
  request: Omit<FontRequest, 'script' | 'requiredCodePoints'>,
  resolve: (request: FontRequest) => ResolvedFont,
): Array<{ text: string; font: ResolvedFont }> {
  const segments: Array<{ text: string; font: ResolvedFont }> = [];
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const font = resolve({
      ...request,
      script: classifyDominantScript(segment),
      requiredCodePoints: collectRequiredGlyphCodePoints(segment),
    });
    const previous = segments[segments.length - 1];
    if (previous && sameFace(previous.font, font)) previous.text += segment;
    else segments.push({ text: segment, font });
  }
  // 空段落仍需要字号和字体行框；不凭空插入可见字符。
  return segments.length > 0 ? segments : [{ text, font: resolve({ ...request, script: 'latin', requiredCodePoints: [] }) }];
}

function sameFace(left: ResolvedFont, right: ResolvedFont): boolean {
  return left.resolvedFamily === right.resolvedFamily
    && left.resolution === right.resolution
    && left.request.script === right.request.script
    && left.resolved?.filePath === right.resolved?.filePath
    && left.resolved?.faceIndex === right.resolved?.faceIndex;
}
