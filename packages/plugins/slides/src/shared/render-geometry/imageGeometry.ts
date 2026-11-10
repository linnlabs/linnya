/**
 * 图片适配的跨端几何合同。
 *
 * source / destination 都是归一化矩形：source 相对于原图，destination
 * 相对于目标图片盒。这样浏览器可以换算成像素，PPTX adapter 可以换算成
 * 英寸，但两端不会各自重新实现 cover/contain 的比例计算。
 */

export type ImageFitMode = 'fill' | 'contain' | 'cover' | 'crop' | 'stretch';

export interface NormalizedImageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ImageFitGeometry {
  readonly source: NormalizedImageRect;
  readonly destination: NormalizedImageRect;
}

/**
 * 从原图四边各裁掉的比例（0–1），与 OOXML `a:srcRect`、Google Slides cropProperties 同义。
 * 裁剪先于 fitMode：fitMode 作用在裁剪后剩下的区域上。
 */
export interface ImageCropInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** 原图上的归一化点（0–1）；cover 时取景窗尽量以它为中心，碰到裁剪区边缘就停住。 */
export interface ImageFocusPoint {
  readonly x: number;
  readonly y: number;
}

export interface ImageFitGeometryInput {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly boxWidth: number;
  readonly boxHeight: number;
  readonly fitMode?: ImageFitMode;
  readonly crop?: ImageCropInsets;
  readonly focus?: ImageFocusPoint;
}

/** 裁剪后至少保留原图这一比例，避免退化成零尺寸。 */
export const IMAGE_CROP_MIN_VISIBLE = 0.01;

const FULL_RECT: NormalizedImageRect = Object.freeze({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});

/**
 * 计算图片在目标盒中的唯一适配几何。
 *
 * 先按 crop 取出原图的一块区域，再把这块区域按 fitMode 放进目标盒：
 * cover/crop 只继续收窄 source（取景窗按 focus 定位，缺省居中），contain
 * 只缩小 destination，stretch/fill 直接铺满。绝不通过改变 source 与
 * destination 的比例来拉伸图片（stretch 除外）。无效尺寸时 source 仍是
 * 裁剪区域、destination 铺满，让调用方保留原有的尺寸占位行为。
 */
export function resolveImageFitGeometry(
  input: ImageFitGeometryInput,
): ImageFitGeometry {
  const {
    naturalWidth,
    naturalHeight,
    boxWidth,
    boxHeight,
    fitMode,
  } = input;
  const region = resolveImageCropRegion(input.crop);

  if (
    naturalWidth <= 0
    || naturalHeight <= 0
    || boxWidth <= 0
    || boxHeight <= 0
    || !Number.isFinite(naturalWidth)
    || !Number.isFinite(naturalHeight)
    || !Number.isFinite(boxWidth)
    || !Number.isFinite(boxHeight)
  ) {
    return { source: region, destination: FULL_RECT };
  }

  const regionWidth = naturalWidth * region.width;
  const regionHeight = naturalHeight * region.height;

  if (fitMode === 'cover' || fitMode === 'crop') {
    return {
      source: resolveCoverWindow(region, regionWidth / regionHeight, boxWidth / boxHeight, input.focus),
      destination: FULL_RECT,
    };
  }

  if (fitMode === 'contain') {
    const scale = Math.min(boxWidth / regionWidth, boxHeight / regionHeight);
    const width = (regionWidth * scale) / boxWidth;
    const height = (regionHeight * scale) / boxHeight;
    return {
      source: region,
      destination: {
        x: (1 - width) / 2,
        y: (1 - height) / 2,
        width,
        height,
      },
    };
  }

  return { source: region, destination: FULL_RECT };
}

/**
 * 把裁剪比例换成原图上的归一化区域。无效值（非有限数、负数、剩余不足
 * IMAGE_CROP_MIN_VISIBLE）按“这一轴不裁”处理；作者输入在编译入口已严格校验，
 * 这里只防御导入文件里的异常值。
 */
export function resolveImageCropRegion(crop: ImageCropInsets | undefined): NormalizedImageRect {
  if (!crop) return FULL_RECT;
  const [left, width] = resolveCropAxis(crop.left, crop.right);
  const [top, height] = resolveCropAxis(crop.top, crop.bottom);
  if (left === 0 && top === 0 && width === 1 && height === 1) return FULL_RECT;
  return { x: left, y: top, width, height };
}

/** crop 是否真的裁掉了东西；全零或无效的 crop 等同于没有。 */
export function hasImageCrop(crop: ImageCropInsets | undefined): boolean {
  return resolveImageCropRegion(crop) !== FULL_RECT;
}

function resolveCropAxis(start: number, end: number): readonly [number, number] {
  const near = Number.isFinite(start) && start > 0 ? start : 0;
  const far = Number.isFinite(end) && end > 0 ? end : 0;
  const size = 1 - near - far;
  return size >= IMAGE_CROP_MIN_VISIBLE ? [near, size] : [0, 1];
}

function resolveCoverWindow(
  region: NormalizedImageRect,
  regionRatio: number,
  boxRatio: number,
  focus: ImageFocusPoint | undefined,
): NormalizedImageRect {
  // 窗口尺寸以裁剪区域为单位：比盒子更宽的区域收窄宽度，否则收窄高度。
  const windowWidth = regionRatio > boxRatio ? boxRatio / regionRatio : 1;
  const windowHeight = regionRatio > boxRatio ? 1 : regionRatio / boxRatio;
  const focusX = focus && Number.isFinite(focus.x) ? (focus.x - region.x) / region.width : 0.5;
  const focusY = focus && Number.isFinite(focus.y) ? (focus.y - region.y) / region.height : 0.5;
  const offsetX = clamp(focusX - windowWidth / 2, 0, 1 - windowWidth);
  const offsetY = clamp(focusY - windowHeight / 2, 0, 1 - windowHeight);
  return {
    x: region.x + offsetX * region.width,
    y: region.y + offsetY * region.height,
    width: windowWidth * region.width,
    height: windowHeight * region.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
