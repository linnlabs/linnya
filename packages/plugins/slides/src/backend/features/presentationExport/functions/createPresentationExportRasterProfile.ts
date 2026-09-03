import type { RenderSlideSize } from '@plugin/slides/shared';
import {
  createAspectRatioSlideRasterProfile,
  SLIDES_RASTER_LOGICAL_DPI,
  type SlideRasterProfile,
} from '@plugin/slides/shared/slideRasterization';

/**
 * 导出宽度是最终物理像素；viewport 保持与预览一致的 96 DPI 逻辑尺寸，
 * 再用 pixelRatio 提升页面和 ECharts 的清晰度。
 */
export function createPresentationExportRasterProfile(input: {
  readonly id: string;
  readonly slideSize: RenderSlideSize;
  readonly outputWidthPx: number;
  readonly transparentBackground?: boolean;
}): SlideRasterProfile {
  const logicalWidth = input.slideSize.width * SLIDES_RASTER_LOGICAL_DPI;
  const profile = createAspectRatioSlideRasterProfile({
    id: input.id,
    slideSize: input.slideSize,
    viewportWidthPx: logicalWidth,
    pixelRatio: input.outputWidthPx / logicalWidth,
  });
  return input.transparentBackground
    ? { ...profile, transparentBackground: true }
    : profile;
}
