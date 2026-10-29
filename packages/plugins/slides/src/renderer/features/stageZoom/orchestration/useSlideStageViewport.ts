import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import { useSlidesUiStore } from '../../../store/slidesUiStore';
import { DEFAULT_SLIDE_SIZE, INCHES_TO_PX, KONVA_RASTER_SETTLE_DELAY_MS, SLIDE_STAGE_SCROLL_GUTTER, ZOOM_MAX, ZOOM_MIN, ZOOM_WHEEL_SENSITIVITY } from '../../../shared/constants';
import { computeFitScale } from '../../../shared/slideScale';
import { computeAnchoredScrollPosition, computeInitialScrollableStageScroll, computeScrollableStageLayout } from '../../../shared/stageViewport';
import { computeWheelZoomLevel } from '../../../shared/zoomBehavior';
import { clampKonvaRasterScale, resolveKonvaMaxRasterScale, useKonvaRasterScale } from '../../konvaPreview';
import type { SlideStageViewportOptions } from '../definitions/slideStageViewport';

/** 滚动、fit、锚点缩放与光栅清晰度共用一个生命周期，编辑手势只消费坐标事实。 */
export function useSlideStageViewport(options: SlideStageViewportOptions) {
const uiStore = useSlidesUiStore();
const { zoomLevel, zoomMode, fitZoomLevel, isFitZoom } = storeToRefs(uiStore);
const scrollHostRef = ref<HTMLElement | null>(null);
const scrollViewportMountRef = ref<HTMLElement | null>(null);
const scrollViewportRef = ref<HTMLElement | null>(null);
  const viewportWidth = ref(800);
  const viewportHeight = ref(600);
  const fitScale = ref(1);
  const stageOverlayGeometryRevision = ref(0);

  /** 首次 viewport 测量完成后置 true，在此之前隐藏内容防止 fitScale=1 的首帧闪烁 */
  const viewportMeasured = ref(false);
  let pendingZoomAnchor: { x: number; y: number } | null = null;
  let zoomCommitRafId: number | null = null;
  let latestZoomCommitId = 0;
  let stageOverlayGeometryRafId: number | null = null;
  let stageOverlayScrollViewport: HTMLElement | null = null;

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
    const slideSize = options.slideSize.value ?? DEFAULT_SLIDE_SIZE;
    return {
      width: slideSize.width * INCHES_TO_PX,
      height: slideSize.height * INCHES_TO_PX,
    };
  });

  const actualSlideSize = computed(() => options.slideSize.value ?? DEFAULT_SLIDE_SIZE);

  function updateViewport(force = false) {
    const element = scrollHostRef.value;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    if (!force && rect.width === viewportWidth.value && rect.height === viewportHeight.value) {
      return;
    }

    viewportWidth.value = rect.width;
    viewportHeight.value = rect.height;
    scheduleStageOverlayGeometryUpdate();
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
    window.addEventListener('resize', scheduleStageOverlayGeometryUpdate);
    if (scrollHostRef.value) {
      resizeObserver.observe(scrollHostRef.value);
    }
    updateViewport(true);
    viewportMeasured.value = true;
    void ensureStageOverlay().then(async (viewport) => {
      if (!viewport || !options.hasRenderableSlide.value) return;
      await resetViewportScroll();
    });
  });

  onBeforeUnmount(() => {
    resizeObserver.disconnect();
    if (zoomCommitRafId !== null) {
      window.cancelAnimationFrame(zoomCommitRafId);
      zoomCommitRafId = null;
    }
    if (stageOverlayGeometryRafId !== null) {
      window.cancelAnimationFrame(stageOverlayGeometryRafId);
      stageOverlayGeometryRafId = null;
    }
    bindStageOverlayScrollViewport(null);
    window.removeEventListener('resize', scheduleStageOverlayGeometryUpdate);
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
      bindStageOverlayScrollViewport(viewport);
      return viewport;
    }
    const viewport = initOverlayScroll();
    bindStageOverlayScrollViewport(viewport);
    return viewport;
  }

  function bindStageOverlayScrollViewport(viewport: HTMLElement | null): void {
    if (stageOverlayScrollViewport === viewport) {
      return;
    }
    stageOverlayScrollViewport?.removeEventListener('scroll', scheduleStageOverlayGeometryUpdate);
    stageOverlayScrollViewport = viewport;
    stageOverlayScrollViewport?.addEventListener(
      'scroll',
      scheduleStageOverlayGeometryUpdate,
      { passive: true },
    );
  }

  function scheduleStageOverlayGeometryUpdate(): void {
    if (stageOverlayGeometryRafId !== null) {
      return;
    }
    stageOverlayGeometryRafId = window.requestAnimationFrame(() => {
      stageOverlayGeometryRafId = null;
      stageOverlayGeometryRevision.value += 1;
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
    () => [options.shouldUseKonva.value, renderScale.value] as const,
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
      options.shouldUseKonva.value,
      options.displayedSlideId.value,
    ],
    async () => {
      await ensureStageOverlay();
      scheduleOverlayScrollUpdate();
    },
    { flush: 'post', immediate: true },
  );

  watch(
    () => options.activeSlideId.value,
    async () => {
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
return { scrollHostRef, scrollViewportMountRef, viewportMeasured, stageOverlayGeometryRevision,
  actualSlideSize, logicalSlideSize, currentLayout, scrollContentStyle, canvasShellStyle,
  renderScale, konvaRasterScale, handleWheel };
}
