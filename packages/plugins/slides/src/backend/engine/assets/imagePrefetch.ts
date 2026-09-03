/**
 * imagePrefetch — PPTX 本地图片内联化
 *
 * PptxGenJS v4 在 `pptx.write()` 内部通过动态 import 读取本地图片，
 * Electron Main 的字节码加载链不支持该动态 import。因此编译前将尚未物化的
 * 本地路径转成 data URI。远程 URL 不是 Slides 运行时资产，必须由 AI 先下载。
 */

import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import type {
  DeckSpec,
  FreeformElement,
  ImageSourceInput,
  StructuredElement,
} from '@plugin/slides/shared';
import { resolveImageAsset } from './imageAssetResolver';

const MAX_CONCURRENT_LOCAL_READS = 12;

const EXTENSION_MIME_MAP: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.ico': 'image/x-icon',
};

/**
 * 遍历 DeckSpec，将本地文件路径读取并原地替换为 data URI。
 * 调用方必须传入本次物化使用的副本，不得传入持久化的作者快照。
 */
export async function prefetchPptxImages(deckSpec: DeckSpec): Promise<void> {
  const localPaths = collectLocalImagePaths(deckSpec);
  if (localPaths.size === 0) return;

  const localPathToDataUri = await readLocalImages(localPaths);
  for (const entry of deckSpec.slides) {
    const background = entry.spec.background;
    if (background?.image) {
      const replaced = replaceLocalAsset(background.image, localPathToDataUri);
      if (replaced) background.image = replaced;
    }
    for (const element of entry.spec.elements) {
      replaceLocalImageSourcesInElement(element, localPathToDataUri);
    }
  }
}

function collectLocalImagePaths(deckSpec: DeckSpec): Set<string> {
  const localPaths = new Set<string>();
  for (const entry of deckSpec.slides) {
    const background = entry.spec.background;
    if (background?.image) collectLocalAsset(background.image, localPaths);
    for (const element of entry.spec.elements) {
      collectLocalImageSourcesFromElement(element, localPaths);
    }
  }
  return localPaths;
}

function collectLocalAsset(source: ImageSourceInput, localPaths: Set<string>): void {
  const asset = resolveImageAsset(source);
  if (asset.kind === 'local_file') localPaths.add(asset.path);
}

function collectLocalImageSourcesFromElement(
  element: StructuredElement | FreeformElement,
  localPaths: Set<string>
): void {
  if (element.type === 'image' && element.src) {
    collectLocalAsset(element.src, localPaths);
    return;
  }
  if (element.type === 'group' && element.children) {
    for (const child of element.children) {
      collectLocalImageSourcesFromElement(child, localPaths);
    }
  }
}

function replaceLocalAsset(
  source: ImageSourceInput,
  localPathToDataUri: ReadonlyMap<string, string>
): { kind: 'data_uri'; dataUri: string } | null {
  const asset = resolveImageAsset(source);
  if (asset.kind !== 'local_file') return null;
  const dataUri = localPathToDataUri.get(asset.path);
  return dataUri ? { kind: 'data_uri', dataUri } : null;
}

function replaceLocalImageSourcesInElement(
  element: StructuredElement | FreeformElement,
  localPathToDataUri: ReadonlyMap<string, string>
): void {
  if (element.type === 'image' && element.src) {
    const replaced = replaceLocalAsset(element.src, localPathToDataUri);
    if (replaced) element.src = replaced;
    return;
  }
  if (element.type === 'group' && element.children) {
    for (const child of element.children) {
      replaceLocalImageSourcesInElement(child, localPathToDataUri);
    }
  }
}

async function readLocalImages(paths: ReadonlySet<string>): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const list = [...paths];
  for (let index = 0; index < list.length; index += MAX_CONCURRENT_LOCAL_READS) {
    const batch = list.slice(index, index + MAX_CONCURRENT_LOCAL_READS);
    const dataUris = await Promise.all(batch.map(readLocalAsDataUri));
    for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
      const sourcePath = batch[batchIndex];
      const dataUri = dataUris[batchIndex];
      if (sourcePath && dataUri) result.set(sourcePath, dataUri);
    }
  }
  return result;
}

async function readLocalAsDataUri(absolutePath: string): Promise<string> {
  const extension = path.extname(absolutePath).toLowerCase();
  const mediaType = EXTENSION_MIME_MAP[extension];
  if (!mediaType) {
    throw new Error(`Slides local image has an unsupported file extension: "${absolutePath}".`);
  }
  const buffer = await fsPromises.readFile(absolutePath);
  return `data:${mediaType};base64,${buffer.toString('base64')}`;
}
