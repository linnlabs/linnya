import { open, stat } from 'node:fs/promises';
import type { PresentationRenderModel, RenderAssetRef } from '@plugin/slides/shared/renderModel';
import { visitRenderNodes } from '@plugin/slides/shared/renderModel/renderModelTraversal';
import { readRasterImageDimensions, type ImageDimensions } from './imageSizing';

/** 多数 PNG/WebP 头在前几十字节，JPEG 的 SOF 常在 EXIF 之后；先读前 256KB，读不到再读整份。 */
const HEADER_PROBE_BYTES = 256 * 1024;
const MAX_CACHE_ENTRIES = 256;

const fileCache = new Map<string, ImageDimensions | null>();
const dataUriCache = new Map<string, ImageDimensions | null>();

/**
 * 给生成稿 RenderModel 的位图节点补上原始像素尺寸，供图片比例与清晰度检查使用。
 * 只读尺寸头、不解码像素；按路径 + mtime + size 缓存。读不到尺寸时保持缺省，不让渲染失败。
 */
export async function attachImageNaturalSizes(model: PresentationRenderModel): Promise<void> {
  for (const slide of model.slides) {
    const pending: Promise<void>[] = [];
    visitRenderNodes(slide.elements, ({ node }) => {
      if (node.kind !== 'image' || node.naturalSize) return;
      pending.push(readAssetDimensions(node.assetRef).then((dimensions) => {
        if (dimensions) node.naturalSize = { width: dimensions.width, height: dimensions.height };
      }));
    });
    await Promise.all(pending);
  }
}

async function readAssetDimensions(ref: RenderAssetRef): Promise<ImageDimensions | null> {
  try {
    if (ref.type === 'embedded') return await readFileDimensions(ref.partPath);
    if (ref.type === 'data') return readDataUriDimensions(ref.dataUri);
  } catch {
    return null;
  }
  return null;
}

async function readFileDimensions(path: string): Promise<ImageDimensions | null> {
  const info = await stat(path);
  const key = `${path}\u0000${info.mtimeMs}\u0000${info.size}`;
  if (fileCache.has(key)) return fileCache.get(key) ?? null;
  const handle = await open(path, 'r');
  let dimensions: ImageDimensions | null;
  try {
    const probe = Buffer.alloc(Math.min(HEADER_PROBE_BYTES, info.size));
    await handle.read(probe, 0, probe.length, 0);
    dimensions = readRasterImageDimensions(probe);
    if (!dimensions && info.size > probe.length) {
      dimensions = readRasterImageDimensions(await handle.readFile());
    }
  } finally {
    await handle.close();
  }
  remember(fileCache, key, dimensions);
  return dimensions;
}

function readDataUriDimensions(dataUri: string): ImageDimensions | null {
  if (dataUriCache.has(dataUri)) return dataUriCache.get(dataUri) ?? null;
  const comma = dataUri.indexOf(',');
  const isBase64 = comma > 0 && /;base64$/iu.test(dataUri.slice(0, comma));
  const dimensions = isBase64
    ? readRasterImageDimensions(Buffer.from(dataUri.slice(comma + 1), 'base64'))
    : null;
  remember(dataUriCache, dataUri, dimensions);
  return dimensions;
}

function remember(cache: Map<string, ImageDimensions | null>, key: string, value: ImageDimensions | null): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}
