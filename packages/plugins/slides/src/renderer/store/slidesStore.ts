/**
 * Slides 领域事实状态
 *
 * 管理当前 deck、当前 slide、预览数据、inspect 数据等领域核心状态。
 * 不管 UI 状态（见 slidesUiStore）、不管流程态（见 slidesSessionStore）。
 */

import { defineStore } from 'pinia';
import { ref, computed, shallowRef } from 'vue';
import type { DeckPreview, SlidesDocumentBuildState } from '../types/api';
import type { DeckPreviewViewModel, SlidePreviewViewModel } from '../types/preview';
import { slidesApi } from '../services/slidesApi';
import { slidesMapper } from '../services/slidesMapper';
import { notifyWorkspaceDocumentOpened } from '@plugin/renderer/workspaceRuntime';

export const useSlidesStore = defineStore('slides', () => {
  // ─── State ───

  /** 当前选中的 deck 节点 ID */
  const currentDeckId = ref<string | null>(null);

  /** 当前 deck 的预览 ViewModel（由 mapper 映射后端 DTO） */
  const deckPreview = shallowRef<DeckPreviewViewModel | null>(null);

  /** 当前源码是否已有同版本可渲染物化。 */
  const documentBuildState = shallowRef<SlidesDocumentBuildState | null>(null);

  /** 当前选中的 slide 索引（从 0 开始） */
  const currentSlideIndex = ref(0);

  /** 当前 deck 加载状态 */
  const deckLoading = ref(false);

  /** 当前 deck 错误信息 */
  const deckError = ref<string | null>(null);

  /** 递增请求号，避免 deck 切换时旧请求覆盖新 deck */
  const deckRequestId = ref(0);

  // ─── Computed ───

  /** 当前选中的 slide ViewModel */
  const currentSlide = computed<SlidePreviewViewModel | null>(() => {
    if (!deckPreview.value) return null;
    return deckPreview.value.slides[currentSlideIndex.value] ?? null;
  });

  /** 当前 deck 的总页数 */
  const slideCount = computed(() => deckPreview.value?.slides.length ?? 0);

  /** 当前是否已有打开中的演示文稿 */
  const hasOpenDeck = computed(() => currentDeckId.value !== null);

  // ─── Actions ───

  /** 选中并加载一个 deck 的预览数据 */
  async function loadDeck(nodeId: string) {
    currentDeckId.value = nodeId;
    currentSlideIndex.value = 0;
    deckPreview.value = null;
    documentBuildState.value = null;
    await fetchDeckPreview(nodeId, { preserveSlideIndex: false, clearExistingPreview: true, notifyOpened: true });
  }

  /** 打开 deck 并定位到指定页（slideNumber 从 1 开始）。 */
  async function openDeckAtSlide(nodeId: string, slideNumber: number) {
    const targetIndex = Math.max(0, Math.trunc(slideNumber) - 1);

    if (currentDeckId.value === nodeId && deckPreview.value) {
      const lastValidIndex = Math.max(0, deckPreview.value.slides.length - 1);
      currentSlideIndex.value = Math.min(targetIndex, lastValidIndex);
      return;
    }

    await loadDeck(nodeId);

    if (!deckPreview.value) {
      return;
    }
    const lastValidIndex = Math.max(0, deckPreview.value.slides.length - 1);
    currentSlideIndex.value = Math.min(targetIndex, lastValidIndex);
  }

  /** 在保持当前 slide 选择的前提下刷新当前 deck（静默，不闪烁）。 */
  async function refreshDeck(nodeId: string) {
    await fetchDeckPreview(nodeId, { preserveSlideIndex: true, clearExistingPreview: false, notifyOpened: false, silent: true });
  }

  /** 切换当前 slide */
  function setCurrentSlide(index: number) {
    if (index >= 0 && index < slideCount.value) {
      currentSlideIndex.value = index;
    }
  }

  /** 切换到上一页 */
  function prevSlide() {
    if (currentSlideIndex.value > 0) {
      currentSlideIndex.value--;
    }
  }

  /** 切换到下一页 */
  function nextSlide() {
    if (currentSlideIndex.value < slideCount.value - 1) {
      currentSlideIndex.value++;
    }
  }

  /** 清理当前 deck 状态 */
  function clearDeck() {
    deckRequestId.value++;
    currentDeckId.value = null;
    currentSlideIndex.value = 0;
    deckPreview.value = null;
    deckError.value = null;
    documentBuildState.value = null;
    deckLoading.value = false;
  }

  /** 完整重置 */
  function $reset() {
    clearDeck();
  }

  async function fetchDeckPreview(
    nodeId: string,
    options: {
      preserveSlideIndex: boolean;
      clearExistingPreview: boolean;
      notifyOpened: boolean;
      /** 静默刷新：不设 deckLoading，避免 UI 闪烁 */
      silent?: boolean;
    },
  ) {
    const requestId = ++deckRequestId.value;
    const previousSlideIndex = currentDeckId.value === nodeId ? currentSlideIndex.value : 0;

    currentDeckId.value = nodeId;
    if (!options.preserveSlideIndex) {
      currentSlideIndex.value = 0;
    }
    if (options.clearExistingPreview) {
      deckPreview.value = null;
    }
    if (!options.silent) {
      deckLoading.value = true;
    }
    deckError.value = null;

    try {
      const buildState = await slidesApi.getDocumentBuildState(nodeId);
      if (requestId !== deckRequestId.value) {
        return;
      }
      documentBuildState.value = buildState;

      if (buildState.state === 'draft') {
        deckPreview.value = null;
        if (options.notifyOpened) {
          await notifyDocumentOpened(nodeId);
        }
        return;
      }

      const raw: DeckPreview = await slidesApi.getDeckPreview(nodeId);
      if (requestId !== deckRequestId.value) {
        return;
      }

      const mappedPreview = slidesMapper.mapDeckPreview(raw);
      deckPreview.value = mappedPreview;

      if (options.preserveSlideIndex) {
        const lastValidIndex = Math.max(0, mappedPreview.slides.length - 1);
        currentSlideIndex.value = Math.min(previousSlideIndex, lastValidIndex);
      }

      if (options.notifyOpened) {
        await notifyDocumentOpened(nodeId);
      }

    } catch (e) {
      console.error('[SlidesStore] loadDeck 失败:', e);
      if (requestId !== deckRequestId.value) {
        return;
      }

      deckError.value = e instanceof Error ? e.message : '加载演示文稿失败';
      if (options.clearExistingPreview) {
        deckPreview.value = null;
      }
    } finally {
      if (requestId === deckRequestId.value) {
        deckLoading.value = false;
      }
    }
  }

  async function notifyDocumentOpened(nodeId: string): Promise<void> {
    const openResult = await notifyWorkspaceDocumentOpened({ documentId: nodeId });
    if (!openResult.success) {
      console.error('[SlidesStore] notify-document-opened 失败:', openResult.error);
    }
  }

  return {
    // State
    currentDeckId,
    deckPreview,
    documentBuildState,
    currentSlideIndex,
    deckLoading,
    deckError,
    // Computed
    currentSlide,
    slideCount,
    hasOpenDeck,
    // Actions
    loadDeck,
    openDeckAtSlide,
    refreshDeck,
    setCurrentSlide,
    prevSlide,
    nextSlide,
    $reset,
  };
});
