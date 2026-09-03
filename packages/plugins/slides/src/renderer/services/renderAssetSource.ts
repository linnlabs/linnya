import {
  canLoadRendererLocalImageAsDataUrl,
  loadRendererLocalImageAsDataUrl,
  statRendererLocalImage,
} from '@plugin/renderer/imageAssetSource';
import type { RenderAssetRef } from '../types/render';
import { logSlidesVerbose, warnSlides } from '../shared/diagnosticLogging';

const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/;
const localImageDataUrlCache = new Map<string, Promise<string>>();
const LOCAL_IMAGE_DATA_URL_CACHE_MAX_ENTRIES = 48;
let imageSourceObjectFingerprintCache = new WeakMap<RenderAssetRef, {
  rawSource: string;
  fingerprint: string;
}>();

export interface RenderableImageSourceSummary {
  refType: 'none' | 'raw' | RenderAssetRef['type'];
  rawKind: 'empty' | 'data-uri' | 'external-url' | 'absolute-path' | 'relative-or-token';
  isAbsoluteFilesystemPath: boolean;
  length: number;
}

export interface ResolvedRenderableImageResource {
  cacheKey: string;
  source: string;
}

function isAbsoluteFilesystemPath(path: string): boolean {
  return path.startsWith('/') || WINDOWS_ABSOLUTE_PATH_RE.test(path);
}

export function clearRenderableImageSourceCache(): void {
  localImageDataUrlCache.clear();
  imageSourceObjectFingerprintCache = new WeakMap();
}

async function buildLocalImageCacheKey(filePath: string): Promise<string> {
  const stat = await statRendererLocalImage(filePath);
  if (!stat.success) {
    return `path:${filePath}`;
  }
  return `path:${filePath}:size:${stat.size}:mtime:${stat.mtimeMs}`;
}

function rememberLocalImageCacheEntry(cacheKey: string, pending: Promise<string>): void {
  localImageDataUrlCache.set(cacheKey, pending);
  while (localImageDataUrlCache.size > LOCAL_IMAGE_DATA_URL_CACHE_MAX_ENTRIES) {
    const oldestKey = localImageDataUrlCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    localImageDataUrlCache.delete(oldestKey);
  }
}

async function loadLocalImageAsDataUrl(filePath: string): Promise<string> {
  const cacheKey = await buildLocalImageCacheKey(filePath);
  const cached = localImageDataUrlCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const result = await loadRendererLocalImageAsDataUrl(filePath);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.dataUrl;
  })();

  rememberLocalImageCacheEntry(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    localImageDataUrlCache.delete(cacheKey);
    throw error;
  }
}

function extractRawSource(source: RenderAssetRef | string | undefined): string | null {
  if (!source) return null;
  if (typeof source === 'string') return source;

  switch (source.type) {
    case 'data':
      return source.dataUri;
    case 'external':
      return source.url;
    case 'embedded':
      return source.partPath;
  }
}

export function getRenderableImageSourceKey(
  source: RenderAssetRef | string | undefined,
): string | null {
  const rawSource = extractRawSource(source);
  if (!rawSource) return null;
  return `${resolveRefType(source)}:${fingerprintRenderableSource(source, rawSource)}`;
}

export function summarizeRenderableImageSource(
  source: RenderAssetRef | string | undefined,
): RenderableImageSourceSummary {
  const rawSource = extractRawSource(source);
  return summarizeRawSource(resolveRefType(source), rawSource);
}

export function summarizeResolvedImageSource(source: string | null): RenderableImageSourceSummary {
  return summarizeRawSource('raw', source);
}

export async function resolveRenderableImageSource(
  source: RenderAssetRef | string | undefined,
): Promise<string | null> {
  return (await resolveRenderableImageResource(source))?.source ?? null;
}

/**
 * 同时返回可加载地址与紧凑身份。身份基于最终 source 计算，因此本地文件在
 * size/mtime 变化并重新物化后会自然得到新 key；Data URI 不再复制到 vnode、
 * watcher 或诊断日志中。
 */
export async function resolveRenderableImageResource(
  source: RenderAssetRef | string | undefined,
): Promise<ResolvedRenderableImageResource | null> {
  const rawSource = extractRawSource(source);
  if (!rawSource) {
    logSlidesVerbose('Images', 'image source is empty', {
      source: summarizeRenderableImageSource(source),
    });
    return null;
  }

  if (!isAbsoluteFilesystemPath(rawSource)) {
    logSlidesVerbose('Images', 'image source does not require local file bridge', {
      source: summarizeRenderableImageSource(source),
    });
    return {
      cacheKey: getRenderableImageSourceKey(source) ?? fingerprintSource(rawSource),
      source: rawSource,
    };
  }

  if (!canLoadRendererLocalImageAsDataUrl()) {
    warnSlides('Images', 'electronAPI.loadImageAsDataURL 不可用，无法解析本地图片', {
      source: summarizeRenderableImageSource(source),
    });
    return {
      cacheKey: getRenderableImageSourceKey(source) ?? fingerprintSource(rawSource),
      source: rawSource,
    };
  }

  try {
    const resolved = await loadLocalImageAsDataUrl(rawSource);
    logSlidesVerbose('Images', 'resolved local file image as data url', {
      source: summarizeRenderableImageSource(source),
      resolved: summarizeResolvedImageSource(resolved),
    });
    return {
      cacheKey: fingerprintRenderableSource(source, resolved),
      source: resolved,
    };
  } catch (error) {
    warnSlides('Images', '解析本地图片失败，回退为原始路径', {
      source: summarizeRenderableImageSource(source),
      error,
    });
    return {
      cacheKey: getRenderableImageSourceKey(source) ?? fingerprintSource(rawSource),
      source: rawSource,
    };
  }
}

function fingerprintRenderableSource(
  source: RenderAssetRef | string | undefined,
  rawSource: string,
): string {
  if (source && typeof source !== 'string') {
    const cached = imageSourceObjectFingerprintCache.get(source);
    if (cached?.rawSource === rawSource) {
      return cached.fingerprint;
    }
    const fingerprint = fingerprintSource(rawSource);
    imageSourceObjectFingerprintCache.set(source, { rawSource, fingerprint });
    return fingerprint;
  }
  return fingerprintSource(rawSource);
}

function fingerprintSource(source: string): string {
  // 大 Data URI 只采样固定数量字符，避免切页时在主线程遍历数 MB 文本。
  // 注册表命中后还会比较完整 source；摘要碰撞只会损失缓存命中，不会串图。
  const maxSamples = 4096;
  const sampleStep = Math.max(1, Math.floor(source.length / maxSamples));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += sampleStep) {
    const code = source.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  const lastCode = source.charCodeAt(source.length - 1);
  first = Math.imul(first ^ lastCode, 0x01000193);
  second = Math.imul(second ^ lastCode, 0x85ebca6b);
  const fingerprint = `${source.length}:${toUnsignedHex(first)}${toUnsignedHex(second)}`;
  return fingerprint;
}

function toUnsignedHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

function resolveRefType(source: RenderAssetRef | string | undefined): RenderableImageSourceSummary['refType'] {
  if (!source) {
    return 'none';
  }
  return typeof source === 'string' ? 'raw' : source.type;
}

function summarizeRawSource(
  refType: RenderableImageSourceSummary['refType'],
  rawSource: string | null,
): RenderableImageSourceSummary {
  const raw = rawSource ?? '';
  return {
    refType,
    rawKind: classifyRawSource(raw),
    isAbsoluteFilesystemPath: raw.length > 0 && isAbsoluteFilesystemPath(raw),
    length: raw.length,
  };
}

function classifyRawSource(source: string): RenderableImageSourceSummary['rawKind'] {
  if (!source) {
    return 'empty';
  }
  if (source.startsWith('data:')) {
    return 'data-uri';
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return 'external-url';
  }
  if (isAbsoluteFilesystemPath(source)) {
    return 'absolute-path';
  }
  return 'relative-or-token';
}
