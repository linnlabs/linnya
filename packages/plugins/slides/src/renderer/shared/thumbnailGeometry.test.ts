import { describe, expect, it } from 'vitest';

import {
  resolveThumbnailHeightPx,
  resolveThumbnailItemHeightPx,
} from './thumbnailGeometry';

describe('thumbnail geometry', () => {
  it('keeps the current 16x9 geometry as the default', () => {
    expect(resolveThumbnailHeightPx(undefined)).toBe(89);
    expect(resolveThumbnailItemHeightPx(undefined)).toBe(105);
  });

  it.each([
    [{ width: 5.625, height: 10 }, 281],
    [{ width: 10, height: 10 }, 158],
    [{ width: 20, height: 10 }, 79],
  ] as const)('derives height from the document slide size', (size, height) => {
    expect(resolveThumbnailHeightPx(size)).toBe(height);
    expect(resolveThumbnailItemHeightPx(size)).toBe(height + 16);
  });
});
