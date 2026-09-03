import type { RenderAssetRef } from '../../../types/render';
import {
  resolveRenderableImageResource,
  summarizeRenderableImageSource,
  summarizeResolvedImageSource,
} from '../../../services/renderAssetSource';
import { logSlidesVerbose, warnSlides } from '../../../shared/diagnosticLogging';
import type { LoadedRenderImage } from '../definitions/renderImageResource';

const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_MAX_DECODED_BYTES = 128 * 1024 * 1024;

interface RenderImageResourceEntry {
  readonly cacheKey: string;
  readonly resolvedSource: string;
  readonly pending: Promise<LoadedRenderImage>;
  loaded: LoadedRenderImage | null;
  decodedBytes: number;
}

export interface RenderImageResourceRegistryOptions {
  maxEntries?: number;
  maxDecodedBytes?: number;
}

export interface RenderImageResourceRegistry {
  load(
    source: RenderAssetRef | string,
    signal?: AbortSignal,
  ): Promise<LoadedRenderImage>;
  clear(): void;
  readonly size: number;
  readonly decodedBytes: number;
}

/**
 * renderer execution context 内共享的解码图片注册表。
 *
 * 注册表缓存的是浏览器已经解码完成的 HTMLImageElement，而不是 Data URL 字符串。
 * 主舞台和缩略图因此可以复用同一份解码结果。LRU 只移除注册表引用；已经交给
 * 当前画布的图片仍由画布资源 map 持有，不会因淘汰而失效。
 */
export function createRenderImageResourceRegistry(
  options: RenderImageResourceRegistryOptions = {},
): RenderImageResourceRegistry {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxDecodedBytes = options.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;
  const entries = new Map<string, RenderImageResourceEntry>();
  let decodedBytes = 0;

  function deleteEntry(cacheKey: string): void {
    const entry = entries.get(cacheKey);
    if (!entry) return;
    decodedBytes -= entry.decodedBytes;
    entries.delete(cacheKey);
  }

  function touch(entry: RenderImageResourceEntry): void {
    entries.delete(entry.cacheKey);
    entries.set(entry.cacheKey, entry);
  }

  function evictSettledEntries(protectedKey: string): void {
    while (entries.size > maxEntries || decodedBytes > maxDecodedBytes) {
      const candidate = Array.from(entries.values()).find(entry => (
        entry.cacheKey !== protectedKey && entry.loaded !== null
      ));
      if (!candidate) return;
      deleteEntry(candidate.cacheKey);
    }
  }

  async function load(
    source: RenderAssetRef | string,
    signal?: AbortSignal,
  ): Promise<LoadedRenderImage> {
    signal?.throwIfAborted();
    const resolved = await resolveRenderableImageResource(source);
    signal?.throwIfAborted();
    if (!resolved) {
      throw new Error('Image source resolved to an empty value.');
    }

    const cached = entries.get(resolved.cacheKey);
    if (cached?.resolvedSource === resolved.source) {
      touch(cached);
      return await waitForConsumer(cached.pending, signal);
    }

    // 摘要碰撞时以完整 source 比较兜住正确性；碰撞只会损失一次缓存命中。
    if (cached) {
      deleteEntry(cached.cacheKey);
    }

    let entry: RenderImageResourceEntry;
    const pending = decodeImage(resolved.source)
      .then((loaded) => {
        entry.loaded = loaded;
        entry.decodedBytes = estimateDecodedBytes(loaded);
        if (entries.get(entry.cacheKey) === entry) {
          decodedBytes += entry.decodedBytes;
          touch(entry);
          evictSettledEntries(entry.cacheKey);
        }
        logSlidesVerbose('RenderImageResources', 'decode success', {
          cacheKey: entry.cacheKey,
          source: summarizeRenderableImageSource(source),
          resolved: summarizeResolvedImageSource(resolved.source),
          naturalWidth: loaded.naturalWidth,
          naturalHeight: loaded.naturalHeight,
        });
        return loaded;
      })
      .catch((error: unknown) => {
        if (entries.get(entry.cacheKey) === entry) {
          deleteEntry(entry.cacheKey);
        }
        warnSlides('RenderImageResources', '图片解码失败', {
          cacheKey: entry.cacheKey,
          source: summarizeRenderableImageSource(source),
          resolved: summarizeResolvedImageSource(resolved.source),
          error,
        });
        throw error;
      });
    entry = {
      cacheKey: resolved.cacheKey,
      resolvedSource: resolved.source,
      pending,
      loaded: null,
      decodedBytes: 0,
    };
    entries.set(entry.cacheKey, entry);
    evictSettledEntries(entry.cacheKey);
    return await waitForConsumer(pending, signal);
  }

  return {
    load,
    clear(): void {
      entries.clear();
      decodedBytes = 0;
    },
    get size(): number {
      return entries.size;
    },
    get decodedBytes(): number {
      return decodedBytes;
    },
  };
}

async function decodeImage(source: string): Promise<LoadedRenderImage> {
  const image = new globalThis.Image();
  image.crossOrigin = 'anonymous';
  image.src = source;
  await image.decode();
  return {
    image,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  };
}

function estimateDecodedBytes(image: LoadedRenderImage): number {
  return image.naturalWidth * image.naturalHeight * 4;
}

function waitForConsumer<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  signal.throwIfAborted();

  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export const sharedRenderImageResourceRegistry = createRenderImageResourceRegistry();

export function clearSharedRenderImageResourceRegistry(): void {
  sharedRenderImageResourceRegistry.clear();
}
