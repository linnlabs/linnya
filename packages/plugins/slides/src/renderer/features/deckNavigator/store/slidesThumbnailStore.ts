import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { SlideThumbnailSnapshot } from '../definitions/slideThumbnails';

export const useSlidesThumbnailStore = defineStore('slides-thumbnail', () => {
  const cache = shallowRef<ReadonlyMap<string, ImageBitmap>>(new Map());
  const generating = ref(false);
  const requestedRasterWidth = ref(0);
  const cachedCount = computed(() => cache.value.size);

  function getThumbnail(slideId: string): ImageBitmap | null {
    return cache.value.get(slideId) ?? null;
  }

  function applySnapshot(snapshot: SlideThumbnailSnapshot): void {
    // 修订号或源码定位变化不应唤醒每一个缩略图组件。
    if (cache.value.size !== snapshot.cache.size
      || [...snapshot.cache].some(([id, bitmap]) => cache.value.get(id) !== bitmap)) {
      cache.value = snapshot.cache;
    }
    generating.value = snapshot.generating;
  }

  function requestRasterWidth(widthPx: number): void {
    requestedRasterWidth.value = Math.max(0, Math.round(widthPx));
  }

  function $reset(): void {
    cache.value = new Map();
    generating.value = false;
    requestedRasterWidth.value = 0;
  }

  return { cache, generating, requestedRasterWidth, cachedCount,
    getThumbnail, applySnapshot, requestRasterWidth, $reset };
});
