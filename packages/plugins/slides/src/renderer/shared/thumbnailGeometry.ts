import type { SlideSizeInches } from '@plugin/slides/shared/deckSpec';
import { DEFAULT_SLIDE_SIZE, THUMBNAIL_WIDTH } from './constants';

/** 缩略图条目的上下留白与列表间距总和。 */
export const THUMBNAIL_ITEM_CHROME_PX = 16;

export function resolveThumbnailHeightPx(
  slideSize: SlideSizeInches | undefined,
): number {
  const size = slideSize ?? DEFAULT_SLIDE_SIZE;
  return Math.round(THUMBNAIL_WIDTH * (size.height / size.width));
}

export function resolveThumbnailItemHeightPx(
  slideSize: SlideSizeInches | undefined,
): number {
  return resolveThumbnailHeightPx(slideSize) + THUMBNAIL_ITEM_CHROME_PX;
}
