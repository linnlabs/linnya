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

export interface ImageFitGeometryInput {
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly boxWidth: number;
  readonly boxHeight: number;
  readonly fitMode?: ImageFitMode;
}

const FULL_RECT: NormalizedImageRect = Object.freeze({
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});

/**
 * 计算图片在目标盒中的唯一适配几何。
 *
 * 无效尺寸时返回 full/full，让调用方保留原有的尺寸占位行为；有效图片
 * 在 cover/crop 下只裁剪 source，在 contain 下只缩小 destination，绝不
 * 通过改变 source 与 destination 的比例来拉伸图片。
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
    return { source: FULL_RECT, destination: FULL_RECT };
  }

  if (fitMode === 'cover' || fitMode === 'crop') {
    return resolveCoverGeometry(naturalWidth, naturalHeight, boxWidth, boxHeight);
  }

  if (fitMode === 'contain') {
    const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
    const width = (naturalWidth * scale) / boxWidth;
    const height = (naturalHeight * scale) / boxHeight;
    return {
      source: FULL_RECT,
      destination: {
        x: (1 - width) / 2,
        y: (1 - height) / 2,
        width,
        height,
      },
    };
  }

  return { source: FULL_RECT, destination: FULL_RECT };
}

function resolveCoverGeometry(
  naturalWidth: number,
  naturalHeight: number,
  boxWidth: number,
  boxHeight: number,
): ImageFitGeometry {
  const sourceRatio = naturalWidth / naturalHeight;
  const boxRatio = boxWidth / boxHeight;

  if (sourceRatio > boxRatio) {
    const sourceWidth = (naturalHeight * boxRatio) / naturalWidth;
    return {
      source: {
        x: (1 - sourceWidth) / 2,
        y: 0,
        width: sourceWidth,
        height: 1,
      },
      destination: FULL_RECT,
    };
  }

  const sourceHeight = (naturalWidth / boxRatio) / naturalHeight;
  return {
    source: {
      x: 0,
      y: (1 - sourceHeight) / 2,
      width: 1,
      height: sourceHeight,
    },
    destination: FULL_RECT,
  };
}
