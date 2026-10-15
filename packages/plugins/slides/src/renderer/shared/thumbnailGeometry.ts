import type { SlideSizeInches } from '@plugin/slides/shared/deckSpec';
import { DEFAULT_SLIDE_SIZE } from './constants';

/**
 * 底部页面条的缩略图高度固定、宽度随文稿比例变化，使页面条不会因 preset 或自定义画布跳高。
 * 极宽画布受最大宽度约束并相应降低高度。
 */
export const FILMSTRIP_THUMBNAIL_HEIGHT_PX = 72;
export const FILMSTRIP_THUMBNAIL_MAX_WIDTH_PX = 240;

/** 相邻缩略图之间的水平间距；虚拟列表条目宽度同时包含它。 */
export const FILMSTRIP_ITEM_GAP_PX = 12;

export interface ThumbnailSizePx {
  readonly width: number;
  readonly height: number;
}

export function resolveFilmstripThumbnailSize(
  slideSize: SlideSizeInches | undefined,
): ThumbnailSizePx {
  const aspectRatio = resolveAspectRatio(slideSize);
  const width = FILMSTRIP_THUMBNAIL_HEIGHT_PX * aspectRatio;
  if (width <= FILMSTRIP_THUMBNAIL_MAX_WIDTH_PX) {
    return { width: Math.round(width), height: FILMSTRIP_THUMBNAIL_HEIGHT_PX };
  }
  return {
    width: FILMSTRIP_THUMBNAIL_MAX_WIDTH_PX,
    height: Math.round(FILMSTRIP_THUMBNAIL_MAX_WIDTH_PX / aspectRatio),
  };
}

export function resolveFilmstripItemWidthPx(slideSize: SlideSizeInches | undefined): number {
  return resolveFilmstripThumbnailSize(slideSize).width + FILMSTRIP_ITEM_GAP_PX;
}

/** 已知显示宽度时按文稿比例求高度；平铺视图与位图栅格共用此规则。 */
export function resolveThumbnailHeightForWidth(
  slideSize: SlideSizeInches | undefined,
  width: number,
): number {
  return Math.round(width / resolveAspectRatio(slideSize));
}

function resolveAspectRatio(slideSize: SlideSizeInches | undefined): number {
  const size = slideSize ?? DEFAULT_SLIDE_SIZE;
  return size.width / size.height;
}
