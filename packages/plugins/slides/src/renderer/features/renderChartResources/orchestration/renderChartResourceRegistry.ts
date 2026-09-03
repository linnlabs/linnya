import type { ChartRenderNode } from '../../../types/render';
import { logSlidesVerbose, warnSlides } from '../../../shared/diagnosticLogging';
import type { LoadedRenderChart } from '../definitions/renderChartResource';
import { createChartResourceIdentity } from '../functions/createChartResourceIdentity';
import { renderChartToImage } from '../functions/renderChartToImage';

const DEFAULT_MAX_ENTRIES = 48;
const DEFAULT_MAX_DECODED_BYTES = 128 * 1024 * 1024;

interface RenderChartResourceEntry {
  readonly cacheKey: string;
  readonly signature: string;
  readonly pending: Promise<LoadedRenderChart>;
  loaded: LoadedRenderChart | null;
  decodedBytes: number;
}

export type ChartImageRenderer = (
  node: ChartRenderNode,
  pixelRatio: number,
) => Promise<HTMLImageElement | null>;

export interface RenderChartResourceRegistryOptions {
  maxEntries?: number;
  maxDecodedBytes?: number;
  renderImage?: ChartImageRenderer;
}

export interface RenderChartResourceRegistry {
  load(
    node: ChartRenderNode,
    pixelRatio: number,
    signal?: AbortSignal,
  ): Promise<LoadedRenderChart>;
  clear(): void;
  readonly size: number;
  readonly decodedBytes: number;
}

/** renderer execution context 内共享的图表栅格资源注册表。 */
export function createRenderChartResourceRegistry(
  options: RenderChartResourceRegistryOptions = {},
): RenderChartResourceRegistry {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxDecodedBytes = options.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;
  const renderImage = options.renderImage ?? renderChartToImage;
  const entries = new Map<string, RenderChartResourceEntry>();
  let decodedBytes = 0;

  function deleteEntry(cacheKey: string): void {
    const entry = entries.get(cacheKey);
    if (!entry) return;
    decodedBytes -= entry.decodedBytes;
    entries.delete(cacheKey);
  }

  function touch(entry: RenderChartResourceEntry): void {
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
    node: ChartRenderNode,
    pixelRatio: number,
    signal?: AbortSignal,
  ): Promise<LoadedRenderChart> {
    signal?.throwIfAborted();
    const identity = createChartResourceIdentity(node, pixelRatio);
    const cached = entries.get(identity.cacheKey);
    if (cached?.signature === identity.signature) {
      touch(cached);
      return await waitForConsumer(cached.pending, signal);
    }

    // 哈希碰撞时以完整签名确认正确性；绝不把另一张图表的 PNG 当作命中结果。
    if (cached) deleteEntry(cached.cacheKey);

    let entry: RenderChartResourceEntry;
    const pending = renderImage(node, pixelRatio)
      .then((image) => {
        if (!image) {
          throw new Error(`Chart renderer returned no image for node ${node.id}`);
        }
        const loaded: LoadedRenderChart = {
          image,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        };
        entry.loaded = loaded;
        entry.decodedBytes = estimateDecodedBytes(loaded);
        if (entries.get(entry.cacheKey) === entry) {
          decodedBytes += entry.decodedBytes;
          touch(entry);
          evictSettledEntries(entry.cacheKey);
        }
        logSlidesVerbose('RenderChartResources', 'render success', {
          cacheKey: entry.cacheKey,
          nodeId: node.id,
          chartType: node.chartType,
          pixelRatio,
          naturalWidth: loaded.naturalWidth,
          naturalHeight: loaded.naturalHeight,
        });
        return loaded;
      })
      .catch((error: unknown) => {
        if (entries.get(entry.cacheKey) === entry) deleteEntry(entry.cacheKey);
        warnSlides('RenderChartResources', '图表资源渲染失败', {
          cacheKey: entry.cacheKey,
          nodeId: node.id,
          chartType: node.chartType,
          pixelRatio,
          error,
        });
        throw error;
      });

    entry = {
      cacheKey: identity.cacheKey,
      signature: identity.signature,
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

function estimateDecodedBytes(chart: LoadedRenderChart): number {
  return chart.naturalWidth * chart.naturalHeight * 4;
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

export const sharedRenderChartResourceRegistry = createRenderChartResourceRegistry();

export function clearSharedRenderChartResourceRegistry(): void {
  sharedRenderChartResourceRegistry.clear();
}
