import type { FontMetadata, ScriptClass } from '../definitions/types.js';

const LATIN_UNICODE_RANGE_BITS = [0, 1] as const;
// bit 60 是 Private Use Area，不表达东亚字形覆盖；不能因为字体带私用字形就进入 CJK 候选池。
const EAST_ASIAN_UNICODE_RANGE_BITS = [28, 48, 49, 50, 51, 52, 54, 55, 56, 59, 61] as const;
const COMPLEX_SCRIPT_UNICODE_RANGE_BITS = [11, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25] as const;

export function hasScriptCoverage(font: FontMetadata, script: ScriptClass): boolean {
  return hasAnyUnicodeRangeBit(font.unicodeRanges, scriptCoverageBits(script));
}

/** macOS 点号 family 是系统内部 UI 实现，不应成为文稿替代字体。 */
export function isPublicFontFamily(family: string): boolean {
  const normalized = family.trim();
  return normalized.length > 0 && !normalized.startsWith('.');
}

export function scriptCoverageBits(script: ScriptClass): readonly number[] {
  if (script === 'eastAsian') {
    return EAST_ASIAN_UNICODE_RANGE_BITS;
  }
  if (script === 'complex') {
    return COMPLEX_SCRIPT_UNICODE_RANGE_BITS;
  }
  return LATIN_UNICODE_RANGE_BITS;
}

function hasAnyUnicodeRangeBit(ranges: readonly [number, number, number, number], bits: readonly number[]): boolean {
  return bits.some((bit) => hasUnicodeRangeBit(ranges, bit));
}

function hasUnicodeRangeBit(
  ranges: readonly [number, number, number, number],
  bit: number,
): boolean {
  if (!Number.isInteger(bit) || bit < 0 || bit > 127) return false;
  const rangeIndex = Math.floor(bit / 32);
  const bitOffset = bit % 32;
  const range = ranges[rangeIndex];
  return range != null && (range & (1 << bitOffset)) !== 0;
}
