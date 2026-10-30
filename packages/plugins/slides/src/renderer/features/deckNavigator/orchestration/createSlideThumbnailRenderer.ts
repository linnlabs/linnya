import { createThumbnailRasterRequest } from '../../slideRasterization';
import { THUMBNAIL_PIXEL_RATIO } from '../../../shared/constants';
import type {
  SlideThumbnailEntry, SlideThumbnailRendererPorts, SlideThumbnailRenderJob,
  SlideThumbnailSource,
} from '../definitions/slideThumbnails';

/** 位图按画面内容拥有生命周期；slideId 只是当前修订的展示映射。 */
export function createSlideThumbnailRenderer(ports: SlideThumbnailRendererPorts) {
  const entries = new Map<string, SlideThumbnailEntry>();
  let sources: readonly SlideThumbnailSource[] = [];
  let width = 0;
  let prioritySlideId: string | null = null;
  let activeJob: SlideThumbnailRenderJob | null = null;
  let cancelScheduled: (() => void) | null = null;

  function needsRender(entry: SlideThumbnailEntry): boolean {
    return !entry.failed && (!entry.bitmap || entry.rasterWidth < width);
  }

  function publish(): void {
    const cache = new Map<string, ImageBitmap>();
    const readySlides = new Map<string, SlideThumbnailSource['slide']>();
    const failedSlideIds: string[] = [];
    for (const source of sources) {
      const bitmap = entries.get(source.contentKey)?.bitmap;
      if (bitmap) {
        cache.set(source.slide.slideId, bitmap);
        readySlides.set(source.slide.slideId, source.slide);
      }
      if (entries.get(source.contentKey)?.failed) failedSlideIds.push(source.slide.slideId);
    }
    ports.publish({ cache, readySlides, failedSlideIds, generating: activeJob !== null || [...entries.values()].some(needsRender) });
  }

  function scheduleNext(): void {
    if (activeJob || cancelScheduled || ![...entries.values()].some(needsRender)) return;
    cancelScheduled = ports.schedule(() => {
      cancelScheduled = null;
      const priority = sources.find(source => source.slide.slideId === prioritySlideId);
      const preferred = priority && entries.get(priority.contentKey);
      const entry = preferred && needsRender(preferred)
        ? preferred : [...entries.values()].find(needsRender);
      if (entry) void render(entry);
    });
  }

  async function render(entry: SlideThumbnailEntry): Promise<void> {
    const job: SlideThumbnailRenderJob = { entry, controller: new AbortController() };
    activeJob = job;
    const rasterWidth = width;
    const { source } = entry;
    try {
      const bitmap = await ports.render(createThumbnailRasterRequest(
        source.slide, source.slideSize, rasterWidth, THUMBNAIL_PIXEL_RATIO,
      ), job.controller.signal);
      if (job.controller.signal.aborted) {
        bitmap.close();
        return;
      }
      entry.bitmap?.close();
      entry.bitmap = bitmap;
      entry.rasterWidth = rasterWidth;
    } catch (error) {
      if (!job.controller.signal.aborted) {
        entry.failed = true;
        ports.reportFailure(source.slide.slideId, error);
      }
    } finally {
      if (activeJob === job) {
        activeJob = null;
        publish();
        scheduleNext();
      }
    }
  }

  function update(nextSources: readonly SlideThumbnailSource[], rasterWidth: number): void {
    sources = nextSources;
    width = rasterWidth;
    const retained = new Set(sources.map(source => source.contentKey));
    for (const [key, entry] of entries) {
      if (retained.has(key)) continue;
      if (activeJob?.entry === entry) {
        activeJob.controller.abort();
        activeJob = null;
      }
      entry.bitmap?.close();
      entries.delete(key);
    }
    for (const source of sources) {
      const existing = entries.get(source.contentKey);
      if (existing) {
        existing.source = source;
        existing.failed = false;
      } else {
        entries.set(source.contentKey, { source, bitmap: null, rasterWidth: 0, failed: false });
      }
    }
    // 未变画面和仍在生成的画面都保留；新页序立即映射，不能短暂显示上一页的图。
    publish();
    scheduleNext();
  }

  function prioritize(slideId: string | null): void {
    prioritySlideId = slideId;
  }

  function clear(): void {
    cancelScheduled?.();
    cancelScheduled = null;
    activeJob?.controller.abort();
    activeJob = null;
    for (const entry of entries.values()) entry.bitmap?.close();
    entries.clear();
    sources = [];
    publish();
  }

  return { update, prioritize, clear };
}
