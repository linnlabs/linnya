import { shallowRef } from 'vue';
import type { SlideThumbnailSnapshot } from '../definitions/slideThumbnails';
import { useSlidesThumbnailStore } from '../store/slidesThumbnailStore';

const registries = new WeakMap<ReturnType<typeof useSlidesThumbnailStore>, ReturnType<typeof createResources>>();

/** 与同一 surface 的 store 绑定，但解码资源不进入 Pinia 状态树或序列化数据。 */
export function useSlideThumbnailResources() {
  const store = useSlidesThumbnailStore();
  let resources = registries.get(store);
  if (!resources) { resources = createResources(store); registries.set(store, resources); }
  return resources;
}
function createResources(store: ReturnType<typeof useSlidesThumbnailStore>) {
  const cache = shallowRef<ReadonlyMap<string, ImageBitmap>>(new Map());
  const readySlides = shallowRef<SlideThumbnailSnapshot['readySlides']>(new Map());
  function applySnapshot(snapshot: SlideThumbnailSnapshot): void {
    if (cache.value.size !== snapshot.cache.size
      || [...snapshot.cache].some(([id, bitmap]) => cache.value.get(id) !== bitmap)) cache.value = snapshot.cache;
    readySlides.value = snapshot.readySlides;
    store.setStatus(snapshot.cache.size, snapshot.generating, snapshot.failedSlideIds);
  }
  function getThumbnail(slideId: string): ImageBitmap | null { return cache.value.get(slideId) ?? null; }
  return { cache, readySlides, applySnapshot, getThumbnail };
}
