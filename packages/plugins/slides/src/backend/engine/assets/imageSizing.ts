import { readFileSync } from 'node:fs';
import type { Box, ResolvedImageAsset } from '@plugin/slides/shared';
import {
  resolveImageFitGeometry,
  type ImageFitMode,
} from '@plugin/slides/shared/render-geometry';

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface PptxImageFitOptions extends Box {
  readonly sizing?: {
    readonly type: 'crop';
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/**
 * 将 PPTX 图片的原图尺寸解析为编译时几何事实。
 *
 * Slides 的图片在进入 engine 前都已经是 data URI 或本地文件；这里仅读取
 * PNG/JPEG/WebP/SVG 的尺寸头，不解码像素，也不引入图片库。这样 pure PPTX
 * worker 可以在没有浏览器的情况下复用与前端相同的 fit 几何。
 */
export function readImageDimensions(asset: ResolvedImageAsset): ImageDimensions {
  const bytesOrText = asset.kind === 'data_uri'
    ? decodeDataUri(asset.dataUri)
    : readFileSync(asset.path);
  const dimensions = readImageDimensionsFromBytes(bytesOrText);
  if (!dimensions) {
    throw new Error('Slides image dimensions could not be resolved from the image bytes.');
  }
  return dimensions;
}

/**
 * 生成 PptxGenJS 图片定位。
 *
 * cover/crop 使用“保比例显示的大图 + crop source rect”，contain 使用居中的
 * 实际图片框。不能把目标框再作为 sizing 的原图尺寸，否则 PptxGenJS 会把
 * `srcRect` 算成 0，最终退化成 stretch。
 */
export function resolvePptxImageFitOptions(
  position: Box,
  asset: ResolvedImageAsset,
  fitMode: ImageFitMode | undefined,
): PptxImageFitOptions {
  if (fitMode === 'fill' || fitMode === 'stretch') return position;

  const naturalSize = readImageDimensions(asset);
  const geometry = resolveImageFitGeometry({
    naturalWidth: naturalSize.width,
    naturalHeight: naturalSize.height,
    boxWidth: position.w,
    boxHeight: position.h,
    fitMode,
  });
  const destination = geometry.destination;
  const source = geometry.source;

  if (fitMode === 'contain' || fitMode == null) {
    return {
      x: position.x + destination.x * position.w,
      y: position.y + destination.y * position.h,
      w: destination.width * position.w,
      h: destination.height * position.h,
    };
  }

  const displayWidth = position.w / source.width;
  const displayHeight = position.h / source.height;
  return {
    x: position.x,
    y: position.y,
    w: displayWidth,
    h: displayHeight,
    sizing: {
      type: 'crop',
      x: source.x * displayWidth,
      y: source.y * displayHeight,
      w: position.w,
      h: position.h,
    },
  };
}

interface DecodedDataUri {
  readonly mediaType: string;
  readonly payload: Buffer | string;
}

function decodeDataUri(dataUri: string): DecodedDataUri {
  if (!dataUri.startsWith('data:')) throw new Error('Slides image data URI is invalid.');
  const comma = dataUri.indexOf(',');
  if (comma <= 5) throw new Error('Slides image data URI is invalid.');
  const header = dataUri.slice(5, comma).split(';');
  const mediaType = header[0]?.toLowerCase() ?? '';
  const payload = dataUri.slice(comma + 1);
  if (header.slice(1).some((part) => part.toLowerCase() === 'base64')) {
    const bytes = Buffer.from(payload.replace(/\s/gu, ''), 'base64');
    return {
      mediaType,
      payload: mediaType === 'image/svg+xml' ? bytes.toString('utf8') : bytes,
    };
  }
  return { mediaType, payload: decodeURIComponent(payload) };
}

function readImageDimensionsFromBytes(bytesOrText: DecodedDataUri | Buffer): ImageDimensions | null {
  if (typeof bytesOrText === 'object' && 'payload' in bytesOrText) {
    return typeof bytesOrText.payload === 'string'
      ? readSvgDimensions(bytesOrText.payload)
      : readImageDimensionsFromBytes(bytesOrText.payload);
  }
  const text = bytesOrText.subarray(0, 512).toString('utf8').trimStart();
  if (text.startsWith('<svg')) return readSvgDimensions(bytesOrText.toString('utf8'));
  return readPngDimensions(bytesOrText)
    ?? readJpegDimensions(bytesOrText)
    ?? readWebpDimensions(bytesOrText);
}

function readPngDimensions(bytes: Buffer): ImageDimensions | null {
  if (
    bytes.length < 24
    || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return positiveDimensions(width, height);
}

function readJpegDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    const isStartOfFrame = (
      marker >= 0xc0
      && marker <= 0xcf
      && ![0xc4, 0xc8, 0xcc].includes(marker)
    );
    if (isStartOfFrame && length >= 7) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return positiveDimensions(width, height);
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(bytes: Buffer): ImageDimensions | null {
  if (
    bytes.length < 16
    || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) return null;
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return positiveDimensions(width, height);
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
    const height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
    return positiveDimensions(width, height);
  }
  return null;
}

function readSvgDimensions(source: string): ImageDimensions | null {
  const root = /<svg\b([^>]*)>/iu.exec(source)?.[1];
  if (!root) return null;
  const viewBox = /\bviewBox\s*=\s*["']\s*([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)\s*["']/iu
    .exec(root);
  if (viewBox) {
    const width = Number(viewBox[3]);
    const height = Number(viewBox[4]);
    if (width > 0 && height > 0) return { width, height };
  }
  const width = readSvgLength(root, 'width');
  const height = readSvgLength(root, 'height');
  return width && height ? { width, height } : null;
}

function readSvgLength(root: string, name: string): number | null {
  const value = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)`, 'iu').exec(root)?.[1];
  const parsed = value == null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveDimensions(width: number, height: number): ImageDimensions | null {
  return width > 0 && height > 0 ? { width, height } : null;
}
