import {
  createAspectRatioSlideRasterProfile,
  type SlideRasterRequest,
} from '@plugin/slides/shared/slideRasterization';
import type {
  RenderSlideSize,
  SlideRenderModel,
} from '../../../types/render';

export const SLIDES_THUMBNAIL_RASTER_PROFILE_ID = 'slides-thumbnail-v1';

export function createThumbnailRasterRequest(
  slide: SlideRenderModel,
  slideSize: RenderSlideSize,
  viewportWidthPx: number,
  pixelRatio: number,
): SlideRasterRequest {
  return {
    requestId: `thumbnail:${slide.slideId}`,
    slide,
    slideSize,
    profile: createAspectRatioSlideRasterProfile({
      id: SLIDES_THUMBNAIL_RASTER_PROFILE_ID,
      slideSize,
      viewportWidthPx,
      pixelRatio,
    }),
  };
}
