import type { RenderSlideSize } from '../../renderModel';
import {
  SLIDE_RASTER_FORMAT,
  type SlideRasterPixelSize,
  type SlideRasterProfile,
} from '../definitions/slideRasterization';

/** Slides 预览与离屏渲染共用的逻辑 DPI；物理清晰度由 pixelRatio 决定。 */
export const SLIDES_RASTER_LOGICAL_DPI = 96;

export interface CreateAspectRatioSlideRasterProfileInput {
  id: string;
  slideSize: RenderSlideSize;
  viewportWidthPx: number;
  pixelRatio: number;
}

/** 单页 raster 输出的统一像素预算，参数入口与截图运行时必须共用。 */
export const SLIDES_RASTER_MAX_OUTPUT_PIXELS = 40_000_000;

/**
 * 所有调用方都从 slideSize 推导高度，避免 thumbnail、worker 和 CLI
 * 对同一页使用不同的四舍五入规则。
 */
export function createAspectRatioSlideRasterProfile(
  input: CreateAspectRatioSlideRasterProfileInput,
): SlideRasterProfile {
  assertPositiveFinite(input.slideSize.width, 'slideSize.width');
  assertPositiveFinite(input.slideSize.height, 'slideSize.height');
  assertPositiveFinite(input.viewportWidthPx, 'viewportWidthPx');
  assertPositiveFinite(input.pixelRatio, 'pixelRatio');

  return {
    id: input.id,
    viewportWidthPx: input.viewportWidthPx,
    viewportHeightPx: Math.round(
      input.viewportWidthPx * (input.slideSize.height / input.slideSize.width),
    ),
    pixelRatio: input.pixelRatio,
    format: SLIDE_RASTER_FORMAT,
  };
}

export function resolveSlideRasterPixelSize(
  profile: SlideRasterProfile,
): SlideRasterPixelSize {
  assertPositiveFinite(profile.viewportWidthPx, 'profile.viewportWidthPx');
  assertPositiveFinite(profile.viewportHeightPx, 'profile.viewportHeightPx');
  assertPositiveFinite(profile.pixelRatio, 'profile.pixelRatio');

  return {
    widthPx: Math.round(profile.viewportWidthPx * profile.pixelRatio),
    heightPx: Math.round(profile.viewportHeightPx * profile.pixelRatio),
  };
}

export function isSlideRasterPixelSizeWithinBudget(
  pixelSize: SlideRasterPixelSize,
): boolean {
  return pixelSize.widthPx * pixelSize.heightPx <= SLIDES_RASTER_MAX_OUTPUT_PIXELS;
}

/**
 * 参数解析阶段尚未读取文稿比例，使用正方形包络约束物理输出宽度。
 * 真实页面加载后仍由 `isSlideRasterPixelSizeWithinBudget` 做精确复核。
 */
export function isSlideRasterSquareEnvelopeWithinBudget(input: {
  readonly viewportWidthPx: number;
  readonly pixelRatio: number;
}): boolean {
  const outputWidthPx = Math.round(input.viewportWidthPx * input.pixelRatio);
  return outputWidthPx * outputWidthPx <= SLIDES_RASTER_MAX_OUTPUT_PIXELS;
}

function assertPositiveFinite(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive finite number`);
  }
}
