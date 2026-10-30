import { ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';

/** 只持有展示元数据；ImageBitmap 生命周期由缩略图 runtime 与资源注册表拥有。 */
export const useSlidesThumbnailStore = defineStore('slides-thumbnail', () => {
  const cachedCount = ref(0);
  const generating = ref(false);
  const requestedRasterWidth = ref(0);
  const failedSlideIds = shallowRef<readonly string[]>([]);
  function setStatus(count: number, busy: boolean, failed: readonly string[]): void {
    cachedCount.value = count;
    generating.value = busy;
    failedSlideIds.value = failed;
  }
  function requestRasterWidth(widthPx: number): void { requestedRasterWidth.value = Math.max(0, Math.round(widthPx)); }
  function $reset(): void { setStatus(0, false, []); requestedRasterWidth.value = 0; }
  return { cachedCount, generating, failedSlideIds, requestedRasterWidth, setStatus, requestRasterWidth, $reset };
});
