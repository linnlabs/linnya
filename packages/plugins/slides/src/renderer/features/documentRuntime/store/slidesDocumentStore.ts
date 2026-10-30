import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';
import type { InstalledPresentationView } from '@plugin/slides/shared/presentationViewSnapshot';
import type { DocumentPresentationState, PresentedFrameReceipt } from '../definitions/documentPresentation';
import { slidesMapper } from '../../../services/slidesMapper';

/** 文稿视图只有一个可写引用；模型、导航、状态和选择在同一次写入接替。 */
export const useSlidesStore = defineStore('slides', () => {
  const state = shallowRef<DocumentPresentationState>({ documentId: null, epoch: 0, installed: null,
    selectedIndex: 0, selectionEpoch: 0, loading: false, error: null });
  const presentedFrame = shallowRef<PresentedFrameReceipt | null>(null);
  const presentationError = shallowRef<string | null>(null);
  function setPresentedFrame(frame: PresentedFrameReceipt | null): void { presentedFrame.value = frame; }
  function setPresentationError(error: string | null): void { presentationError.value = error; }
  const currentDeckId = computed(() => state.value.documentId);
  const documentBuildState = computed(() => state.value.installed?.buildState ?? null);
  const deckPreview = computed(() => {
    const preview = state.value.installed?.preview;
    return preview ? slidesMapper.mapDeckPreview(preview) : null;
  });
  const renderModel = computed(() => state.value.installed?.renderModel ?? null);
  const currentSlideIndex = computed(() => state.value.selectedIndex);
  const slideCount = computed(() => renderModel.value?.slides.length ?? 0);
  const currentSlide = computed(() => renderModel.value?.slides[state.value.selectedIndex] ?? null);
  const deckLoading = computed(() => state.value.loading);
  const deckError = computed(() => state.value.error);
  const hasOpenDeck = computed(() => state.value.documentId !== null);
  function beginDocument(documentId: string | null): void {
    presentedFrame.value = null;
    presentationError.value = null;
    state.value = { documentId, epoch: state.value.epoch + 1, installed: null,
      selectedIndex: 0, selectionEpoch: state.value.selectionEpoch + 1, loading: documentId !== null, error: null };
  }
  function installSnapshot(installed: InstalledPresentationView, selectedIndex: number): void {
    state.value = { ...state.value, installed, selectedIndex, loading: false, error: null };
  }
  function setReadError(error: string | null): void { state.value = { ...state.value, loading: false, error }; }
  function setCurrentSlide(index: number): void {
    if (index < 0 || index >= slideCount.value) return;
    state.value = { ...state.value, selectedIndex: index, selectionEpoch: state.value.selectionEpoch + 1 };
  }
  function prevSlide(): void { setCurrentSlide(currentSlideIndex.value - 1); }
  function nextSlide(): void { setCurrentSlide(currentSlideIndex.value + 1); }
  function $reset(): void { beginDocument(null); }
  return { presentedFrame, presentationError, setPresentedFrame, setPresentationError, state, currentDeckId, documentBuildState, deckPreview, renderModel, currentSlideIndex,
    slideCount, currentSlide, deckLoading, deckError, hasOpenDeck, beginDocument, installSnapshot,
    setReadError, setCurrentSlide, prevSlide, nextSlide, $reset };
});
