import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  ImageInspectionError,
  type ImageInspectionResult,
  type SupportedImageMediaType,
} from '../definitions/imageInspection';

interface ImageFormatSignature {
  readonly mediaType: SupportedImageMediaType;
  readonly sharpFormat: 'jpeg' | 'png' | 'webp';
}

function identifyMagicBytes(bytes: Buffer): ImageFormatSignature | null {
  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) {
    return { mediaType: 'image/jpeg', sharpFormat: 'jpeg' };
  }

  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mediaType: 'image/png', sharpFormat: 'png' };
  }

  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mediaType: 'image/webp', sharpFormat: 'webp' };
  }

  return null;
}

/** 只读取签名字节，用于在文件阅读边界区分受支持图片与普通文本。完整性仍由 inspectImageBytes 负责。 */
export function detectSupportedImageMediaType(bytes: Buffer): SupportedImageMediaType | null {
  return identifyMagicBytes(bytes)?.mediaType ?? null;
}

export async function inspectImageBytes(params: {
  readonly bytes: Buffer;
  readonly maxImagePixels: number;
}): Promise<ImageInspectionResult> {
  const signature = identifyMagicBytes(params.bytes);
  if (!signature) {
    throw new ImageInspectionError(
      'unsupported_image_format',
      '图片 magic bytes 不是 JPEG、PNG 或 WebP',
    );
  }

  try {
    const pipeline = sharp(params.bytes, {
      failOn: 'error',
      limitInputPixels: params.maxImagePixels,
    });
    const metadata = await pipeline.metadata();
    if (
      metadata.format !== signature.sharpFormat
      || !metadata.width
      || !metadata.height
    ) {
      throw new ImageInspectionError(
        'invalid_image',
        '图片解码格式或尺寸与 magic bytes 不一致',
      );
    }

    const pixelCount = metadata.width * metadata.height;
    if (pixelCount > params.maxImagePixels) {
      throw new ImageInspectionError(
        'image_pixel_limit_exceeded',
        `图片像素数超过限制: actual=${pixelCount}, max=${params.maxImagePixels}`,
      );
    }

    // metadata 只读取头部；stats 会遍历像素，确保截断主体也无法通过复核。
    await pipeline.stats();

    return {
      mediaType: signature.mediaType,
      byteLength: params.bytes.length,
      width: metadata.width,
      height: metadata.height,
      sha256: createHash('sha256').update(params.bytes).digest('hex'),
    };
  } catch (error) {
    if (error instanceof ImageInspectionError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('pixel limit')) {
      throw new ImageInspectionError('image_pixel_limit_exceeded', message);
    }
    throw new ImageInspectionError('invalid_image', `图片真实解码失败: ${message}`);
  }
}
