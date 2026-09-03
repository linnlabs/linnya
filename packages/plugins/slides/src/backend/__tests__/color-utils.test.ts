/**
 * colorUtils 单元测试
 */
import { describe, expect, it } from 'vitest';import { circularStdDeviationDeg, isNeutralColor, parseHex, relativeLuminance, rgbToHsl, wcagContrastRatio } from '../engine/quality/colorUtils.js';

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

describe('rgbToHsl', () => {
  it('converts pure red to hue=0, s=1, l=0.5', () => {
    const { h, s, l } = rgbToHsl({ r: 255, g: 0, b: 0 });
    expect(h).toBeCloseTo(0, 5);
    expect(s).toBeCloseTo(1, 5);
    expect(l).toBeCloseTo(0.5, 5);
  });

  it('converts pure green to hue=120', () => {
    expect(rgbToHsl({ r: 0, g: 255, b: 0 }).h).toBeCloseTo(120, 5);
  });

  it('converts pure blue to hue=240', () => {
    expect(rgbToHsl({ r: 0, g: 0, b: 255 }).h).toBeCloseTo(240, 5);
  });

  it('returns h=0, s=0 for grayscale', () => {
    const gray = rgbToHsl({ r: 128, g: 128, b: 128 });
    expect(gray.h).toBe(0);
    expect(gray.s).toBe(0);
    expect(gray.l).toBeCloseTo(0.502, 2);
  });

  it('returns h=0, s=0 for white and black', () => {
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 1 });
    expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 });
  });
});

describe('isNeutralColor', () => {
  it('flags low-saturation grays', () => {
    expect(isNeutralColor({ h: 200, s: 0.05, l: 0.5 })).toBe(true);
  });

  it('flags near-black', () => {
    expect(isNeutralColor({ h: 30, s: 0.5, l: 0.05 })).toBe(true);
  });

  it('flags near-white', () => {
    expect(isNeutralColor({ h: 30, s: 0.5, l: 0.95 })).toBe(true);
  });

  it('keeps saturated mid-tone colors', () => {
    expect(isNeutralColor({ h: 210, s: 0.6, l: 0.5 })).toBe(false);
  });

  it('keeps low-saturation but distinctly tinted color (s = 0.15)', () => {
    expect(isNeutralColor({ h: 30, s: 0.15, l: 0.5 })).toBe(false);
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
