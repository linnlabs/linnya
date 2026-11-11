import { resolveBoxRotation } from '@plugin/slides/shared/render-geometry';
import type { Context } from 'konva/lib/Context';
import type { ImageRenderNode } from '../../../../types/render';
import { INCHES_TO_PX, SLIDES_RENDER_COLORS } from '../../../../shared/constants';
import type { LoadedRenderImage } from '../../../renderImageResources';
import { DEFAULT_SHADOW_OPACITY } from '@plugin/slides/shared/renderModel';
import {
  resolveImageMaskGeometry,
  resolvePresetShapePath,
  type ResolvedPathShapeGeometry,
  type ResolvedShapeGeometry,
} from '@plugin/slides/shared/shapeGeometry';
import { resolveKonvaImageFitConfig, type KonvaImageFitConfig } from '../konvaVisualMapping';
import { PPT_ROUND_RECT_DEFAULT_ADJUSTMENT, toKonvaShadowBlur } from './shapeBuilder';
import { resolveAdjustedImageSource } from '../konvaImageAdjust';

const POINTS_TO_PX = INCHES_TO_PX / 72;

/** Konva sceneFunc 第二个参数只用于 fillStrokeShape，这里不引入 Konva 运行时类型。 */
type KonvaShapeLike = Parameters<Context['fillStrokeShape']>[0];

export function buildImageGroupConfig(node: ImageRenderNode) {
  const width = node.box.w * INCHES_TO_PX;
  const height = node.box.h * INCHES_TO_PX;
  const radius = Math.max(0, node.borderRadius ?? 0);
  return {
    ...resolveBoxRotation(node.box, node.rotation, INCHES_TO_PX),
    opacity: node.opacity ?? 1,
    visible: node.visible !== false,
    // 取景几何保证图片不超出盒子，矩形不必裁剪；裁剪会把阴影一起裁掉（去背 PNG 的阴影只剩盒内一截）。
    // 形状遮罩由 buildMaskedImageShapeConfig 画成带图案填充的形状，阴影沿遮罩外轮廓。
    ...(radius > 0 ? { clipFunc: (context: Context) => traceRoundRect(context, width, height, radius) } : {}),
  };
}

/** 图片有形状遮罩（含 `circle`）时返回遮罩几何，否则 undefined。 */
export function resolveRenderImageMask(node: ImageRenderNode): ResolvedShapeGeometry | undefined {
  return resolveImageMaskGeometry(node.maskShape);
}

/**
 * 有遮罩的图片画成一个形状：路径是遮罩（套在实际画面框上，与 PPTX 图片框一致），
 * 填充是图片图案，阴影交给形状本身，所以沿遮罩外轮廓投影。图片未加载时用占位色填同一形状。
 */
export function buildMaskedImageShapeConfig(
  node: ImageRenderNode,
  mask: ResolvedShapeGeometry,
  loadedImage: LoadedRenderImage | null,
) {
  const boxWidth = node.box.w * INCHES_TO_PX;
  const boxHeight = node.box.h * INCHES_TO_PX;
  const fit = loadedImage
    ? resolveKonvaImageFitConfig({
      naturalWidth: loadedImage.naturalWidth,
      naturalHeight: loadedImage.naturalHeight,
      boxWidth,
      boxHeight,
      fitMode: node.fitMode,
      crop: node.crop,
      focus: node.focus,
    })
    : { x: 0, y: 0, width: boxWidth, height: boxHeight };
  const { width, height } = fit;
  const flipH = node.flipH === true;
  const flipV = node.flipV === true;
  const paint = loadedImage
    ? buildMaskPatternFill(loadedImage, fit, flipH, flipV, node)
    : {
      fill: SLIDES_RENDER_COLORS.imagePlaceholderFill,
      stroke: SLIDES_RENDER_COLORS.imagePlaceholderStroke,
      strokeWidth: 1,
    };
  return {
    x: fit.x,
    y: fit.y,
    width,
    height,
    ...paint,
    ...buildImageShadowConfig(node),
    // 与 PowerPoint 一致：多个子路径的遮罩按奇偶规则挖洞。
    fillRule: 'evenodd' as const,
    sceneFunc: (context: Context, shape: KonvaShapeLike) => {
      traceImageMask(context, mask, width, height, flipH, flipV);
      context.fillStrokeShape(shape);
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
    crop: node.crop,
    focus: node.focus,
  });

  return {
    ...fit,
    x: node.flipH ? fit.x + fit.width : fit.x,
    y: node.flipV ? fit.y + fit.height : fit.y,
    image: resolveAdjustedImageSource(loadedImage.image, node.adjust),
    scaleX: node.flipH ? -1 : 1,
    scaleY: node.flipV ? -1 : 1,
    ...buildImageShadowConfig(node),
  };
}

function buildImageShadowConfig(node: ImageRenderNode) {
  return {
    shadowColor: node.shadow?.color,
    shadowBlur: node.shadow ? toKonvaShadowBlur(node.shadow.blur) : undefined,
    shadowOffsetX: node.shadow ? node.shadow.offsetX * POINTS_TO_PX : undefined,
    shadowOffsetY: node.shadow ? node.shadow.offsetY * POINTS_TO_PX : undefined,
    shadowOpacity: node.shadow ? node.shadow.opacity ?? DEFAULT_SHADOW_OPACITY : undefined,
    shadowEnabled: node.shadow != null,
  };
}

/**
 * 图案变换：原图的取景区（crop，没有则整图）正好铺满画面框。Konva 的图案矩阵是
 * translate(fillPatternX/Y) · scale · translate(-offset)；翻转用负缩放并把原点挪到对边，
 * 不翻转阴影方向。
 */
function buildMaskPatternFill(
  loadedImage: LoadedRenderImage,
  fit: KonvaImageFitConfig,
  flipH: boolean,
  flipV: boolean,
  node: ImageRenderNode,
) {
  const source = fit.crop ?? { x: 0, y: 0, width: loadedImage.naturalWidth, height: loadedImage.naturalHeight };
  const scaleX = fit.width / source.width;
  const scaleY = fit.height / source.height;
  return {
    // Konva 的类型只写了 HTMLImageElement，运行时 createPattern 同样接受调色后的画布。
    fillPatternImage: resolveAdjustedImageSource(loadedImage.image, node.adjust) as HTMLImageElement,
    fillPatternRepeat: 'no-repeat',
    fillPatternX: flipH ? fit.width : 0,
    fillPatternY: flipV ? fit.height : 0,
    fillPatternScaleX: flipH ? -scaleX : scaleX,
    fillPatternScaleY: flipV ? -scaleY : scaleY,
    fillPatternOffsetX: source.x,
    fillPatternOffsetY: source.y,
  };
}

/** 在 0..width × 0..height 内描出遮罩路径；翻转直接镜像坐标。 */
function traceImageMask(
  context: Context,
  mask: ResolvedShapeGeometry,
  width: number,
  height: number,
  flipH: boolean,
  flipV: boolean,
): void {
  context.beginPath();
  if (mask.type === 'preset') {
    switch (mask.name) {
      case 'ellipse':
        context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        context.closePath();
        return;
      case 'rect':
      case 'line':
        context.rect(0, 0, width, height);
        return;
      case 'roundRect':
        traceRoundRect(context, width, height, Math.min(width, height) * PPT_ROUND_RECT_DEFAULT_ADJUSTMENT, false);
        return;
      default: {
        const path = resolvePresetShapePath(mask.name, width, height);
        if (!path) throw new Error(`图片遮罩 ${mask.name} 缺少 Konva 路径。`);
        tracePath(context, path, width, height, flipH, flipV);
        return;
      }
    }
  }
  tracePath(context, mask, width, height, flipH, flipV);
}

function tracePath(
  context: Context,
  path: ResolvedPathShapeGeometry,
  width: number,
  height: number,
  flipH: boolean,
  flipV: boolean,
): void {
  const sx = width / path.viewBox.width;
  const sy = height / path.viewBox.height;
  const x = (value: number) => (flipH ? width - value * sx : value * sx);
  const y = (value: number) => (flipV ? height - value * sy : value * sy);
  for (const command of path.commands) {
    switch (command.type) {
      case 'moveTo': context.moveTo(x(command.x), y(command.y)); break;
      case 'lineTo': context.lineTo(x(command.x), y(command.y)); break;
      case 'quadraticTo': context.quadraticCurveTo(x(command.x1), y(command.y1), x(command.x), y(command.y)); break;
      case 'cubicTo':
        context.bezierCurveTo(x(command.x1), y(command.y1), x(command.x2), y(command.y2), x(command.x), y(command.y));
        break;
      case 'close': context.closePath(); break;
    }
  }
}

function traceRoundRect(context: Context, width: number, height: number, radius: number, begin = true): void {
  const r = Math.min(radius, width / 2, height / 2);
  if (begin) context.beginPath();
  // 圆弧角，与 Konva Rect 的 cornerRadius、PowerPoint roundRect 一致。
  context.moveTo(r, 0);
  context.arcTo(width, 0, width, height, r);
  context.arcTo(width, height, 0, height, r);
  context.arcTo(0, height, 0, 0, r);
  context.arcTo(0, 0, width, 0, r);
  context.closePath();
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
    // 有遮罩的图片未加载时由 buildMaskedImageShapeConfig 画占位，这里只剩圆角矩形。
    cornerRadius: node.borderRadius ?? 0,
  };
}
