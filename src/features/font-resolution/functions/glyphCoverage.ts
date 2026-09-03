import type { FontMetadata } from '../definitions/types.js';

/**
 * 收集当前 run 真正需要字体提供字形的 code point。
 * 换行、制表符、连接符和变体选择符参与文本结构或 shaping，但不要求独立 cmap 字形。
 */
export function collectRequiredGlyphCodePoints(text: string): readonly number[] {
  const codePoints = new Set<number>();
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint != null && requiresStandaloneGlyph(codePoint)) {
      codePoints.add(codePoint);
    }
  }
  return [...codePoints].sort((first, second) => first - second);
}

/** 把 fontkit characterSet 压缩为可持久化的闭区间，避免 CJK cmap 直接膨胀 catalog。 */
export function compressGlyphCodePointRanges(
  codePoints: readonly number[],
): readonly (readonly [number, number])[] {
  const normalized = [...new Set(codePoints)]
    .filter(isUnicodeCodePoint)
    .sort((first, second) => first - second);
  const first = normalized[0];
  if (first == null) return [];

  const ranges: Array<readonly [number, number]> = [];
  let start = first;
  let end = first;
  for (const codePoint of normalized.slice(1)) {
    if (codePoint === end + 1) {
      end = codePoint;
      continue;
    }
    ranges.push([start, end]);
    start = codePoint;
    end = codePoint;
  }
  ranges.push([start, end]);
  return ranges;
}

export function hasRequiredGlyphCoverage(
  font: FontMetadata,
  requiredCodePoints: readonly number[] | undefined,
): boolean {
  if (requiredCodePoints == null || requiredCodePoints.length === 0) return true;
  return requiredCodePoints.every((codePoint) => hasGlyphCodePoint(
    font.glyphCodePointRanges,
    codePoint,
  ));
}

function hasGlyphCodePoint(
  ranges: readonly (readonly [number, number])[],
  codePoint: number,
): boolean {
  let lower = 0;
  let upper = ranges.length - 1;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const range = ranges[middle];
    if (range == null) return false;
    const [start, end] = range;
    if (codePoint < start) {
      upper = middle - 1;
    } else if (codePoint > end) {
      lower = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

function requiresStandaloneGlyph(codePoint: number): boolean {
  return codePoint !== 0x0009
    && codePoint !== 0x000A
    && codePoint !== 0x000D
    && codePoint !== 0x200C
    && codePoint !== 0x200D
    && codePoint !== 0xFEFF
    && !(codePoint >= 0xFE00 && codePoint <= 0xFE0F)
    && !(codePoint >= 0xE0100 && codePoint <= 0xE01EF);
}

function isUnicodeCodePoint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x10FFFF;
}
