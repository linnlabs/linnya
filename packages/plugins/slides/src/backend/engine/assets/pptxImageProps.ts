import type PptxGenJS from 'pptxgenjs';
import type { Box, FreeformImageElement, ImageSourceInput } from '@plugin/slides/shared';
import { clamp } from '@linnya/foundation';
import { mapImageShadowToProps } from '../visual/presentationVisualDefaults';
import { resolveImageAsset, toPptxImageSource } from './imageAssetResolver';
import { resolvePptxImageFitOptions } from './imageSizing';

/** 图片样式投影只有一份；两种编译器各自负责确定最终位置和来源是否存在。 */
export function buildPptxImageProps(
  image: Omit<FreeformImageElement, 'src'> & { src: ImageSourceInput },
  position: Box,
): PptxGenJS.ImageProps {
  const asset = resolveImageAsset(image.src);
  const fitOptions = resolvePptxImageFitOptions(position, asset, image.fitMode, { crop: image.crop, focus: image.focus });
  const props: PptxGenJS.ImageProps = { ...fitOptions, ...toPptxImageSource(asset) };
  if (image.alt) props.altText = image.alt;
  if (fitOptions.sizing) props.sizing = fitOptions.sizing;
  if (image.rounding != null || image.maskShape === 'circle') props.rounding = image.maskShape === 'circle' ? true : image.rounding;
  if (image.transparency != null) props.transparency = clamp(Math.round(image.transparency * 100), 0, 100);
  if (image.shadow) props.shadow = mapImageShadowToProps(image.shadow);
  if (image.rotate != null) props.rotate = image.rotate;
  if (image.flipH != null) props.flipH = image.flipH;
  if (image.flipV != null) props.flipV = image.flipV;
  return props;
}
