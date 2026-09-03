import type PptxGenJS from 'pptxgenjs';
import type {
  Box,
  SvgGraphicElementSpec,
} from '@plugin/slides/shared';
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

  const props: PptxGenJS.ImageProps = {
    x: position.x,
    y: position.y,
    w: position.w,
    h: position.h,
    objectName: placement.objectName,
    data: `data:image/svg+xml;base64,${Buffer.from(asset.canonicalSvg, 'utf8').toString('base64')}`,
  };
  if (element.fit === 'contain') {
    props.sizing = { type: 'contain', w: position.w, h: position.h };
  }
  if (element.altText) props.altText = element.altText;
  if (element.opacity != null) {
    props.transparency = Math.round((1 - element.opacity) * 100);
  }
  if (element.rotate != null) props.rotate = element.rotate;
  return props;
}
