import sharp from 'sharp';
import { detectSupportedImageMediaType } from '../../image-inspection';

export interface ImageThumbnailPixels {
  readonly width: number;
  readonly height: number;
  /** RGBA 8 位，长度为 width × height × 4。 */
  readonly data: Uint8Array;
}

export class ImagePixelsDecodeError extends Error {
  readonly name = 'ImagePixelsDecodeError';
}

/** 解码成长边不超过 maxEdge 的 RGBA 缩略图。只接受 JPEG、PNG、WebP，不按其余格式猜测。 */
export async function decodeImageThumbnailPixels(input: {
  readonly bytes: Uint8Array;
  readonly maxEdge: number;
  readonly maxInputPixels: number;
}): Promise<ImageThumbnailPixels> {
  const bytes = Buffer.from(input.bytes);
  if (!detectSupportedImageMediaType(bytes)) {
    throw new ImagePixelsDecodeError('图片不是 JPEG、PNG 或 WebP');
  }
  try {
    const { data, info } = await sharp(bytes, { failOn: 'error', limitInputPixels: input.maxInputPixels })
      .resize(input.maxEdge, input.maxEdge, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data) };
  } catch (error) {
    throw new ImagePixelsDecodeError(error instanceof Error ? error.message : String(error));
  }
}

export async function encodeRgbaPng(input: ImageThumbnailPixels): Promise<Uint8Array> {
  return await sharp(Buffer.from(input.data), { raw: { width: input.width, height: input.height, channels: 4 } })
    .png()
    .toBuffer();
}
