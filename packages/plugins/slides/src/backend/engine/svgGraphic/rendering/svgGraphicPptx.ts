import type PptxGenJS from 'pptxgenjs';
import type {
  Box,
  SvgGraphicElementSpec,
} from '@plugin/slides/shared';
import { resolveImageFitGeometry } from '@plugin/slides/shared/render-geometry';
import type { SvgGraphicCompileContext } from '../../types';

export function buildSvgGraphicImageProps(
  element: SvgGraphicElementSpec,
  position: Box,
  context: SvgGraphicCompileContext,
): PptxGenJS.ImageProps {
  const asset = context.assets.get(element.asset.assetId);
  if (!asset) {
    throw new Error('PPTX compilation requires resolved SVG Graphic content.');
  }
  const placement = context.nextPlacement(element.asset.assetId);
  const geometry = resolveImageFitGeometry({
    naturalWidth: asset.viewBox.width,
    naturalHeight: asset.viewBox.height,
    boxWidth: position.w,
    boxHeight: position.h,
    fitMode: element.fit,
  });
  const destination = geometry.destination;

  const props: PptxGenJS.ImageProps = {
    x: position.x + destination.x * position.w,
    y: position.y + destination.y * position.h,
    w: destination.width * position.w,
    h: destination.height * position.h,
    objectName: placement.objectName,
    data: `data:image/svg+xml;base64,${Buffer.from(asset.canonicalSvg, 'utf8').toString('base64')}`,
  };
  if (element.altText) props.altText = element.altText;
  if (element.opacity != null) {
    props.transparency = Math.round((1 - element.opacity) * 100);
  }
  if (element.rotate != null) props.rotate = element.rotate;
  return props;
}
