import type { SvgGraphicViewBox } from '@plugin/slides/shared';

/** fallback 最长边固定 1920px；保持 viewBox 比例，不依赖页面摆放尺寸。 */
export const SVG_GRAPHIC_FALLBACK_MAX_EDGE_PX = 1920;

export function resolveSvgGraphicFallbackPixelSize(
  viewBox: SvgGraphicViewBox,
): { readonly widthPx: number; readonly heightPx: number } {
  if (viewBox.width >= viewBox.height) {
    return {
      widthPx: SVG_GRAPHIC_FALLBACK_MAX_EDGE_PX,
      heightPx: Math.max(
        1,
        Math.round(SVG_GRAPHIC_FALLBACK_MAX_EDGE_PX * viewBox.height / viewBox.width),
      ),
    };
  }
  return {
    widthPx: Math.max(
      1,
      Math.round(SVG_GRAPHIC_FALLBACK_MAX_EDGE_PX * viewBox.width / viewBox.height),
    ),
    heightPx: SVG_GRAPHIC_FALLBACK_MAX_EDGE_PX,
  };
}
