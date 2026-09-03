import { describe, expect, it } from 'vitest';
import type { FontMetadata } from '../../definitions/types.js';
import {
  collectRequiredGlyphCodePoints,
  compressGlyphCodePointRanges,
  hasRequiredGlyphCoverage,
} from '../glyphCoverage.js';

describe('font cmap glyph coverage', () => {
  it('压缩实际 cmap，并按正文 code point 判断覆盖', () => {
    const font = makeMeta(compressGlyphCodePointRanges([
      0x0041,
      0x0042,
      0x3001,
      0x4E2D,
      0x4E2E,
    ]));

    expect(font.glyphCodePointRanges).toEqual([
      [0x0041, 0x0042],
      [0x3001, 0x3001],
      [0x4E2D, 0x4E2E],
    ]);
    expect(hasRequiredGlyphCoverage(font, [0x0041, 0x3001, 0x4E2D])).toBe(true);
    expect(hasRequiredGlyphCoverage(font, [0x0041, 0xFF0C])).toBe(false);
  });

  it('只收集需要独立字形的 code point，跳过换行与 shaping 控制符', () => {
    expect(collectRequiredGlyphCodePoints('A中，\n\u200D\uFE0F')).toEqual([
      0x0041,
      0x4E2D,
      0xFF0C,
    ]);
  });
});

function makeMeta(
  glyphCodePointRanges: FontMetadata['glyphCodePointRanges'],
): FontMetadata {
  return {
    family: 'Fixture Sans',
    subfamily: 'Regular',
    postscriptName: 'FixtureSans-Regular',
    filePath: '/fonts/fixture.ttf',
    faceIndex: 0,
    panose: [2, 11, 5, 3, 2, 2, 4, 2, 2, 4],
    unicodeRanges: [1, 0, 0, 0],
    glyphCodePointRanges,
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
