import sharp from 'sharp';
import { detectSupportedImageMediaType } from '../../../shared/media/image-inspection';
import type { TextGenerationImageMediaType } from '@linnya/plugin-host-contract/backend/inferenceRuntime';

/** 原生支持的编码原样交付；静态 GIF/BMP 转 PNG 保留透明度，不把原始字节伪称 JPEG。 */
export async function prepareImageParsingInput(input: Uint8Array): Promise<{
  readonly bytes: Uint8Array;
  readonly mediaType: TextGenerationImageMediaType;
}> {
  const bytes = Buffer.from(input);
  const mediaType = detectSupportedImageMediaType(bytes);
  if (mediaType === 'image/png' && hasPngAnimation(bytes)) {
    throw new Error('暂不支持解析动图，请先转换为静态图片后再上传。');
  }
  const signature = bytes.subarray(0, 6).toString('ascii');
  if (mediaType || signature === 'GIF87a' || signature === 'GIF89a') {
    const image = sharp(bytes, { failOn: 'error' });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1) {
      throw new Error('暂不支持解析动图，请先转换为静态图片后再上传。');
    }
    if (mediaType) return { bytes: input, mediaType };
    return { bytes: await image.png().toBuffer(), mediaType: 'image/png' };
  }
  if (bytes.subarray(0, 2).toString('ascii') === 'BM') {
    // sharp 不支持 BMP；复用现有 Skia 解码，不引入另一套编解码依赖。
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const image = await loadImage(bytes);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return { bytes: await canvas.encode('png'), mediaType: 'image/png' };
  }
  throw new Error('无法识别图片格式，请使用 PNG、JPEG、WebP、静态 GIF 或 BMP。');
}

/** acTL 必须在 IDAT 之前；只读 PNG chunk 边界，不解码图片，也不搜索压缩正文中的偶然字节。 */
function hasPngAnimation(bytes: Buffer): boolean {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += length + 12;
  }
  return false;
}
