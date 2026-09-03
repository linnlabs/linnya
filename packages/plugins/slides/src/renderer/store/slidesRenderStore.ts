/**
 * Slides 渲染模型状态
 *
 * 管理 Konva 渲染层消费的 PresentationRenderModel。
 * 与 slidesStore（deck 级导航事实）并存，本 store 专注于当前 deck 的渲染模型。
 */

import { defineStore, storeToRefs } from 'pinia';
import { ref, computed, shallowRef, watch } from 'vue';
import type {
  PresentationRenderModel,
  RenderNode,
  SlideRenderModel,
} from '../types/render';
import { useSlidesStore } from './slidesStore';
import { slidesRenderApi } from '../services/slidesRenderApi';
import { logSlidesVerbose } from '../shared/diagnosticLogging';

export const useSlidesRenderStore = defineStore('slides-render', () => {
  // ─── State ───

  /** 当前 deck 的完整渲染模型 */
  const renderModel = shallowRef<PresentationRenderModel | null>(null);

  /** 渲染模型加载中 */
  const renderLoading = ref(false);

  /** 渲染模型错误信息 */
  const renderError = ref<string | null>(null);

  /** 递增请求号，避免旧请求覆盖新 deck */
  const renderRequestId = ref(0);

  // ─── Computed ───

  const slidesStore = useSlidesStore();
  const { currentSlideIndex } = storeToRefs(slidesStore);

  /** 当前选中页的渲染模型 */
  const currentSlideRender = computed<SlideRenderModel | null>(() => {
    if (!renderModel.value) return null;
    return renderModel.value.slides[currentSlideIndex.value] ?? null;
  });

  /** 渲染模型中的总页数 */
  const renderSlideCount = computed(() => renderModel.value?.slides.length ?? 0);

  /** 是否有可用的渲染模型 */
  const hasRenderModel = computed(() => renderModel.value !== null);

  /** 数据来源类别 */
  const sourceKind = computed(() => renderModel.value?.sourceKind ?? null);

  // ─── Actions ───

  /**
   * 加载指定 deck 的渲染模型
   *
   * 由 slidesStore.loadDeck 成功后调用，或独立刷新。
   * 内部只读取后端 render-model 端点；DeckPreview 不再桥接为渲染模型。
   *
   * @param keepExisting 为 true 时保留旧 renderModel 直到新数据到达，避免闪烁
   */
  async function loadRenderModel(nodeId: string, options?: { keepExisting?: boolean }) {
    const requestId = ++renderRequestId.value;
    const keep = options?.keepExisting === true;

    if (!keep) {
      renderLoading.value = true;
      renderModel.value = null;
    }
    renderError.value = null;

    try {
      const model = await slidesRenderApi.getRenderModel(nodeId);

      if (requestId !== renderRequestId.value) return;
      renderModel.value = model;
      logSlidesVerbose('RenderModel', 'loaded', summarizeRenderModel(model));
    } catch (e) {
      console.error('[SlidesRenderStore] loadRenderModel 失败:', e);
      if (requestId !== renderRequestId.value) return;
      renderError.value = e instanceof Error ? e.message : '加载渲染模型失败';
      if (!keep) {
        renderModel.value = null;
      }
    } finally {
      if (requestId === renderRequestId.value) {
        renderLoading.value = false;
      }
    }
  }

  /** 清理渲染模型状态 */
  function clearRenderModel() {
    renderRequestId.value++;
    renderModel.value = null;
    renderError.value = null;
    renderLoading.value = false;
  }

  function $reset() {
    clearRenderModel();
  }

  /* 当 slidesStore 的 deck 被清理时，同步清理 render model */
  watch(() => slidesStore.currentDeckId, (newId) => {
    if (!newId) {
      clearRenderModel();
    }
  });

  return {
    // State
    renderModel,
    renderLoading,
    renderError,
    // Computed
    currentSlideRender,
    renderSlideCount,
    hasRenderModel,
    sourceKind,
    // Actions
    loadRenderModel,
    clearRenderModel,
    $reset,
  };
});

function summarizeRenderModel(model: PresentationRenderModel): Record<string, unknown> {
  return {
    presentationId: model.presentationId,
    version: model.version,
    sourceKind: model.sourceKind,
    capabilities: model.capabilities,
    slideCount: model.slides.length,
    slides: model.slides.map((slide) => ({
      slideId: slide.slideId,
      index: slide.index,
      rootElementCount: slide.elements.length,
      imageCount: countNodesByKind(slide.elements, 'image'),
      sourceSpanCount: countNodesWithSourceSpan(slide.elements),
    })),
  };
}

function countNodesByKind(nodes: readonly RenderNode[], kind: RenderNode['kind']): number {
  return nodes.reduce((count, node) => {
    const self = node.kind === kind ? 1 : 0;
    const children = node.kind === 'group' ? countNodesByKind(node.children, kind) : 0;
    return count + self + children;
  }, 0);
}

function countNodesWithSourceSpan(nodes: readonly RenderNode[]): number {
  return nodes.reduce((count, node) => {
    const self = node.sourceSpan ? 1 : 0;
    const children = node.kind === 'group' ? countNodesWithSourceSpan(node.children) : 0;
    return count + self + children;
  }, 0);
}
