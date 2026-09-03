import {
  ImageGenerationFailure,
  type ImageGenerationConstraints,
} from '../definitions/imageGeneration';

interface PixelSize {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
}

function parsePixelSize(size: string): PixelSize | undefined {
  const match = /^(\d{1,5})x(\d{1,5})$/i.exec(size);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (width <= 0 || height <= 0 || !Number.isSafeInteger(pixels)) return undefined;
  return { width, height, pixels };
}

/**
 * 在 Provider 调用前完成尺寸准入。`2K/4K` 等 Provider 原生枚举只有在目录明确允许时合法；
 * 不从上游错误文本反推约束，也不悄悄替换用户请求。
 */
export function resolveImageGenerationSize(
  requestedSize: string,
  constraints: ImageGenerationConstraints | undefined,
): string {
  const size = requestedSize.trim();
  if (!size) {
    throw new ImageGenerationFailure('protocol', 'image_size_invalid', false, '图片尺寸不能为空');
  }

  const allowedSizes = constraints?.allowed_sizes
    ?.map(value => value.trim())
    .filter(value => value.length > 0);
  if (allowedSizes && allowedSizes.length > 0 && !allowedSizes.includes(size)) {
    throw new ImageGenerationFailure(
      'protocol',
      'image_size_not_allowed',
      false,
      `图片尺寸 '${size}' 不在当前模型允许范围内`,
    );
  }

  const parsed = parsePixelSize(size);
  if (!parsed) {
    if (allowedSizes?.includes(size)) return size;
    throw new ImageGenerationFailure(
      'protocol',
      'image_size_invalid',
      false,
      `图片尺寸 '${size}' 不是合法的 WxH 格式或模型原生枚举`,
    );
  }
  if (constraints?.min_pixels !== undefined && parsed.pixels < constraints.min_pixels) {
    throw new ImageGenerationFailure(
      'protocol',
      'image_size_below_minimum',
      false,
      `图片尺寸 '${size}' 低于当前模型最小像素数`,
    );
  }
  if (constraints?.max_pixels !== undefined && parsed.pixels > constraints.max_pixels) {
    throw new ImageGenerationFailure(
      'protocol',
      'image_size_above_maximum',
      false,
      `图片尺寸 '${size}' 超过当前模型最大像素数`,
    );
  }
  return size;
}

export function toAiSdkPixelSize(size: string): `${number}x${number}` | undefined {
  const parsed = parsePixelSize(size);
  return parsed ? `${parsed.width}x${parsed.height}` : undefined;
}
