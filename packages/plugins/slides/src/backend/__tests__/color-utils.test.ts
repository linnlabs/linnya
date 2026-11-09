/**
 * colorUtils 单元测试
 */
import { describe, expect, it } from 'vitest';import { circularStdDeviationDeg, colorDistance, isNeutralColor, parseHex, relativeLuminance, toOklch, wcagContrastRatio } from '../engine/quality/colorUtils.js';

describe('parseHex', () => {
  it('parses 6-digit hex with #', () => {
    expect(parseHex('#1A2B3C')).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c });
  });

  it('parses 6-digit hex without #', () => {
    expect(parseHex('1a2b3c')).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c });
  });

  it('parses 3-digit shorthand', () => {
    expect(parseHex('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it('parses 8-digit RGBA, dropping alpha', () => {
    expect(parseHex('#11223344')).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
  });

  it('is case-insensitive and whitespace tolerant', () => {
    expect(parseHex('  #FfAaCc  ')).toEqual({ r: 0xff, g: 0xaa, b: 0xcc });
  });

  it('returns null for invalid input', () => {
    expect(parseHex('')).toBeNull();
    expect(parseHex('#XYZ')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex(undefined)).toBeNull();
    expect(parseHex(null)).toBeNull();
    expect(parseHex(123 as unknown as string)).toBeNull();
  });
});

const neutral = (hex: string) => isNeutralColor(toOklch(parseHex(hex)!));

describe('isNeutralColor', () => {
  it('灰、带色调的灰和墨色都算中性', () => {
    for (const hex of ['#808080', '#7C8C84', '#6B7080', '#241A1D', '#20251C']) expect(neutral(hex), hex).toBe(true);
  });

  it('白和染纸淡色算中性', () => {
    for (const hex of ['#FFFFFF', '#F5F0E6', '#EFE4E6', '#F0F5FC']) expect(neutral(hex), hex).toBe(true);
  });

  it('看得出色相的颜色不算中性，包括暗色和浅色', () => {
    for (const hex of ['#1F6FC1', '#7A5A2E', '#1B2A44', '#F4C9A0', '#6E725C']) expect(neutral(hex), hex).toBe(false);
  });
});

describe('colorDistance', () => {
  it('同色为 0，米色与纯白约 0.08，黑白约 1', () => {
    const white = parseHex('#FFFFFF')!;
    expect(colorDistance(white, white)).toBe(0);
    expect(colorDistance(white, parseHex('#EDE5D3')!)).toBeCloseTo(0.081, 2);
    expect(colorDistance(white, parseHex('#000000')!)).toBeCloseTo(1, 2);
  });
});

describe('relativeLuminance + wcagContrastRatio', () => {
  it('white luminance ≈ 1', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 4);
  });

  it('black luminance = 0', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
  });

  it('black-on-white contrast = 21', () => {
    const ratio = wcagContrastRatio(
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
    );
    expect(ratio).toBeCloseTo(21, 1);
  });

  it('white-on-white contrast = 1', () => {
    const ratio = wcagContrastRatio(
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 255, b: 255 },
    );
    expect(ratio).toBe(1);
  });

  it('mid-gray text on white falls below 3:1 (AA large)', () => {
    /* #999999 on white ≈ 2.85 */
    const ratio = wcagContrastRatio(
      { r: 0x99, g: 0x99, b: 0x99 },
      { r: 255, g: 255, b: 255 },
    );
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(3);
  });
});

describe('circularStdDeviationDeg', () => {
  it('returns 0 for empty / single hue', () => {
    expect(circularStdDeviationDeg([])).toBe(0);
    expect(circularStdDeviationDeg([42])).toBe(0);
  });

  it('returns 0 for identical hues', () => {
    expect(circularStdDeviationDeg([100, 100, 100, 100])).toBeCloseTo(0, 5);
  });

  it('small (~10°) for tightly clustered hues', () => {
    const stddev = circularStdDeviationDeg([200, 205, 210, 195]);
    expect(stddev).toBeLessThan(15);
  });

  it('large (>30°) for hues spread over wide arc', () => {
    const stddev = circularStdDeviationDeg([0, 60, 120, 180, 240, 300]);
    expect(stddev).toBeGreaterThan(30);
  });

  it('handles wrap-around (350° and 10° are close)', () => {
    /* Without circular handling these would look "average 180°" → huge stddev.
       Circular logic should yield near 0. */
    const stddev = circularStdDeviationDeg([350, 355, 0, 5, 10]);
    expect(stddev).toBeLessThan(15);
  });
});
