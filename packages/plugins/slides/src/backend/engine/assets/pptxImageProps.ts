import type PptxGenJS from 'pptxgenjs';
import {
  resolveImageMaskGeometry,
  resolveImageMaskShape,
  type Box,
  type FreeformImageElement,
  type ImageSourceInput,
} from '@plugin/slides/shared';
import { clamp } from '@linnya/foundation';
import { mapImageShadowToProps } from '../visual/presentationVisualDefaults';
import { registerPptxPicture, type PptxPaintCompileContext } from '../visual/pptxPaintPatchPlan';
import { resolveImageAsset, toPptxImageSource } from './imageAssetResolver';
import { resolvePptxImageFitOptions } from './imageSizing';

/**
 * 图片样式投影只有一份；两种编译器各自负责确定最终位置和来源是否存在。
 * 椭圆遮罩由 PptxGenJS 的 rounding 直接写出；其他形状与调色登记到导出后补丁，
 * 按标记换掉图片的 prstGeom、往 a:blip 里写调色。
 */
export function buildPptxImageProps(
  image: Omit<FreeformImageElement, 'src'> & { src: ImageSourceInput },
  position: Box,
  paintContext?: PptxPaintCompileContext,
): PptxGenJS.ImageProps {
  const asset = resolveImageAsset(image.src);
  const fitOptions = resolvePptxImageFitOptions(position, asset, image.fitMode, { crop: image.crop, focus: image.focus });
  const props: PptxGenJS.ImageProps = { ...fitOptions, ...toPptxImageSource(asset) };
  if (image.alt) props.altText = image.alt;
  if (fitOptions.sizing) props.sizing = fitOptions.sizing;
  const mask = resolveImageMaskGeometry(resolveImageMaskShape(image.maskShape, image.rounding));
  const ellipse = mask?.type === 'preset' && mask.name === 'ellipse';
  if (ellipse) props.rounding = true;
  const geometry = mask && !ellipse ? mask : undefined;
  if (geometry || image.adjust) {
    if (!paintContext) throw new Error('图片形状遮罩和调色需要 PPTX 补丁上下文。');
    props.objectName = registerPptxPicture(paintContext, {
      ...(geometry ? { geometry } : {}),
      ...(image.adjust ? { adjust: image.adjust } : {}),
    });
  }
  if (image.transparency != null) props.transparency = clamp(Math.round(image.transparency * 100), 0, 100);
  if (image.shadow) props.shadow = mapImageShadowToProps(image.shadow);
  if (image.rotate != null) props.rotate = image.rotate;
  if (image.flipH != null) props.flipH = image.flipH;
  if (image.flipV != null) props.flipV = image.flipV;
  return props;
}
