import { defineStore, storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useSlidesStore } from './slidesStore';

/** 渲染消费者的只读投影；不再独立请求或持有另一份模型。 */
export const useSlidesRenderStore = defineStore('slides-render', () => {
  const slides = useSlidesStore();
  const { renderModel, deckLoading: renderLoading, deckError: renderError } = storeToRefs(slides);
  const currentSlideRender = computed(() => renderModel.value?.slides[slides.currentSlideIndex] ?? null);
  const renderSlideCount = computed(() => renderModel.value?.slides.length ?? 0);
  const hasRenderModel = computed(() => renderModel.value !== null);
  const sourceKind = computed(() => renderModel.value?.sourceKind ?? null);
  return { renderModel, renderLoading, renderError, currentSlideRender, renderSlideCount, hasRenderModel, sourceKind };
});
