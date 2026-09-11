import type { SvgGraphicRenderNode } from '../../../types/render';
import type { LoadedRenderImage } from '../../renderImageResources';
import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../shared/constants';
import { resolveImageFitGeometry } from '@plugin/slides/shared/render-geometry';

export function svgGraphicDataUri(node: SvgGraphicRenderNode): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(node.canonicalSvg)}`;
}

export function buildSvgGraphicGroupConfig(node: SvgGraphicRenderNode) {
  return {
    x: node.box.x * INCHES_TO_PX,
    y: node.box.y * INCHES_TO_PX,
    rotation: node.rotation ?? 0,
    opacity: node.opacity ?? 1,
    visible: node.visible !== false,
  };
}

export function buildSvgGraphicImageConfig(
  node: SvgGraphicRenderNode,
  resource: LoadedRenderImage,
) {
  return {
    ...resolveSvgGraphicFitConfig(node),
    image: resource.image,
  };
}

export function resolveSvgGraphicFitConfig(node: SvgGraphicRenderNode) {
  const boxWidth = node.box.w * INCHES_TO_PX;
  const boxHeight = node.box.h * INCHES_TO_PX;
  const destination = resolveImageFitGeometry({
    naturalWidth: node.viewBox.width,
    naturalHeight: node.viewBox.height,
    boxWidth,
    boxHeight,
    fitMode: node.fit,
  }).destination;
  return {
    x: destination.x * boxWidth,
    y: destination.y * boxHeight,
    width: destination.width * boxWidth,
    height: destination.height * boxHeight,
  };
}

export function buildSvgGraphicPlaceholderConfig(node: SvgGraphicRenderNode) {
  return {
    x: 0,
    y: 0,
    width: node.box.w * INCHES_TO_PX,
    height: node.box.h * INCHES_TO_PX,
    fill: SLIDES_RENDER_COLORS.imagePlaceholderFill,
    stroke: SLIDES_RENDER_COLORS.imagePlaceholderStroke,
    strokeWidth: 1,
  };
}
