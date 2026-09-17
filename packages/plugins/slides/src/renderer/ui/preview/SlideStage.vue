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
      <div
        v-else
        class="slide-stage-scroll-content"
        :style="scrollContentStyle"
      >
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
            @pointerdown="handleStagePointerDown"
            @pointermove="handleStagePointerMove"
            @pointerup="handleStagePointerUp"
            @pointercancel="handleStagePointerCancel"
            @pointerleave="handleStagePointerLeave"
            @dblclick="handleStageDoubleClick"
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
              :preview-translations="manualPreviewTranslations"
              :manual-selected-target="manualPresentedSelectedTarget"
              :manual-visual-previews="manualVisualPreviews"
              :hidden-text-element-ids="hiddenTextElementIds"
            />
          </div>
          <SourceSelectionPromptPopover
            v-if="renderState.shouldShowSourcePrompt && !manualEditingEnabled"
            :targets="selectedSourceTargets"
            :position="sourcePromptPosition"
            :disabled="sourceEditBusy"
            @submit="handleSourceEditSubmit"
            @cancel="resetSourceSelection"
          />
        </div>
        <!-- 原位 DOM 输入负责浏览器文本编辑能力；同一元素的 Canvas 文字在会话期间隐藏。 -->
        <TextDraftPreview
          v-for="draft in textPresentations"
          :key="draft.clientOperationId"
          :target="draft.target"
          :content="draft.content"
          :slide-left="currentLayout.slideLeft"
          :slide-top="currentLayout.slideTop"
          :render-scale="renderScale"
        />
        <InlineTextEditor
          v-if="textEditorTarget"
          ref="inlineTextEditor"
          :key="textSessionId ?? undefined"
          v-model="textDraft"
          :toolbar-element="textToolbarHost"
          :target="textEditorTarget"
          :slide-left="currentLayout.slideLeft"
          :slide-top="currentLayout.slideTop"
          :render-scale="renderScale"
          :label="manualEditingMessage('slides.manualEditing.text.ariaLabel')"
          @selection="inlineTextSelection = $event"
          @commit="submitTextEdit"
          @composition-start="handleTextCompositionStart"
          @composition-end="handleTextCompositionEnd"
          @escape="handleTextEditorEscape"
          @commit-shortcut="handleTextEditorSubmitShortcut"
        />
        <ManualResizeHandles
          v-if="manualPresentedSelectedTarget && canManualSelect && !textEditorTarget && canResizeManualTarget(manualPresentedSelectedTarget)"
          :key="manualPresentedSelectedTarget.elementId"
          :target="manualPresentedSelectedTarget"
          :slide-left="currentLayout.slideLeft"
          :slide-top="currentLayout.slideTop"
          :render-scale="renderScale"
          @preview="manualResizePreview = $event"
          @submit="submitManualVisualOperation"
          @finish="scrollHostRef?.focus({ preventScroll: true })"
        />
      </div>
    </div>
    <div
      v-if="textEditorTarget && manualSelectedTarget && inlineTextSelection && inlineTextAnchor"
      ref="textToolbarHost"
      @pointerdown.stop
    >
      <ElementPropertyToolbar
        :key="textSessionId ?? undefined"
        :target="manualSelectedTarget"
        :anchor="inlineTextAnchor"
        :text-selection="inlineTextSelection.style"
        @text-style="inlineTextEditor?.applyStyle($event)"
      />
    </div>
    <ElementPropertyToolbar
      v-if="manualPropertyTarget && manualPropertyAnchor && showElementPropertyControls && !textEditorTarget && !manualTranslationPreview && !manualResizePreview"
      :key="`${manualPropertyTarget.authoringRef.slideKey}/${manualPropertyTarget.authoringRef.editKey}`"
      :target="manualPropertyTarget"
      :anchor="manualPropertyAnchor"
      :busy="!canManualSelect"
      @submit="submitManualVisualOperation"
      @delete-selected="deleteManualSelectedTarget"
    />
  </div>
</template>

<script setup lang="ts">
import { collectEditingPreviewGeometries } from '../../features/editingPreview';
import { ref, shallowRef, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
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
import {
  collectManualEditableTargets,
  collectManualTranslationPreviews,
  collectManualVisualPreviews,
  mergeManualTranslationPreviews,
  projectManualEditableTargetSelection,
  resolveManualEditingCursor,
  manualEditPresentationTrace,
  ManualResizeHandles,
  canResizeManualTarget,
  shouldHandleManualDeleteShortcut,
  useManualEditSubmission,
  useSlidesManualEditingStore,
  useManualEditingLocalization,
} from '../../features/manualEditing';
import { useSlideEditingInteraction } from '../../features/editingInteraction';
import { InlineTextEditor, TextDraftPreview, type InlineTextSelection } from '../../features/textEditing';
import {
  ElementPropertyToolbar,
  useElementPropertyAnchor,
  hasElementPropertyControls,
  projectElementPropertyTarget,
} from '../../features/elementProperties';
import type { ManualEditingVisualPreview } from '../../features/manualEditing';

const props = defineProps<{
  sourceEditBusy?: boolean;
}>();

const emit = defineEmits<{
  sourceEditSubmit: [payload: SourceSelectionEditSubmitPayload];
}>();

const slidesStore = useSlidesStore();
const uiStore = useSlidesUiStore();
const renderStore = useSlidesRenderStore();
const manualEditingStore = useSlidesManualEditingStore();
const { manualEditingMessage } = useManualEditingLocalization();
const { slidesPreviewMessage } = useSlidesPreviewLocalization();
const {
  zoomLevel,
  zoomMode,
  fitZoomLevel,
  isFitZoom,
  sourceSelectionModeEnabled,
} = storeToRefs(uiStore);
const { currentSlideRender, renderModel } = storeToRefs(renderStore);
const {
  enabled: manualEditingEnabled,
} = storeToRefs(manualEditingStore);
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
const stageOverlayGeometryRevision = ref(0);

/** 首次 viewport 测量完成后置 true，在此之前隐藏内容防止 fitScale=1 的首帧闪烁 */
const viewportMeasured = ref(false);
let pendingZoomAnchor: { x: number; y: number } | null = null;
let zoomCommitRafId: number | null = null;
let latestZoomCommitId = 0;
let stageOverlayGeometryRafId: number | null = null;
let stageOverlayScrollViewport: HTMLElement | null = null;

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
  && !manualEditingEnabled.value
  && !preparingSlideVisuals.value
  && displayedSlideId.value === activeSlideId.value
));

const canManualSelect = computed(() => (
  manualEditingEnabled.value
  && renderModel.value?.sourceKind === 'generated'
  && displayedSlide.value !== null
  && displayedSlideId.value === activeSlideId.value
  && collectManualEditableTargets(displayedSlide.value.elements).length > 0
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

const manualResizePreview = shallowRef<ManualEditingVisualPreview | null>(null);
const {
  selectedTarget: manualSelectedTarget,
  translationPreview: manualTranslationPreview,
  pendingTranslation: manualPendingTranslation,
  pendingVisual: manualPendingVisual,
  queuedIntents: manualQueuedIntents,
  hoveredTarget: manualHoveredTarget,
  textEditorTarget,
  textDraft,
  textSessionId,
  textPresentations,
  hiddenTextElementIds,
  handlePointerDown: handleManualPointerDown,
  handlePointerMove: handleManualPointerMove,
  handlePointerUp: handleManualPointerUp,
  handlePointerCancel: handleManualPointerCancel,
  handlePointerLeave: handleManualPointerLeave,
  handleDoubleClick: handleManualDoubleClick,
  submitVisualOperation: submitManualVisualOperation,
  submitTextEdit,
  handleTextCompositionStart,
  handleTextCompositionEnd,
  handleTextEditorEscape,
  handleTextEditorSubmitShortcut,
  deleteSelectedTarget: deleteManualSelectedTarget,
  reconcileSelection: reconcileManualSelection,
  resetInteraction: resetManualInteraction,
} = useSlideEditingInteraction({
  canSelect: canManualSelect,
  currentSlide: displayedSlide,
  renderScale,
  slideSize: actualSlideSize,
  wrapperRef: konvaWrapperRef,
  visualPreview: manualResizePreview,
  submitIntent: useManualEditSubmission().enqueue,
  focusCanvas: () => scrollHostRef.value?.focus({ preventScroll: true }),
});

const inlineTextEditor = ref<InstanceType<typeof InlineTextEditor> | null>(null);
const textToolbarHost = ref<HTMLElement | null>(null);
const inlineTextSelection = shallowRef<InlineTextSelection | null>(null);
const inlineTextAnchor = computed(() => {
  const selection = inlineTextSelection.value;
  const host = scrollHostRef.value;
  if (!selection || !host) return null;
  const bounds = host.getBoundingClientRect();
  return { selection: { ...selection.rect, left: selection.rect.left - bounds.left, top: selection.rect.top - bounds.top },
    viewport: { width: bounds.width, height: bounds.height } };
});

const manualTranslationPreviews = computed(() => collectManualTranslationPreviews(
  manualTranslationPreview.value,
  manualPendingTranslation.value,
  manualQueuedIntents.value,
));
const manualPreviewTranslations = computed(() => {
  return mergeManualTranslationPreviews(manualTranslationPreviews.value);
});
const manualVisualPreviews = computed(() => collectManualVisualPreviews(
  manualPendingVisual.value,
  manualQueuedIntents.value,
  manualResizePreview.value,
));
const manualPresentedSelectedTarget = computed(() => {
  const target = manualSelectedTarget.value;
  return target
    ? projectManualEditableTargetSelection(
        target,
        manualPreviewTranslations.value,
        collectEditingPreviewGeometries(displayedSlide.value?.elements ?? [], manualVisualPreviews.value),
      )
    : null;
});
const showElementPropertyControls = computed(() => (
  manualSelectedTarget.value
    ? hasElementPropertyControls(manualSelectedTarget.value)
    : false
));
const manualPropertyTarget = computed(() => manualSelectedTarget.value
  ? projectElementPropertyTarget(manualSelectedTarget.value, manualVisualPreviews.value,
      textPresentations.value.find(draft => draft.target.elementId === manualSelectedTarget.value?.elementId)?.content)
  : null);

const manualPropertyAnchor = useElementPropertyAnchor({
  target: manualPresentedSelectedTarget,
  slideElement: canvasShellRef,
  viewportElement: scrollHostRef,
  renderScale,
  geometryRevision: stageOverlayGeometryRevision,
});

function handleStagePointerDown(event: PointerEvent): void {
  if (manualEditingEnabled.value) handleManualPointerDown(event);
  else handleSourcePointerDown(event);
  if (!textEditorTarget.value) scrollHostRef.value?.focus({ preventScroll: true });
}

function handleStagePointerMove(event: PointerEvent): void {
  if (manualEditingEnabled.value) handleManualPointerMove(event);
  else handleSourcePointerMove(event);
}

function handleStagePointerUp(event: PointerEvent): void {
  if (manualEditingEnabled.value) handleManualPointerUp(event);
  else handleSourcePointerUp(event);
}

function handleStagePointerCancel(event: PointerEvent): void {
  if (manualEditingEnabled.value) handleManualPointerCancel(event);
  else handleSourcePointerCancel(event);
}

function handleStagePointerLeave(): void {
  if (manualEditingEnabled.value) handleManualPointerLeave();
  else handleSourcePointerLeave();
}

function handleStageDoubleClick(event: MouseEvent): void {
  if (manualEditingEnabled.value) handleManualDoubleClick(event);
}

const sourcePromptPosition = computed(() => {
  stageOverlayGeometryRevision.value;
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
  const sourceSelectionCursor = manualEditingEnabled.value
    ? resolveManualEditingCursor(canManualSelect.value ? manualHoveredTarget.value : null)
    : hoveredSourceTarget.value ? 'pointer' : KONVA_WRAPPER_CURSOR;

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

/** 上下方向键切换幻灯片（需先点击舞台使其获得焦点） */
function handleKeydown(e: globalThis.KeyboardEvent) {
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
  if (
    manualEditingEnabled.value
    && shouldHandleManualDeleteShortcut(e)
    && deleteManualSelectedTarget()
  ) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
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
    resetManualInteraction();
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
  () => [
    displayedSlide.value,
    currentSlideRender.value,
    renderModel.value?.presentationId,
    renderModel.value?.version,
  ] as const,
  ([displayed, target, presentationId, version]) => {
    // RenderModel 到达后仍需等待当前页图片/图表形成完整帧；同一对象引用表示该帧已提交。
    if (!displayed || displayed !== target) return;
    if (version !== undefined) {
      manualEditingStore.recordPresentedRevision(version);
      if (presentationId) {
        // watcher 表示完整资源帧已提交；再跨一个 rAF 才是浏览器可绘制边界。
        window.requestAnimationFrame(() => {
          manualEditPresentationTrace.recordPresented(presentationId, version);
        });
      }
    }
    reconcileSourceSelection();
    reconcileManualSelection();
  },
);

watch(manualEditingEnabled, enabled => {
  if (!enabled) resetManualInteraction();
});

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
