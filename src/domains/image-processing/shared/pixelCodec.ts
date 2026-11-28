import sharp, { type Sharp } from 'sharp';
import {
  decodeImageThumbnailPixels,
  ImagePixelsDecodeError,
  type ImageThumbnailPixels,
} from 'src/shared/media/image-pixels';
import {
  MAX_INPUT_PIXELS,
  type EncodedImage,
  type ImageProcessingErrorCode,
  type ImageProcessingFailure,
  type ImageProcessingOutcome,
} from '../definitions/imageProcessing';

/** 本 domain 各操作共用的解码、编码与结果包装，只在 image-processing 内使用。 */

const JPEG_QUALITY = 90;

export type RgbaImage = ImageThumbnailPixels;

export function failure(code: ImageProcessingErrorCode, message: string): ImageProcessingFailure {
  return { status: 'failed', code, message };
}

export function ok<T>(value: T): ImageProcessingOutcome<T> {
  return { status: 'ok', value };
}

/** 解码成长边不超过 maxEdge、已按 EXIF 摆正的 RGBA；读不出时返回 `image_unreadable`。 */
export async function decode(bytes: Uint8Array, maxEdge: number): Promise<RgbaImage | ImageProcessingFailure> {
  try {
    return await decodeImageThumbnailPixels({ bytes, maxEdge, maxInputPixels: MAX_INPUT_PIXELS });
  } catch (error) {
    if (error instanceof ImagePixelsDecodeError) return failure('image_unreadable', error.message);
    throw error;
  }
}

export function isFailure(value: RgbaImage | ImageProcessingFailure): value is ImageProcessingFailure {
  return 'status' in value;
}

export function hasTransparency(data: Uint8Array): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

export function raw(pixels: RgbaImage): Sharp {
  return sharp(Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength), {
    raw: { width: pixels.width, height: pixels.height, channels: 4 },
  });
}

/** 有透明就出 PNG；整张不透明的照片出 JPEG，2400px 的照片存 PNG 要大好几倍。 */
export async function encode(pixels: RgbaImage, keepPng = false): Promise<EncodedImage> {
  if (keepPng || hasTransparency(pixels.data)) {
    const bytes = await raw(pixels).png().toBuffer();
    return { bytes: new Uint8Array(bytes), format: 'png', width: pixels.width, height: pixels.height };
  }
  const bytes = await raw(pixels).removeAlpha().jpeg({ quality: JPEG_QUALITY }).toBuffer();
  return { bytes: new Uint8Array(bytes), format: 'jpeg', width: pixels.width, height: pixels.height };
}

export async function toPixels(pipeline: Sharp): Promise<RgbaImage> {
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}
