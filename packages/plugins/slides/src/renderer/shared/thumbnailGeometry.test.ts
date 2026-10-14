import { describe, expect, it } from 'vitest';

import {
  FILMSTRIP_ITEM_GAP_PX,
  resolveFilmstripItemWidthPx,
  resolveFilmstripThumbnailSize,
  resolveThumbnailHeightForWidth,
} from './thumbnailGeometry';

describe('thumbnail geometry', () => {
  it('keeps a fixed filmstrip height for the default 16x9 deck', () => {
    expect(resolveFilmstripThumbnailSize(undefined)).toEqual({ width: 128, height: 72 });
    expect(resolveFilmstripItemWidthPx(undefined)).toBe(128 + FILMSTRIP_ITEM_GAP_PX);
  });

  it.each([
    [{ width: 5.625, height: 10 }, { width: 41, height: 72 }],
    [{ width: 10, height: 10 }, { width: 72, height: 72 }],
    [{ width: 10, height: 7.5 }, { width: 96, height: 72 }],
    [{ width: 56, height: 2 }, { width: 240, height: 9 }],
  ] as const)('derives filmstrip width from the document slide size', (size, expected) => {
    expect(resolveFilmstripThumbnailSize(size)).toEqual(expected);
    expect(resolveFilmstripItemWidthPx(size)).toBe(expected.width + FILMSTRIP_ITEM_GAP_PX);
  });

  it('derives grid thumbnail height from the shared aspect ratio', () => {
    expect(resolveThumbnailHeightForWidth(undefined, 256)).toBe(144);
    expect(resolveThumbnailHeightForWidth({ width: 10, height: 7.5 }, 240)).toBe(180);
  });
});
