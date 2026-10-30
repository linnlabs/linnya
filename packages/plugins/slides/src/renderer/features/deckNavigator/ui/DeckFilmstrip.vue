<template>
  <div
    ref="scrollHostRef"
    class="deck-filmstrip"
    data-overlay-scroll-theme="linnya"
    data-overlay-scroll-visibility="strict-hover"
  >
    <div
      :ref="bindViewport"
      class="deck-filmstrip__viewport"
      :class="{ 'deck-filmstrip__viewport--entering': isEntering }"
      :style="viewportStyle"
      role="group"
      :aria-label="deckNavigatorMessage('slides.navigator.filmstrip.label')"
      data-overlayscrollbars-initialize
      @scroll="handleViewportScroll"
      @wheel="handleWheel"
      @keydown="handleKeydown"
    >
      <!-- OverlayScrollbars 会改写自定义视口的 padding，留白放在内层内容上。 -->
      <div class="deck-filmstrip__content">
        <div
          class="deck-filmstrip__track"
          v-bind="wrapperProps"
        >
          <div
            v-for="(item, listIndex) in list"
            :key="item.data.slideId"
            class="deck-filmstrip__slot"
            :style="slotStyle(listIndex)"
          >
            <button
              type="button"
              class="deck-filmstrip__item"
              :class="{
                'deck-filmstrip__item--current': item.index === currentSlideIndex,
                'deck-filmstrip__item--dragging': item.index === draggedIndex,
                'deck-filmstrip__item--drop-before': item.index === dropIndex && draggedIndex !== null && draggedIndex > item.index,
                'deck-filmstrip__item--drop-after': item.index === dropIndex && draggedIndex !== null && draggedIndex < item.index,
              }"
              :data-slide-index="item.index"
              :tabindex="item.index === currentSlideIndex ? 0 : -1"
              :aria-current="item.index === currentSlideIndex ? 'true' : undefined"
              :aria-label="deckNavigatorMessage('slides.navigator.slide.label', { number: item.index + 1 })"
              :draggable="reorderEnabled"
              @dragstart="startDrag($event, item.index)"
              @dragover="allowDrop($event, item.index)"
              @drop="dropSlide($event, item.index)"
              @dragend="endDrag"
              @click="selectSlide(item.index)"
              @contextmenu.prevent.stop="emit('slideContextMenu', $event, item.index)"
            >
              <SlideThumbnail
                :width="thumbnailSize.width"
                :height="thumbnailSize.height"
                :bitmap="thumbnailResources.getThumbnail(item.data.slideId)"
              />
              <span
                class="deck-filmstrip__number"
                aria-hidden="true"
              >{{ item.index + 1 }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSlideThumbnailResources } from '../orchestration/useSlideThumbnailResources';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { storeToRefs } from 'pinia';
import { useVirtualList } from '@vueuse/core';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import { useSlidesStore } from '../../documentRuntime';
import { useSlidesThumbnailStore } from '../store/slidesThumbnailStore';
import {
  FILMSTRIP_ITEM_GAP_PX,
  resolveFilmstripItemWidthPx,
  resolveFilmstripThumbnailSize,
} from '../../../shared/thumbnailGeometry';
import { isSlideNavigationKey, resolveSlideNavigationIndex } from '../functions/slideKeyboardNavigation';
import { resolveNearestScrollOffset } from '../functions/nearestScrollOffset';
import { useDeckNavigatorLocalization } from './useDeckNavigatorLocalization';
import SlideThumbnail from './SlideThumbnail.vue';

/** 视口左右留白；滚动定位与它保持一致，当前页不会贴边。 */
const props = defineProps<{ reorderEnabled?: boolean }>();
const emit = defineEmits<{ slideContextMenu: [event: MouseEvent, index: number]; moveSlide: [index: number, toIndex: number] }>();
const draggedIndex = ref<number | null>(null);
/** 拖到哪一页上：放下后被拖的页占据这个位置，插入线画在它被挤开的一侧。 */
const dropIndex = ref<number | null>(null);
function startDrag(event: DragEvent, index: number): void {
  if (!props.reorderEnabled || !event.dataTransfer) return;
  draggedIndex.value = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-linnya-slide', String(index));
}
function allowDrop(event: DragEvent, index: number): void {
  if (!props.reorderEnabled || draggedIndex.value === null) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropIndex.value = index === draggedIndex.value ? null : index;
}
function endDrag(): void {
  draggedIndex.value = null;
  dropIndex.value = null;
}
function dropSlide(event: DragEvent, index: number): void {
  if (!props.reorderEnabled || draggedIndex.value === null) return;
  event.preventDefault();
  if (draggedIndex.value !== index) emit('moveSlide', draggedIndex.value, index);
  endDrag();
}

const VIEWPORT_INSET_PX = 16;
const ENTRANCE_STAGGER_SECONDS = 0.04;

const slidesStore = useSlidesStore();
const thumbnailStore = useSlidesThumbnailStore();
const thumbnailResources = useSlideThumbnailResources();
watch(() => [slidesStore.currentDeckId, slidesStore.documentBuildState], endDrag);
const { renderModel, currentSlideIndex } = storeToRefs(slidesStore);
const { deckNavigatorMessage } = useDeckNavigatorLocalization();

const slides = computed(() => renderModel.value?.slides ?? []);
const slideSize = computed(() => renderModel.value?.slideSize);
const thumbnailSize = computed(() => resolveFilmstripThumbnailSize(slideSize.value));
const itemWidth = computed(() => resolveFilmstripItemWidthPx(slideSize.value));

const { list, containerProps, wrapperProps } = useVirtualList(slides, {
  itemWidth: () => itemWidth.value,
  overscan: 4,
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
  // 共享默认只滚纵向；页面条只沿横向溢出，滚动条落在缩略图下方的留白里。
  options: { overflow: { x: 'scroll', y: 'hidden' } },
});

/** 首次挂载时缩略图从左到右依次淡入，之后关闭，避免滚动时重放。 */
const isEntering = ref(true);
let enteringTimer: ReturnType<typeof setTimeout> | null = null;

function slotStyle(listIndex: number) {
  return {
    width: `${itemWidth.value}px`,
    paddingRight: `${FILMSTRIP_ITEM_GAP_PX}px`,
    ...(isEntering.value ? { '--deck-filmstrip-delay': `${listIndex * ENTRANCE_STAGGER_SECONDS}s` } : {}),
  };
}

function bindViewport(element: Element | ComponentPublicInstance | null): void {
  const viewport = element instanceof HTMLElement ? element : null;
  containerProps.ref.value = viewport;
  viewportMountRef.value = viewport;
}

function handleViewportScroll(): void {
  containerProps.onScroll();
}

/** 鼠标滚轮只有纵向增量；在横向页面条里把它转成横向滚动。触控板横滑与滚动条拖拽保持原生行为。 */
function handleWheel(event: WheelEvent): void {
  const viewport = viewportMountRef.value;
  if (!viewport || event.ctrlKey || event.metaKey) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  viewport.scrollLeft += event.deltaY;
}

function revealSlide(index: number, behavior: ScrollBehavior): void {
  const viewport = viewportMountRef.value;
  if (!viewport) return;
  const start = VIEWPORT_INSET_PX + index * itemWidth.value;
  const left = resolveNearestScrollOffset({
    start,
    end: start + thumbnailSize.value.width,
    scrollOffset: viewport.scrollLeft,
    viewportSize: viewport.clientWidth,
    inset: VIEWPORT_INSET_PX,
  });
  if (left !== null) viewport.scrollTo({ left, behavior });
}

async function handleKeydown(event: KeyboardEvent): Promise<void> {
  if (!isSlideNavigationKey(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  const next = resolveSlideNavigationIndex({
    key: event.key,
    currentIndex: currentSlideIndex.value,
    slideCount: slides.value.length,
    columns: 1,
  });
  slidesStore.setCurrentSlide(next);
  revealSlide(next, 'auto');
  await nextTick();
  viewportMountRef.value
    ?.querySelector<HTMLButtonElement>(`[data-slide-index="${next}"]`)
    ?.focus({ preventScroll: true });
}

function selectSlide(index: number): void {
  slidesStore.setCurrentSlide(index);
}

onMounted(async () => {
  enteringTimer = setTimeout(() => { isEntering.value = false; }, 600);
  await nextTick();
  initOverlayScroll();
  revealSlide(currentSlideIndex.value, 'auto');
});

onBeforeUnmount(() => {
  if (enteringTimer !== null) clearTimeout(enteringTimer);
  destroyOverlayScroll();
});

watch(
  () => slides.value.length,
  async () => {
    await nextTick();
    initOverlayScroll();
    scheduleOverlayScrollUpdate();
  },
  { flush: 'post' },
);

watch(list, () => scheduleOverlayScrollUpdate(), { flush: 'post' });

watch(currentSlideIndex, (index) => {
  revealSlide(index, prefersReducedMotion() ? 'auto' : 'smooth');
}, { flush: 'post' });

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
</script>
