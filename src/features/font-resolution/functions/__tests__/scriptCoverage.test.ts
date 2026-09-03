import { describe, expect, it } from 'vitest';
import type { FontMetadata } from '../../definitions/types.js';
import {
  hasScriptCoverage,
  isPublicFontFamily,
} from '../scriptCoverage.js';

describe('font script coverage', () => {
  it('Private Use Area bit 60 不构成 eastAsian 字体覆盖', () => {
    expect(hasScriptCoverage(makeMeta([60]), 'eastAsian')).toBe(false);
    expect(hasScriptCoverage(makeMeta([59]), 'eastAsian')).toBe(true);
  });

  it('点号前缀的 macOS 内部 family 不属于公开替代候选', () => {
    expect(isPublicFontFamily('.New York')).toBe(false);
    expect(isPublicFontFamily(' New York ')).toBe(true);
  });
});

function makeMeta(bits: readonly number[]): FontMetadata {
  return {
    family: 'Coverage Sans',
    subfamily: 'Regular',
    postscriptName: 'CoverageSans-Regular',
    filePath: '/fonts/coverage-sans.ttf',
    faceIndex: 0,
    panose: [2, 11, 5, 3, 2, 2, 4, 2, 2, 4],
    unicodeRanges: rangesWithBits(bits),
    glyphCodePointRanges: [[0, 0x10FFFF]],
    isFixedPitch: false,
    avgCharWidth: 0.5,
    winAscent: 0.9,
    winDescent: 0.2,
    typoAscent: 0.75,
    typoDescent: -0.25,
    typoLineGap: 0.2,
    useTypoMetrics: false,
    bold: false,
    italic: false,
  };
}

function rangesWithBits(bits: readonly number[]): readonly [number, number, number, number] {
  const ranges = [0, 0, 0, 0];
  for (const bit of bits) {
    const rangeIndex = Math.floor(bit / 32);
    const bitOffset = bit % 32;
    ranges[rangeIndex] = (ranges[rangeIndex] ?? 0) | (1 << bitOffset);
  }
  return [ranges[0] ?? 0, ranges[1] ?? 0, ranges[2] ?? 0, ranges[3] ?? 0];
}
