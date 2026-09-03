import { describe, expect, it } from 'vitest';
import {
  createAspectRatioSlideRasterProfile,
  isSlideRasterPixelSizeWithinBudget,
  isSlideRasterSquareEnvelopeWithinBudget,
  resolveSlideRasterPixelSize,
} from './slideRasterProfile';

describe('slide raster profile', () => {
  it('uses one aspect-ratio rounding rule for viewport and physical pixels', () => {
    const profile = createAspectRatioSlideRasterProfile({
      id: 'thumbnail-v1',
      slideSize: { width: 10, height: 5.625, unit: 'in' },
      viewportWidthPx: 158,
      pixelRatio: 2,
    });

    expect(profile.viewportHeightPx).toBe(89);
    expect(resolveSlideRasterPixelSize(profile)).toEqual({
      widthPx: 316,
      heightPx: 178,
    });
  });

  it('参数包络与真实宽高共用同一输出像素预算', () => {
    expect(isSlideRasterSquareEnvelopeWithinBudget({
      viewportWidthPx: 4_096,
      pixelRatio: 4,
    })).toBe(false);
    expect(isSlideRasterPixelSizeWithinBudget({
      widthPx: 6_000,
      heightPx: 6_000,
    })).toBe(true);
    expect(isSlideRasterPixelSizeWithinBudget({
      widthPx: 8_000,
      heightPx: 6_000,
    })).toBe(false);
  });
});
