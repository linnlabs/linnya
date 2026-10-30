import { computed, type Ref } from 'vue';
import { useReadySlideVisualResources } from '../../renderVisualResources';
import type { EditingInsertionPreview } from '../definitions/editingInsertionPreview';
import { createInsertionPreviewSlide, retainPendingInsertionFrame } from '../functions/projectInsertionPreview';

/** 预览资源复用正式图片 registry；它是可撤下的独立层，不阻塞已保存页面的资源帧。 */
export function useInsertionPreview(insertions: Readonly<Ref<readonly EditingInsertionPreview[]>>) {
  const targetSlide = computed(() => createInsertionPreviewSlide(insertions.value));
  const resources = useReadySlideVisualResources({ targetSlide, allSlides: computed(() => []), prewarmAdjacent: false });
  const displayedSlide = computed(() => retainPendingInsertionFrame(resources.displayedSlide.value, targetSlide.value));
  return { ...resources, displayedSlide };
}
