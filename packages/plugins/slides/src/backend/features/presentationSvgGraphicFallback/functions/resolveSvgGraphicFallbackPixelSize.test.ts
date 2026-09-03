import { describe, expect, it } from 'vitest';
import { resolveSvgGraphicFallbackPixelSize } from './resolveSvgGraphicFallbackPixelSize';

describe('resolveSvgGraphicFallbackPixelSize', () => {
  it('keeps landscape and portrait viewBox ratios within one deterministic edge budget', () => {
    expect(resolveSvgGraphicFallbackPixelSize({ width: 640, height: 360 })).toEqual({
      widthPx: 1920,
      heightPx: 1080,
    });
    expect(resolveSvgGraphicFallbackPixelSize({ width: 100, height: 200 })).toEqual({
      widthPx: 960,
      heightPx: 1920,
    });
  });
});
