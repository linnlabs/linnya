<template>
  <div
    ref="scrollHostRef"
    class="slide-stage slide-stage-scroll-host"
    :class="{ 'stage-viewport-measured': viewportMeasured }"
    tabindex="0"
    data-overlay-scroll-theme="linnya"
    @keydown="handleKeydown"
    @keyup="handleManualKeyup"
    @focusout="finishKeyboardGesture"
    @pointermove="handleStagePointerMove"
    @pointerup="handleStagePointerUp"
    @pointercancel="handleStagePointerCancel"
  >
    <div
      ref="scrollViewportMountRef"
      class="slide-stage-scroll-viewport"
      data-overlayscrollbars-initialize
      @wheel="handleWheel"
      @pointerdown.self="handleStageBlankPointerDown"
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
        @pointerdown.self="handleStageBlankPointerDown"
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
              :marquee-rect="manualEditingEnabled ? manualMarqueeRect : sourceMarqueeRect"
              :preview-translations="manualPreviewTranslations"
              :manual-selected-targets="manualPresentedSelectedTargets"
              :snap-guides="manualSnapGuides"
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
import { ref, shallowRef, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useSlidesUiStore } from '../../store/slidesUiStore';
import { useSlideStageViewport } from '../../features/stageZoom';
import { useSlidesStore } from '../../store/slidesStore';
import { useSlidesRenderStore } from '../../store/slidesRenderStore';
import {
  SourceSelectionPromptPopover,
  resolveSourceSelectionPromptPosition,
  type SourceSelectionEditSubmitPayload,
  useSlideSourceSelectionInteraction,
} from '../../features/sourceSelection';
import KonvaSlideStage from './konva/KonvaSlideStage.vue';
import SlidesStatusState from '../shared/SlidesStatusState.vue';
import {
  resolveSlideStageRenderState,
  useSlidesPreviewLocalization,
} from '../../features/previewRenderState';
import { isKonvaNodeSupported } from '../../features/konvaPreview';
import { useReadySlideVisualResources } from '../../features/renderVisualResources';
import {
  collectManualTranslationPreviews,
  collectManualVisualPreviews,
  mergeManualTranslationPreviews,
  projectManualEditableTargetSelection,
  resolveManualEditingCursor,
  manualEditPresentationTrace,
  ManualResizeHandles,
  canResizeManualTarget,
  useManualEditSubmission,
  useSlidesManualEditingStore,
  useManualEditingLocalization,
} from '../../features/manualEditing';
import { ownsCanvasKeyboard, useSlideEditingInteraction } from '../../features/editingInteraction';
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
const {
  scrollHostRef, scrollViewportMountRef, viewportMeasured, stageOverlayGeometryRevision,
  actualSlideSize, logicalSlideSize, currentLayout, scrollContentStyle, canvasShellStyle,
  renderScale, konvaRasterScale, handleWheel,
} = useSlideStageViewport({
  slideSize: renderSlideSize, activeSlideId, displayedSlideId,
  hasRenderableSlide: computed(() => renderState.value.hasRenderableSlide),
  shouldUseKonva: computed(() => renderState.value.shouldUseKonva),
});
const canvasShellRef = ref<globalThis.HTMLElement | null>(null);
const konvaWrapperRef = ref<globalThis.HTMLElement | null>(null);
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
));

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
  selectedTargets: manualSelectedTargets,
  marqueeRect: manualMarqueeRect,
  snapGuides: manualSnapGuides,
  translationPreview: manualTranslationPreview,
  pendingTranslations: manualPendingTranslations,
  pendingVisuals: manualPendingVisuals,
  queuedIntents: manualQueuedIntents,
  hoveredTarget: manualHoveredTarget,
  textEditorTarget,
  textDraft,
  textSessionId,
  textPresentations,
  hiddenTextElementIds,
  handleKeydown: handleManualKeydown,
  handleKeyup: handleManualKeyup,
  finishKeyboardGesture,
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
  manualPendingTranslations.value,
  manualQueuedIntents.value,
));
const manualPreviewTranslations = computed(() => {
  return mergeManualTranslationPreviews(manualTranslationPreviews.value);
});
const manualVisualPreviews = computed(() => collectManualVisualPreviews(
  manualPendingVisuals.value,
  manualQueuedIntents.value,
  manualResizePreview.value,
));
const manualPresentedSelectedTargets = computed(() => {
  const geometries = collectEditingPreviewGeometries(displayedSlide.value?.elements ?? [], manualVisualPreviews.value);
  return manualSelectedTargets.value.map(target => projectManualEditableTargetSelection(target, manualPreviewTranslations.value, geometries));
});
const manualPresentedSelectedTarget = computed(() => manualPresentedSelectedTargets.value.length === 1
  ? manualPresentedSelectedTargets.value[0] : null);
const showElementPropertyControls = computed(() => (
  manualSelectedTargets.value.length === 1 && manualSelectedTarget.value
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

function handleStageBlankPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  // 留白与页内背景共用交接语义；只监听容器自身，避免工具条和拖拽事件误清选区。
  if (manualEditingEnabled.value) handleManualPointerDown(event, true);
  else resetSourceSelection();
  if (!textEditorTarget.value) scrollHostRef.value?.focus({ preventScroll: true });
}

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

const konvaWrapperStyle = computed(() => {
  const safeRasterScale = konvaRasterScale.value > 0 ? konvaRasterScale.value : 1;
  const wrapperScale = renderScale.value / safeRasterScale;
  const sourceSelectionCursor = manualEditingEnabled.value
    ? resolveManualEditingCursor(canManualSelect.value ? manualHoveredTarget.value : null)
    : hoveredSourceTarget.value ? 'pointer' : 'default';

  return {
    width: `${logicalSlideSize.value.width * safeRasterScale}px`,
    height: `${logicalSlideSize.value.height * safeRasterScale}px`,
    transform: Math.abs(wrapperScale - 1) <= Number.EPSILON ? 'none' : `scale(${wrapperScale})`,
    transformOrigin: 'top left',
    cursor: sourceSelectionCursor,
    touchAction: 'none',
  };
});

/** 表单/文本拥有自己的按键；有对象选区时方向键先交给编辑会话。 */
function handleKeydown(event: KeyboardEvent): void {
  if (!ownsCanvasKeyboard(event)) return;
  if (manualEditingEnabled.value && handleManualKeydown(event)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (event.key === 'ArrowUp' || event.key === 'PageUp') {
    event.preventDefault();
    slidesStore.prevSlide();
  } else if (event.key === 'ArrowDown' || event.key === 'PageDown') {
    event.preventDefault();
    slidesStore.nextSlide();
  }
}

watch(activeSlideId, () => {
  resetSourceSelection();
  resetManualInteraction();
}, { flush: 'post' });

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

</script>
