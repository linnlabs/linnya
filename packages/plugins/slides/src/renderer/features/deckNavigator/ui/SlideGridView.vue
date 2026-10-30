<template>
  <div
    ref="scrollHostRef"
    class="slide-grid"
    data-overlay-scroll-theme="linnya"
  >
    <div
      :ref="bindViewport"
      class="slide-grid__viewport"
      :style="viewportStyle"
      role="group"
      :aria-label="deckNavigatorMessage('slides.navigator.grid.label')"
      data-overlayscrollbars-initialize
      @scroll="handleViewportScroll"
      @keydown="handleKeydown"
    >
      <!-- OverlayScrollbars 会改写自定义视口的 padding，留白放在内层内容上。 -->
      <div class="slide-grid__content">
        <p
          v-if="slides.length === 0"
          class="slide-grid__empty"
        >
          {{ slidesPreviewMessage('slides.preview.empty.noSlides') }}
        </p>
        <div
          v-else
          v-bind="wrapperProps"
        >
          <div
            v-for="row in list"
            :key="row.index"
            class="slide-grid__row"
            :style="rowStyle"
          >
            <button
              v-for="slideIndex in row.data"
              :key="slides[slideIndex]?.slideId ?? slideIndex"
              type="button"
              class="slide-grid__cell"
              :class="{ 'slide-grid__cell--current': slideIndex === currentSlideIndex }"
              :style="{ width: `${layout.cellWidth}px` }"
              :data-slide-index="slideIndex"
              :tabindex="slideIndex === currentSlideIndex ? 0 : -1"
              :aria-current="slideIndex === currentSlideIndex ? 'true' : undefined"
              :aria-label="deckNavigatorMessage('slides.navigator.slide.label', { number: slideIndex + 1 })"
              @click="selectSlide(slideIndex)"
              @dblclick="openSlide(slideIndex)"
            >
              <SlideThumbnail
                :width="layout.cellWidth"
                :height="layout.thumbnailHeight"
                :bitmap="readBitmap(slideIndex)"
              />
              <span
                class="slide-grid__caption"
                aria-hidden="true"
              >{{ slideIndex + 1 }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { storeToRefs } from 'pinia';
import { useVirtualList } from '@vueuse/core';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import { useSlidesStore } from '../../../store/slidesStore';
import { useSlidesRenderStore } from '../../../store/slidesRenderStore';
import { useSlidesThumbnailStore } from '../store/slidesThumbnailStore';
import { useSlidesUiStore } from '../../../store/slidesUiStore';
import { manualEditPresentationTrace, useSlidesManualEditingStore } from '../../manualEditing';
import { useSlidesPreviewLocalization } from '../../previewRenderState';
import {
  resolveSlideGridLayout,
  SLIDE_GRID_COLUMN_GAP_PX,
  SLIDE_GRID_ROW_GAP_PX,
} from '../functions/slideGridLayout';
import { isSlideNavigationKey, resolveSlideNavigationIndex } from '../functions/slideKeyboardNavigation';
import { resolveNearestScrollOffset } from '../functions/nearestScrollOffset';
import { useDeckNavigatorLocalization } from './useDeckNavigatorLocalization';
import SlideThumbnail from './SlideThumbnail.vue';

/** 与 CSS 顶部留白一致，供滚动定位换算行坐标。 */
const GRID_PADDING_TOP_PX = 28;

const slidesStore = useSlidesStore();
const uiStore = useSlidesUiStore();
const thumbnailStore = useSlidesThumbnailStore();
const manualEditingStore = useSlidesManualEditingStore();
const { deckPreview, currentSlideIndex, currentDeckId } = storeToRefs(slidesStore);
const { renderModel } = storeToRefs(useSlidesRenderStore());
const { deckNavigatorMessage } = useDeckNavigatorLocalization();
const { slidesPreviewMessage } = useSlidesPreviewLocalization();

const slides = computed(() => deckPreview.value?.slides ?? []);
const viewportWidth = ref(0);
const layout = computed(() => resolveSlideGridLayout({
  viewportWidth: viewportWidth.value,
  slideSize: deckPreview.value?.slideSize,
  slideCount: slides.value.length,
}));
const rows = computed(() => layout.value.rows);
const rowStyle = computed(() => ({
  width: `${layout.value.columns * layout.value.cellWidth + (layout.value.columns - 1) * SLIDE_GRID_COLUMN_GAP_PX}px`,
  height: `${layout.value.rowHeight}px`,
  paddingBottom: `${SLIDE_GRID_ROW_GAP_PX}px`,
  columnGap: `${SLIDE_GRID_COLUMN_GAP_PX}px`,
}));

const { list, containerProps, wrapperProps } = useVirtualList(rows, {
  itemHeight: () => layout.value.rowHeight,
  overscan: 2,
});

const scrollHostRef = ref<HTMLElement | null>(null);
const viewportMountRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const viewportStyle = computed(() => containerProps.style);

const {
  init: initOverlayScroll,
  scheduleUpdate: scheduleOverlayScrollUpdate,
  destroy: destroyOverlayScroll,
} = useOverlayScrollViewport({
  bindings: {
    hostRef: scrollHostRef,
    viewportMountRef,
    viewportRef,
  },
});

const resizeObserver = new globalThis.ResizeObserver(() => syncViewportWidth());

function syncViewportWidth(): void {
  const viewport = viewportMountRef.value;
  if (viewport) viewportWidth.value = viewport.clientWidth;
}

function bindViewport(element: Element | ComponentPublicInstance | null): void {
  const viewport = element instanceof HTMLElement ? element : null;
  containerProps.ref.value = viewport;
  viewportMountRef.value = viewport;
}

function handleViewportScroll(): void {
  containerProps.onScroll();
}

function readBitmap(slideIndex: number): ImageBitmap | null {
  const slide = slides.value[slideIndex];
  return slide ? thumbnailStore.getThumbnail(slide.slideId) : null;
}

function revealSlide(index: number, behavior: ScrollBehavior): void {
  const viewport = viewportMountRef.value;
  if (!viewport || layout.value.columns < 1) return;
  const start = GRID_PADDING_TOP_PX + Math.floor(index / layout.value.columns) * layout.value.rowHeight;
  const top = resolveNearestScrollOffset({
    start,
    end: start + layout.value.rowHeight - SLIDE_GRID_ROW_GAP_PX,
    scrollOffset: viewport.scrollTop,
    viewportSize: viewport.clientHeight,
    inset: 16,
  });
  if (top !== null) viewport.scrollTo({ top, behavior });
}

function selectSlide(index: number): void {
  slidesStore.setCurrentSlide(index);
}

/** 双击或 Enter 回到单页视图并停在该页。 */
function openSlide(index: number): void {
  slidesStore.setCurrentSlide(index);
  uiStore.setDeckViewMode('slide');
}

async function handleKeydown(event: KeyboardEvent): Promise<void> {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    openSlide(currentSlideIndex.value);
    return;
  }
  if (!isSlideNavigationKey(event.key)) return;
  event.preventDefault();
  const next = resolveSlideNavigationIndex({
    key: event.key,
    currentIndex: currentSlideIndex.value,
    slideCount: slides.value.length,
    columns: layout.value.columns,
  });
  slidesStore.setCurrentSlide(next);
  revealSlide(next, 'auto');
  await nextTick();
  viewportMountRef.value
    ?.querySelector<HTMLButtonElement>(`[data-slide-index="${next}"]`)
    ?.focus({ preventScroll: true });
}

onMounted(async () => {
  await nextTick();
  initOverlayScroll();
  syncViewportWidth();
  if (viewportMountRef.value) resizeObserver.observe(viewportMountRef.value);
  await nextTick();
  revealSlide(currentSlideIndex.value, 'auto');
});

onBeforeUnmount(() => {
  resizeObserver.disconnect();
  destroyOverlayScroll();
  thumbnailStore.requestRasterWidth(0);
});

watch(() => layout.value.rasterWidth, width => thumbnailStore.requestRasterWidth(width), { immediate: true });

watch(
  () => [rows.value.length, layout.value.rowHeight] as const,
  async () => {
    await nextTick();
    scheduleOverlayScrollUpdate();
  },
  { flush: 'post' },
);

watch(currentSlideIndex, index => revealSlide(index, 'smooth'), { flush: 'post' });

/**
 * 平铺视图替代单页舞台成为可见画面：当前文稿的 RenderModel 修订一旦装入，
 * 新页格位即已呈现，人工编辑队列据此结算（缩略图位图随后异步替换占位）。
 */
watch(
  () => [renderModel.value?.presentationId, renderModel.value?.version] as const,
  ([presentationId, version]) => {
    if (!presentationId || version === undefined || presentationId !== currentDeckId.value) return;
    manualEditingStore.recordPresentedRevision(version);
    window.requestAnimationFrame(() => {
      manualEditPresentationTrace.recordPresented(presentationId, version);
    });
  },
  { immediate: true },
);
</script>
