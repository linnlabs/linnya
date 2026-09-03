<template>
  <div class="deck-outline">
    <SlidesStatusState
      v-if="slideCount === 0"
      title="暂无页面"
    />

    <div
      v-else
      ref="outlineScrollHostRef"
      class="deck-outline-scroll-host"
      data-overlay-scroll-theme="linnya"
      data-overlay-scroll-visibility="strict-hover"
    >
      <div
        :ref="bindOutlineViewport"
        class="outline-list"
        :class="{ 'outline-entering': isEntering }"
        :style="outlineViewportStyle"
        data-overlayscrollbars-initialize
        @scroll="handleOutlineViewportScroll"
      >
        <div v-bind="wrapperProps">
          <button
            v-for="(item, listIdx) in list"
            :key="item.data.slideId"
            class="outline-item"
            :class="{ active: item.index === currentSlideIndex }"
            :style="isEntering ? { '--cascade-delay': `${listIdx * 0.06}s` } : undefined"
            @click="selectSlide(item.index)"
          >
            <span class="outline-item-number">{{ item.index + 1 }}</span>
            <SlideThumbnail
              :slide-size="slideSize"
              :bitmap="thumbnailStore.getThumbnail(item.data.slideId)"
            />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { storeToRefs } from 'pinia';
import { useVirtualList } from '@vueuse/core';
import { useSlidesStore } from '../../store/slidesStore';
import { useSlidesThumbnailStore } from '../../store/slidesThumbnailStore';
import { resolveThumbnailItemHeightPx } from '../../shared/thumbnailGeometry';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import SlidesStatusState from '../shared/SlidesStatusState.vue';
import SlideThumbnail from './SlideThumbnail.vue';

const slidesStore = useSlidesStore();
const thumbnailStore = useSlidesThumbnailStore();
const { deckPreview, currentSlideIndex, slideCount } = storeToRefs(slidesStore);

const slides = computed(() => deckPreview.value?.slides ?? []);
const slideSize = computed(() => deckPreview.value?.slideSize);

const { list, containerProps, wrapperProps } = useVirtualList(slides, {
  itemHeight: () => resolveThumbnailItemHeightPx(slideSize.value),
  overscan: 3,
});

const outlineScrollHostRef = ref<HTMLElement | null>(null);
const outlineScrollViewportMountRef = ref<HTMLElement | null>(null);
const outlineScrollViewportRef = ref<HTMLElement | null>(null);
const outlineViewportStyle = computed(() => containerProps.style);

const {
  init: initOutlineOverlayScroll,
  scheduleUpdate: scheduleOutlineOverlayScrollUpdate,
  destroy: destroyOutlineOverlayScroll,
} = useOverlayScrollViewport({
  bindings: {
    hostRef: outlineScrollHostRef,
    viewportMountRef: outlineScrollViewportMountRef,
    viewportRef: outlineScrollViewportRef,
  },
});

/** 首次入场标记：仅在挂载后短暂启用，触发缩略图交错入场动画，之后关闭避免影响滚动 */
const isEntering = ref(true);

async function ensureOutlineOverlayScroll(): Promise<HTMLElement | null> {
  await nextTick();
  return initOutlineOverlayScroll();
}

function bindOutlineViewport(element: Element | ComponentPublicInstance | null): void {
  const viewport = element instanceof HTMLElement ? element : null;
  containerProps.ref.value = viewport;
  outlineScrollViewportMountRef.value = viewport;
}

function handleOutlineViewportScroll(): void {
  containerProps.onScroll();
}

onMounted(() => {
  setTimeout(() => { isEntering.value = false; }, 800);
  void ensureOutlineOverlayScroll();
});

onBeforeUnmount(() => {
  destroyOutlineOverlayScroll();
});

watch(
  () => slides.value.length,
  async () => {
    await ensureOutlineOverlayScroll();
    scheduleOutlineOverlayScrollUpdate();
  },
  { flush: 'post' },
);

watch(
  list,
  () => {
    scheduleOutlineOverlayScrollUpdate();
  },
  { flush: 'post' },
);

watch(currentSlideIndex, () => {
  scheduleOutlineOverlayScrollUpdate();
});

function selectSlide(index: number) {
  slidesStore.setCurrentSlide(index);
}
</script>
