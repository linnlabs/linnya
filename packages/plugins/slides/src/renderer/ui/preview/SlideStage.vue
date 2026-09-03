<template>
  <div
    ref="scrollHostRef"
    class="slide-stage slide-stage-scroll-host"
    :class="{ 'stage-viewport-measured': viewportMeasured }"
    tabindex="0"
    data-overlay-scroll-theme="linnya"
    @keydown="handleKeydown"
  >
    <div
      ref="scrollViewportMountRef"
      class="slide-stage-scroll-viewport"
      data-overlayscrollbars-initialize
      @wheel="handleWheel"
    >
      <div
        v-if="renderState.renderMode === 'loading'"
        class="slide-stage-loading-spacer"
      />
      <SlidesStatusState
        v-else-if="renderState.renderMode === 'error'"
        class="slide-stage-empty"
        :title="slidesPreviewMessage('slides.preview.error.slideRendering')"
        tone="error"
      />
      <SlidesStatusState
        v-else-if="renderState.renderMode === 'empty'"
        class="slide-stage-empty"
        :title="slidesPreviewMessage('slides.preview.empty.noSlides')"
      />
      <div v-else class="slide-stage-scroll-content" :style="scrollContentStyle">
        <div
          ref="canvasShellRef"
          class="slide-stage-canvas-shell"
          :style="canvasShellStyle"
        >
          <!-- Konva 渲染路径 -->
          <div
            v-if="konvaRenderInput"
            ref="konvaWrapperRef"
            class="stage-canvas-wrapper"
            :style="konvaWrapperStyle"
            @pointerdown="handleSourcePointerDown"
            @pointermove="handleSourcePointerMove"
            @pointerup="handleSourcePointerUp"
            @pointercancel="handleSourcePointerCancel"
            @pointerleave="handleSourcePointerLeave"
          >
            <KonvaSlideStage
              :slide-render="konvaRenderInput.slideRender"
              :image-resources="konvaRenderInput.imageResources"
              :chart-resources="konvaRenderInput.chartResources"
              :slide-size="konvaRenderInput.slideSize"
              :raster-scale="konvaRasterScale"
              :selected-targets="selectedSourceTargets"
              :hovered-target="hoveredSourceTarget"
              :marquee-rect="sourceMarqueeRect"
            />
          </div>
          <SourceSelectionPromptPopover
            v-if="renderState.shouldShowSourcePrompt"
            :targets="selectedSourceTargets"
            :position="sourcePromptPosition"
            :disabled="sourceEditBusy"
            @submit="handleSourceEditSubmit"
            @cancel="resetSourceSelection"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useSlidesUiStore } from '../../store/slidesUiStore';
import {
  DEFAULT_SLIDE_SIZE,
  INCHES_TO_PX,
  KONVA_RASTER_SETTLE_DELAY_MS,
  SLIDE_STAGE_SCROLL_GUTTER,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_WHEEL_SENSITIVITY,
} from '../../shared/constants';
import { computeFitScale } from '../../shared/slideScale';
import {
  computeAnchoredScrollPosition,
  computeInitialScrollableStageScroll,
  computeScrollableStageLayout,
} from '../../shared/stageViewport';
import { computeWheelZoomLevel } from '../../shared/zoomBehavior';
import { useSlidesStore } from '../../store/slidesStore';
import { useSlidesRenderStore } from '../../store/slidesRenderStore';
import {
  SourceSelectionPromptPopover,
  resolveSourceSelectionPromptPosition,
  type SourceSelectionEditSubmitPayload,
  useSlideSourceSelectionInteraction,
} from '../../features/sourceSelection';
import KonvaSlideStage from './konva/KonvaSlideStage.vue';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import SlidesStatusState from '../shared/SlidesStatusState.vue';
import {
  resolveSlideStageRenderState,
  useSlidesPreviewLocalization,
} from '../../features/previewRenderState';
import {
  clampKonvaRasterScale,
  isKonvaNodeSupported,
  resolveKonvaMaxRasterScale,
  useKonvaRasterScale,
} from '../../features/konvaPreview';
import { useReadySlideVisualResources } from '../../features/renderVisualResources';

const props = defineProps<{
  sourceEditBusy?: boolean;
}>();

const emit = defineEmits<{
  sourceEditSubmit: [payload: SourceSelectionEditSubmitPayload];
}>();

const slidesStore = useSlidesStore();
const uiStore = useSlidesUiStore();
const renderStore = useSlidesRenderStore();
const { slidesPreviewMessage } = useSlidesPreviewLocalization();
const {
  zoomLevel,
  zoomMode,
  fitZoomLevel,
  isFitZoom,
  sourceSelectionModeEnabled,
} = storeToRefs(uiStore);
const { currentSlideRender, renderModel } = storeToRefs(renderStore);
const allRenderSlides = computed(() => renderModel.value?.slides ?? []);
const {
  displayedSlide,
  imageResources,
  chartResources,
  preparing: preparingSlideVisuals,
  preparationFailed: visualResourcePreparationFailed,
} = useReadySlideVisualResources({
  targetSlide: currentSlideRender,
  allSlides: allRenderSlides,
});

const renderSlideSize = computed(() => renderModel.value?.slideSize ?? null);
const currentSlideKonvaCompatible = computed(() =>
  displayedSlide.value !== null
  && displayedSlide.value.elements.every(isKonvaNodeSupported),
);
const renderState = computed(() =>
  resolveSlideStageRenderState({
    hasTargetSlideRender: currentSlideRender.value !== null,
    hasDisplayedSlideRender: displayedSlide.value !== null,
    preparingVisualResources: preparingSlideVisuals.value,
    visualResourcePreparationFailed: visualResourcePreparationFailed.value,
    currentSlideKonvaCompatible: currentSlideKonvaCompatible.value,
    hasRenderSlideSize: renderSlideSize.value !== null,
    sourceSelectionModeEnabled: sourceSelectionModeEnabled.value,
    canEditSourceSelection: renderModel.value?.capabilities.canEditSourceSelection === true,
  }),
);
const konvaRenderInput = computed(() => {
  if (
    renderState.value.renderMode !== 'konva'
    || displayedSlide.value === null
    || renderSlideSize.value === null
  ) {
    return null;
  }

  return {
    slideRender: displayedSlide.value,
    imageResources: imageResources.value,
    chartResources: chartResources.value,
    slideSize: renderSlideSize.value,
  };
});

const activeSlideId = computed(() => currentSlideRender.value?.slideId ?? null);
const displayedSlideId = computed(() => displayedSlide.value?.slideId ?? null);
const scrollHostRef = ref<globalThis.HTMLElement | null>(null);
const scrollViewportMountRef = ref<globalThis.HTMLElement | null>(null);
const scrollViewportRef = ref<globalThis.HTMLElement | null>(null);
const canvasShellRef = ref<globalThis.HTMLElement | null>(null);
const konvaWrapperRef = ref<globalThis.HTMLElement | null>(null);
const viewportWidth = ref(800);
const viewportHeight = ref(600);
const fitScale = ref(1);
const sourcePromptGeometryRevision = ref(0);

/** 首次 viewport 测量完成后置 true，在此之前隐藏内容防止 fitScale=1 的首帧闪烁 */
const viewportMeasured = ref(false);
let pendingZoomAnchor: { x: number; y: number } | null = null;
let zoomCommitRafId: number | null = null;
let latestZoomCommitId = 0;
let sourcePromptGeometryRafId: number | null = null;
let sourcePromptScrollViewport: HTMLElement | null = null;

const KONVA_WRAPPER_CURSOR = 'default';
const KONVA_WRAPPER_TOUCH_ACTION = 'none';

const {
  init: initOverlayScroll,
  update: updateOverlayScroll,
  scheduleUpdate: scheduleOverlayScrollUpdate,
  destroy: destroyOverlayScroll,
  getViewport,
  getInstance: getOverlayScrollInstance,
} = useOverlayScrollViewport({
  bindings: {
    hostRef: scrollHostRef,
    viewportMountRef: scrollViewportMountRef,
    viewportRef: scrollViewportRef,
  },
  options: {
    overflow: {
      x: 'scroll',
      y: 'scroll',
    },
  },
});

const logicalSlideSize = computed(() => {
  const slideSize = renderSlideSize.value ?? DEFAULT_SLIDE_SIZE;
  return {
    width: slideSize.width * INCHES_TO_PX,
    height: slideSize.height * INCHES_TO_PX,
  };
});

const actualSlideSize = computed(() => renderSlideSize.value ?? DEFAULT_SLIDE_SIZE);

const canSelectSourceElements = computed(() => (
  renderState.value.canSelectSourceElements
  && !preparingSlideVisuals.value
  && displayedSlideId.value === activeSlideId.value
));

function updateViewport(force = false) {
  const element = scrollHostRef.value;
  if (!element) return;

  const rect = element.getBoundingClientRect();
  if (!force && rect.width === viewportWidth.value && rect.height === viewportHeight.value) {
    return;
  }

  viewportWidth.value = rect.width;
  viewportHeight.value = rect.height;
  scheduleSourcePromptGeometryUpdate();
  const nextFitScale = computeFitScale(rect.width, rect.height, actualSlideSize.value);
  fitScale.value = nextFitScale;
  if (isFitZoom.value) {
    uiStore.syncFitZoomLevel(fitScale.value);
  }
}

function scheduleViewportUpdate(force = false) {
  updateViewport(force);
}

const resizeObserver = new globalThis.ResizeObserver(() => {
  scheduleViewportUpdate();
});

onMounted(() => {
  window.addEventListener('resize', scheduleSourcePromptGeometryUpdate);
  if (scrollHostRef.value) {
    resizeObserver.observe(scrollHostRef.value);
  }
  updateViewport(true);
  viewportMeasured.value = true;
  void ensureStageOverlay().then(async (viewport) => {
    if (!viewport || !renderState.value.hasRenderableSlide) return;
    await resetViewportScroll();
  });
});

onBeforeUnmount(() => {
  resizeObserver.disconnect();
  if (zoomCommitRafId !== null) {
    window.cancelAnimationFrame(zoomCommitRafId);
    zoomCommitRafId = null;
  }
  if (sourcePromptGeometryRafId !== null) {
    window.cancelAnimationFrame(sourcePromptGeometryRafId);
    sourcePromptGeometryRafId = null;
  }
  bindSourcePromptScrollViewport(null);
  window.removeEventListener('resize', scheduleSourcePromptGeometryUpdate);
  disposeKonvaRasterScale();
  latestZoomCommitId = 0;
  destroyOverlayScroll();
});

watch(actualSlideSize, () => {
  scheduleViewportUpdate(true);
});

watch(isFitZoom, (fitMode) => {
  if (fitMode) {
    uiStore.syncFitZoomLevel(fitScale.value);
  }
});

const renderScale = computed(() => (isFitZoom.value ? fitScale.value : zoomLevel.value));

const {
  selectedSourceTargets,
  hoveredSourceTarget,
  sourceMarqueeRect,
  handleSourcePointerDown,
  handleSourcePointerMove,
  handleSourcePointerUp,
  handleSourcePointerCancel,
  handleSourcePointerLeave,
  resetSourceSelection,
  reconcileSourceSelection,
} = useSlideSourceSelectionInteraction({
  canSelectSourceElements,
  currentSlideRender: displayedSlide,
  renderScale,
  actualSlideSize,
  wrapperRef: konvaWrapperRef,
});

const sourcePromptPosition = computed(() => {
  sourcePromptGeometryRevision.value;
  const slideRect = canvasShellRef.value?.getBoundingClientRect();

  return resolveSourceSelectionPromptPosition({
    targets: selectedSourceTargets.value,
    renderScale: renderScale.value,
    slideSize: actualSlideSize.value,
    ...(slideRect
      ? {
          slideViewportRect: {
            left: slideRect.left,
            top: slideRect.top,
          },
          viewportSize: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        }
      : {}),
  });
});

function handleSourceEditSubmit(instruction: string): void {
  const slideRender = displayedSlide.value;
  if (
    preparingSlideVisuals.value
    || slideRender?.slideId !== activeSlideId.value
    || selectedSourceTargets.value.length === 0
  ) {
    return;
  }

  emit('sourceEditSubmit', {
    instruction,
    slideNumber: slideRender.index + 1,
    targets: selectedSourceTargets.value,
  });
}

const currentLayout = computed(() =>
  computeScrollableStageLayout({
    viewportWidth: viewportWidth.value,
    viewportHeight: viewportHeight.value,
    slideWidth: logicalSlideSize.value.width,
    slideHeight: logicalSlideSize.value.height,
    scale: renderScale.value,
    gutter: SLIDE_STAGE_SCROLL_GUTTER,
  }),
);

const scrollContentStyle = computed(() => ({
  width: `${currentLayout.value.contentWidth}px`,
  height: `${currentLayout.value.contentHeight}px`,
}));

const canvasShellStyle = computed(() => ({
  left: `${currentLayout.value.slideLeft}px`,
  top: `${currentLayout.value.slideTop}px`,
  width: `${currentLayout.value.scaledSlideWidth}px`,
  height: `${currentLayout.value.scaledSlideHeight}px`,
}));

const KONVA_MAX_RASTER_SCALE = resolveKonvaMaxRasterScale(
  typeof window !== 'undefined' ? window.devicePixelRatio : undefined,
);

const {
  konvaRasterScale,
  commitKonvaRasterScale,
  scheduleKonvaRasterScaleCommit,
  cancelKonvaRasterCommit,
  disposeKonvaRasterScale,
} = useKonvaRasterScale({
  maxRasterScale: KONVA_MAX_RASTER_SCALE,
  settleDelayMs: KONVA_RASTER_SETTLE_DELAY_MS,
});

const konvaWrapperStyle = computed(() => {
  const safeRasterScale = konvaRasterScale.value > 0 ? konvaRasterScale.value : 1;
  const wrapperScale = renderScale.value / safeRasterScale;
  const sourceSelectionCursor = hoveredSourceTarget.value ? 'pointer' : KONVA_WRAPPER_CURSOR;

  return {
    width: `${logicalSlideSize.value.width * safeRasterScale}px`,
    height: `${logicalSlideSize.value.height * safeRasterScale}px`,
    transform: Math.abs(wrapperScale - 1) <= Number.EPSILON ? 'none' : `scale(${wrapperScale})`,
    transformOrigin: 'top left',
    cursor: sourceSelectionCursor,
    touchAction: KONVA_WRAPPER_TOUCH_ACTION,
  };
});

function resolveViewportCenter(viewport: HTMLElement) {
  return {
    x: viewport.clientWidth / 2,
    y: viewport.clientHeight / 2,
  };
}

async function ensureStageOverlay(): Promise<HTMLElement | null> {
  await nextTick();
  if (getOverlayScrollInstance()) {
    const viewport = getViewport();
    bindSourcePromptScrollViewport(viewport);
    return viewport;
  }
  const viewport = initOverlayScroll();
  bindSourcePromptScrollViewport(viewport);
  return viewport;
}

function bindSourcePromptScrollViewport(viewport: HTMLElement | null): void {
  if (sourcePromptScrollViewport === viewport) {
    return;
  }
  sourcePromptScrollViewport?.removeEventListener('scroll', scheduleSourcePromptGeometryUpdate);
  sourcePromptScrollViewport = viewport;
  sourcePromptScrollViewport?.addEventListener(
    'scroll',
    scheduleSourcePromptGeometryUpdate,
    { passive: true },
  );
}

function scheduleSourcePromptGeometryUpdate(): void {
  if (sourcePromptGeometryRafId !== null) {
    return;
  }
  sourcePromptGeometryRafId = window.requestAnimationFrame(() => {
    sourcePromptGeometryRafId = null;
    sourcePromptGeometryRevision.value += 1;
  });
}

async function resetViewportScroll(): Promise<void> {
  const viewport = await ensureStageOverlay();
  if (!viewport) return;

  const initialScroll = computeInitialScrollableStageScroll({
    viewportWidth: viewportWidth.value,
    viewportHeight: viewportHeight.value,
    layout: currentLayout.value,
  });
  viewport.scrollLeft = initialScroll.scrollLeft;
  viewport.scrollTop = initialScroll.scrollTop;
  updateOverlayScroll();
}

/** 上下方向键切换幻灯片（需先点击舞台使其获得焦点） */
function handleKeydown(e: globalThis.KeyboardEvent) {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    slidesStore.prevSlide();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    slidesStore.nextSlide();
  }
}

function handleWheel(e: globalThis.WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const viewport = getViewport();
  if (viewport) {
    const rect = viewport.getBoundingClientRect();
    pendingZoomAnchor = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }
  const currentZoom = zoomMode.value === 'fit' ? fitZoomLevel.value : zoomLevel.value;
  const nextZoom = computeWheelZoomLevel({
    currentZoom,
    deltaY: e.deltaY,
    minZoom: ZOOM_MIN,
    maxZoom: ZOOM_MAX,
    sensitivity: ZOOM_WHEEL_SENSITIVITY,
  });
  if (nextZoom !== currentZoom) {
    uiStore.setZoom(nextZoom, 'manual');
  }
}

watch(
  () => [renderState.value.shouldUseKonva, renderScale.value] as const,
  ([nextShouldUseKonva, nextScale], previous) => {
    const prevShouldUseKonva = previous?.[0] ?? false;

    if (!nextShouldUseKonva) {
      commitKonvaRasterScale(nextScale);
      return;
    }
    if (!prevShouldUseKonva) {
      commitKonvaRasterScale(nextScale);
      return;
    }

    const clampedNextScale = clampKonvaRasterScale(nextScale, KONVA_MAX_RASTER_SCALE);
    if (Math.abs(konvaRasterScale.value - clampedNextScale) <= Number.EPSILON) {
      cancelKonvaRasterCommit();
      return;
    }

    scheduleKonvaRasterScaleCommit(nextScale);
  },
  { immediate: true },
);

watch(
  () => [
    currentLayout.value.contentWidth,
    currentLayout.value.contentHeight,
    currentLayout.value.slideLeft,
    currentLayout.value.slideTop,
    renderState.value.shouldUseKonva,
    displayedSlideId.value,
  ],
  async () => {
    await ensureStageOverlay();
    scheduleOverlayScrollUpdate();
  },
  { flush: 'post', immediate: true },
);

watch(
  () => activeSlideId.value,
  async () => {
    resetSourceSelection();
    latestZoomCommitId += 1;
    commitKonvaRasterScale(renderScale.value);
    if (zoomCommitRafId !== null) {
      window.cancelAnimationFrame(zoomCommitRafId);
      zoomCommitRafId = null;
    }
    pendingZoomAnchor = null;
    await resetViewportScroll();
  },
  { flush: 'post' },
);

watch(canSelectSourceElements, (enabled) => {
  if (!enabled) {
    resetSourceSelection();
  }
});

watch(
  () => [renderModel.value?.presentationId, renderModel.value?.version] as const,
  () => {
    reconcileSourceSelection();
  },
);

watch(
  () => [zoomMode.value, renderScale.value] as const,
  async ([nextMode, nextScale], [prevMode, prevScale]) => {
    if (nextMode === 'fit') {
      latestZoomCommitId += 1;
      if (zoomCommitRafId !== null) {
        window.cancelAnimationFrame(zoomCommitRafId);
        zoomCommitRafId = null;
      }
      pendingZoomAnchor = null;
      if (prevMode !== 'fit') {
        await resetViewportScroll();
      }
      return;
    }

    if (nextScale === prevScale) {
      return;
    }

    const viewport = getViewport();
    if (!viewport) {
      pendingZoomAnchor = null;
      return;
    }

    const anchor = pendingZoomAnchor ?? resolveViewportCenter(viewport);
    const prevScrollLeft = viewport.scrollLeft;
    const prevScrollTop = viewport.scrollTop;
    const prevLayout = computeScrollableStageLayout({
      viewportWidth: viewportWidth.value,
      viewportHeight: viewportHeight.value,
      slideWidth: logicalSlideSize.value.width,
      slideHeight: logicalSlideSize.value.height,
      scale: prevScale,
      gutter: SLIDE_STAGE_SCROLL_GUTTER,
    });
    pendingZoomAnchor = null;
    const commitId = ++latestZoomCommitId;

    if (zoomCommitRafId !== null) {
      window.cancelAnimationFrame(zoomCommitRafId);
    }

    zoomCommitRafId = window.requestAnimationFrame(() => {
      zoomCommitRafId = null;
      void nextTick().then(async () => {
        if (commitId !== latestZoomCommitId) {
          return;
        }

        const resolvedViewport = await ensureStageOverlay();
        if (!resolvedViewport) return;

        const nextScroll = computeAnchoredScrollPosition({
          anchorViewportX: anchor.x,
          anchorViewportY: anchor.y,
          viewportWidth: viewportWidth.value,
          viewportHeight: viewportHeight.value,
          prevScrollLeft,
          prevScrollTop,
          prevLayout,
          nextLayout: currentLayout.value,
        });
        resolvedViewport.scrollLeft = nextScroll.scrollLeft;
        resolvedViewport.scrollTop = nextScroll.scrollTop;
        scheduleOverlayScrollUpdate();
      });
    });
  },
);
</script>
