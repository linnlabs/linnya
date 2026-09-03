import type { SceneContext } from 'konva/lib/Context';
import type { ImageRenderNode } from '../../../../types/render';
import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../../shared/constants';
import type { LoadedRenderImage } from '../../../renderImageResources';
import { resolveKonvaImageFitConfig } from '../konvaVisualMapping';

const POINTS_TO_PX = INCHES_TO_PX / 72;

export function buildImageGroupConfig(node: ImageRenderNode) {
  const width = node.box.w * INCHES_TO_PX;
  const height = node.box.h * INCHES_TO_PX;
  return {
    x: node.box.x * INCHES_TO_PX,
    y: node.box.y * INCHES_TO_PX,
    rotation: node.rotation ?? 0,
    opacity: node.opacity ?? 1,
    visible: node.visible !== false,
    clipFunc: (context: SceneContext) => {
      if (node.maskShape === 'circle') {
        context.beginPath();
        context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        context.closePath();
        return;
      }
      const radius = Math.max(0, node.borderRadius ?? 0);
      if (radius <= 0) {
        context.beginPath();
        context.rect(0, 0, width, height);
        context.closePath();
        return;
      }
      const boundedRadius = Math.min(radius, width / 2, height / 2);
      context.beginPath();
      context.moveTo(boundedRadius, 0);
      context.lineTo(width - boundedRadius, 0);
      context.quadraticCurveTo(width, 0, width, boundedRadius);
      context.lineTo(width, height - boundedRadius);
      context.quadraticCurveTo(width, height, width - boundedRadius, height);
      context.lineTo(boundedRadius, height);
      context.quadraticCurveTo(0, height, 0, height - boundedRadius);
      context.lineTo(0, boundedRadius);
      context.quadraticCurveTo(0, 0, boundedRadius, 0);
      context.closePath();
    },
  };
}

export function buildImageNodeConfig(
  node: ImageRenderNode,
  loadedImage: LoadedRenderImage,
) {
  const width = node.box.w * INCHES_TO_PX;
  const height = node.box.h * INCHES_TO_PX;
  const fit = resolveKonvaImageFitConfig({
    naturalWidth: loadedImage.naturalWidth,
    naturalHeight: loadedImage.naturalHeight,
    boxWidth: width,
    boxHeight: height,
    fitMode: node.fitMode,
  });

  return {
    ...fit,
    x: node.flipH ? fit.x + fit.width : fit.x,
    y: node.flipV ? fit.y + fit.height : fit.y,
    image: loadedImage.image,
    scaleX: node.flipH ? -1 : 1,
    scaleY: node.flipV ? -1 : 1,
    shadowColor: node.shadow?.color,
    shadowBlur: node.shadow ? node.shadow.blur * POINTS_TO_PX : undefined,
    shadowOffsetX: node.shadow ? node.shadow.offsetX * POINTS_TO_PX : undefined,
    shadowOffsetY: node.shadow ? node.shadow.offsetY * POINTS_TO_PX : undefined,
    shadowOpacity: node.shadow?.opacity ?? undefined,
    shadowEnabled: node.shadow != null,
  };
}

export function buildImagePlaceholderConfig(node: ImageRenderNode) {
  const width = node.box.w * INCHES_TO_PX;
  const height = node.box.h * INCHES_TO_PX;
  return {
    x: 0,
    y: 0,
    width,
    height,
    fill: SLIDES_RENDER_COLORS.imagePlaceholderFill,
    stroke: SLIDES_RENDER_COLORS.imagePlaceholderStroke,
    strokeWidth: 1,
    cornerRadius: node.maskShape === 'circle'
      ? Math.min(width, height) / 2
      : (node.borderRadius ?? 0),
  };
}
