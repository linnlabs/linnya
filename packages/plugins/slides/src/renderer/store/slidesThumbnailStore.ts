/**
 * 缩略图缓存与生命周期管理
 *
 * 监听 renderModel 变化，使用 Konva 离屏生成器分批渲染缩略图。
 * 缓存 ImageBitmap（GPU 原生位图），省去 PNG 编解码开销。
 * 支持 deck 切换清理、编辑后增量刷新、generationId 中止机制。
 */

import { defineStore } from 'pinia';
import { ref, computed, watch, shallowRef, triggerRef } from 'vue';
import { useSlidesRenderStore } from './slidesRenderStore';
import { useSlidesStore } from './slidesStore';
import {
  createThumbnailRasterRequest,
  renderSlideRasterToImageBitmap,
} from '../features/slideRasterization';
import {
  THUMBNAIL_PIXEL_RATIO,
  THUMBNAIL_WIDTH,
} from '../shared/constants';

/** 每批渲染的页数 */
const BATCH_SIZE = 4;

export const useSlidesThumbnailStore = defineStore('slides-thumbnail', () => {
  // ─── State ───

  /**
   * 缩略图缓存：slideId → ImageBitmap
   * 使用 shallowRef + Map，手动 triggerRef 通知订阅者。
   * 清理时必须对旧 bitmap 调用 .close() 释放 GPU 内存。
   */
  const cache = shallowRef<Map<string, ImageBitmap>>(new Map());

  /** 当前生成批次 ID，递增；旧批次发现 ID 不匹配即中止 */
  const generationId = ref(0);

  /** 是否有正在运行的生成任务 */
  const generating = ref(false);

  // ─── Computed ───

  const renderStore = useSlidesRenderStore();
  const slidesStore = useSlidesStore();

  /** 缓存中的缩略图数量 */
  const cachedCount = computed(() => cache.value.size);

  // ─── 核心方法 ───

  /** 获取指定 slide 的 ImageBitmap，未命中返回 null */
  function getThumbnail(slideId: string): ImageBitmap | null {
    return cache.value.get(slideId) ?? null;
  }

  /**
   * 触发全量生成。
   * 中止之前的批次，释放旧缓存后重新分批渲染所有 slide。
   */
  function regenerateAll(): void {
    const model = renderStore.renderModel;
    if (!model) return;

    const id = ++generationId.value;
    const slides = model.slides;
    const slideSize = model.slideSize;
    if (!slides.length) {
      disposeAllBitmaps();
      cache.value = new Map();
      triggerRef(cache);
      generating.value = false;
      return;
    }

    generating.value = true;
    processBatch(slides.map(s => s.slideId), slideSize, 0, id, new Set(slides.map(s => s.slideId)));
  }

  /**
   * 增量刷新指定 slide 的缩略图。
   * 不中止整体批次，只更新指定页。
   */
  async function refreshSlide(slideId: string): Promise<void> {
    const model = renderStore.renderModel;
    if (!model) return;

    const slide = model.slides.find(s => s.slideId === slideId);
    if (!slide) return;

    try {
      const bitmap = await renderThumbnail(slide, model.slideSize);
      // 释放旧 bitmap
      cache.value.get(slideId)?.close();
      cache.value.set(slideId, bitmap);
      triggerRef(cache);
    } catch (e) {
      console.error('[ThumbnailStore] refreshSlide 失败:', slideId, e);
    }
  }

  /** 释放所有 ImageBitmap 的 GPU 内存 */
  function disposeAllBitmaps(): void {
    for (const bitmap of cache.value.values()) {
      bitmap.close();
    }
  }

  /** 清空所有缓存 */
  function clearCache(): void {
    generationId.value++;
    generating.value = false;
    disposeAllBitmaps();
    cache.value = new Map();
    triggerRef(cache);
  }

  function $reset(): void {
    clearCache();
  }

  // ─── 分批调度（requestIdleCallback） ───

  function processBatch(
    slideIds: string[],
    slideSize: { width: number; height: number; unit: 'in' },
    offset: number,
    batchId: number,
    activeSlideIds: ReadonlySet<string>,
  ): void {
    if (offset >= slideIds.length) {
      if (batchId === generationId.value) {
        disposeStaleBitmaps(activeSlideIds);
        triggerRef(cache);
        generating.value = false;
      }
      return;
    }

    const model = renderStore.renderModel;
    if (!model) {
      generating.value = false;
      return;
    }

    const end = Math.min(offset + BATCH_SIZE, slideIds.length);
    const batchPromises: Promise<void>[] = [];

    for (let i = offset; i < end; i++) {
      const sid = slideIds[i];
      const slide = model.slides.find(s => s.slideId === sid);
      if (!slide) continue;

      batchPromises.push(
        renderThumbnail(slide, slideSize)
          .then(bitmap => {
            if (batchId !== generationId.value) {
              bitmap.close();
              return;
            }
            const previousBitmap = cache.value.get(sid);
            if (previousBitmap && previousBitmap !== bitmap) {
              previousBitmap.close();
            }
            cache.value.set(sid, bitmap);
          })
          .catch(e => {
            console.error('[ThumbnailStore] 渲染缩略图失败:', sid, e);
          }),
      );
    }

    Promise.all(batchPromises).then(() => {
      if (batchId !== generationId.value) return;
      triggerRef(cache);
      scheduleBatch(slideIds, slideSize, end, batchId, activeSlideIds);
    });
  }

  function scheduleBatch(
    slideIds: string[],
    slideSize: { width: number; height: number; unit: 'in' },
    offset: number,
    batchId: number,
    activeSlideIds: ReadonlySet<string>,
  ): void {
    if (offset >= slideIds.length) {
      if (batchId === generationId.value) {
        disposeStaleBitmaps(activeSlideIds);
        triggerRef(cache);
        generating.value = false;
      }
      return;
    }

    const schedule = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 16);

    schedule(() => {
      if (batchId !== generationId.value) return;
      processBatch(slideIds, slideSize, offset, batchId, activeSlideIds);
    });
  }

  function disposeStaleBitmaps(activeSlideIds: ReadonlySet<string>): void {
    const staleSlideIds: string[] = [];
    for (const slideId of cache.value.keys()) {
      if (!activeSlideIds.has(slideId)) {
        staleSlideIds.push(slideId);
      }
    }

    for (const slideId of staleSlideIds) {
      cache.value.get(slideId)?.close();
      cache.value.delete(slideId);
    }
  }

  function renderThumbnail(
    slide: NonNullable<typeof renderStore.renderModel>['slides'][number],
    slideSize: { width: number; height: number; unit: 'in' },
  ): Promise<ImageBitmap> {
    const request = createThumbnailRasterRequest(
      slide,
      slideSize,
      THUMBNAIL_WIDTH,
      THUMBNAIL_PIXEL_RATIO,
    );
    if (typeof window !== 'undefined'
      && import.meta.env.DEV
      && shouldCollectThumbnailPerf(window.location.search)) {
      const startedAt = performance.now();
      return renderSlideRasterToImageBitmap(request).then((bitmap) => {
        const elapsedMs = performance.now() - startedAt;
        console.debug('[Slides/ThumbnailPerf] Renderer completed.', {
          slideId: slide.slideId,
          renderer: 'offscreen',
          elapsedMs,
        });
        return bitmap;
      });
    }

    return renderSlideRasterToImageBitmap(request);
  }

  function shouldCollectThumbnailPerf(locationSearch: string): boolean {
    const query = new URLSearchParams(locationSearch);
    const perfFlag = query.get('slidesThumbnailPerf');
    return perfFlag === '1' || perfFlag === 'true';
  }

  // ─── 自动响应 ───

  /** renderModel 变化 → 全量重新生成 */
  watch(
    () => renderStore.renderModel,
    (newModel) => {
      if (newModel) {
        regenerateAll();
      } else {
        clearCache();
      }
    },
    { immediate: true },
  );

  /** deck 切换 → 清缓存（renderModel 的 watch 会在新数据到来时触发重新生成） */
  watch(
    () => slidesStore.currentDeckId,
    (_newId, oldId) => {
      if (oldId) {
        clearCache();
      }
    },
  );

  return {
    // State（只读）
    cache,
    generating,
    cachedCount,
    // Actions
    getThumbnail,
    regenerateAll,
    refreshSlide,
    clearCache,
    $reset,
  };
});
