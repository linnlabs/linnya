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
              :hovered-target="manualHoveredTarget ? null : hoveredSourceTarget"
              :manual-hovered-target="canManualSelect && !manualTranslationPreview ? manualHoveredTarget : null"
              :marquee-rect="manualMarqueeRect ?? sourceMarqueeRect"
              :preview-translations="manualPreviewTranslations"
              :manual-selected-targets="manualPresentedSelectedTargets"
              :snap-guides="manualSnapGuides"
              :pending-insertions="manualPendingInsertions"
              :manual-visual-previews="manualVisualPreviews"
              :hidden-text-element-ids="hiddenTextElementIds"
            />
          </div>
          <SourceSelectionPromptPopover
            v-if="showAiPrompt"
            :targets="aiTargets"
            :position="sourcePromptPosition"
            :disabled="sourceEditBusy"
            @submit="handleSourceEditSubmit"
            @cancel="closeAiPrompt"
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
          :select-all="textSelectAll"
          :toolbar-elements="[textToolbarHost, textPropertyToolbar?.menuElement ?? null]"
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
          v-if="manualPresentedSelectedTarget && canManualMutate && !textEditorTarget && canResizeManualTarget(manualPresentedSelectedTarget)"
          :key="manualPresentedSelectedTarget.elementId"
          :target="manualPresentedSelectedTarget"
          :slide-left="currentLayout.slideLeft"
          :slide-top="currentLayout.slideTop"
          :render-scale="renderScale"
          @preview="manualResizePreview = $event"
          @submit="submitManualVisualOperation"
          @finish="scrollHostRef?.focus({ preventScroll: true })"
        />
        <ManualTextWidthHandles
          v-if="manualPresentedSelectedTarget && canManualMutate && !textEditorTarget && canResizeTextWidth(manualPresentedSelectedTarget)"
          :key="`width:${manualPresentedSelectedTarget.elementId}`"
          :target="manualPresentedSelectedTarget"
          :slide-left="currentLayout.slideLeft"
          :slide-top="currentLayout.slideTop"
          :render-scale="renderScale"
          @preview="manualResizePreview = $event"
          @dragging="textWidthDragging = $event"
          @submit="manualSubmission.enqueue"
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
        ref="textPropertyToolbar"
        :key="textSessionId ?? undefined"
        :target="manualSelectedTarget"
        :anchor="inlineTextAnchor"
        :text-selection="inlineTextSelection.style"
        @text-style="inlineTextEditor?.applyStyle($event)"
      />
    </div>
    <ElementPropertyToolbar
      v-if="manualToolbarTarget && manualPropertyAnchor && showObjectToolbar"
      :key="manualToolbarKey"
      :target="manualToolbarTarget"
      :anchor="manualPropertyAnchor"
      :busy="!canManualMutate"
      :readonly="!canManualMutate"
      :ai="canAskAi"
      :selection-count="manualSelectedTargets.length"
      :arrangeable="manualSelectedTargets.every(target => target.capabilities.includes('translate'))"
      :layer="manualLayerAvailability"
      :can-copy="canCopySelection"
      @submit="submitManualVisualOperation"
      @delete-selected="deleteManualSelectedTarget"
      @ai="openAiPrompt"
      @arrange="arrangeSelection"
      @layer="setSelectionLayer"
      @copy="copySelection"
      @duplicate="duplicateSelection"
    >
      <template #object>
        <ImageEditingControls />
      </template>
    </ElementPropertyToolbar>
  </div>
</template>

<script setup lang="ts">
import { useStagePointerRouting } from '../../page/orchestration/useStagePointerRouting';
import { useStageAiPrompt } from '../../page/orchestration/useStageAiPrompt';
import { useStageToolbarVisibility } from '../../page/orchestration/useStageToolbarVisibility';
import { useSlidesManualSelectionStore } from '../../features/manualEditing/selection';
import { collectEditingPreviewGeometries, useSlideEditingPreview } from '../../features/editingPreview';
import { ref, shallowRef, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useSlideStageViewport } from '../../features/stageZoom';
import { useSlidesStore, useSlidesDocumentRuntime, usePresentedFrame } from '../../features/documentRuntime';
import { useSlidesRenderStore } from '../../store/slidesRenderStore';
import {
  SourceSelectionPromptPopover,
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
import { collectManualTranslationPreviews, collectManualVisualPreviews, mergeManualTranslationPreviews, projectManualEditableTargetSelection } from '../../features/manualEditing/preview';
import { resolveManualEditingCursor, canResizeManualTarget, canResizeTextWidth, useManualEditingEnabled } from '../../features/manualEditing/selection';
import { ManualResizeHandles, ManualTextWidthHandles, useManualEditingLocalization } from '../../features/manualEditing/ui';
import { useManualEditSubmission, useSlidesManualSubmissionStore } from '../../features/manualEditing/submission';
import { ownsCanvasKeyboard, useSlideEditingInteraction } from '../../features/editingInteraction';
import { InlineTextEditor, TextDraftPreview, type InlineTextSelection } from '../../features/textEditing';
import {
  ElementPropertyToolbar,
  useElementPropertyAnchor,
  hasElementPropertyControls,
  projectElementPropertyTarget,
} from '../../features/elementProperties';
import type { ManualEditingVisualPreview } from '../../features/manualEditing/preview';
import { manualSelectionBounds } from '../../features/manualEditing/selection';
import { resolveLayerAvailability, useEditingCommands } from '../../features/editingCommands';
import { useElementClipboard } from '../../features/elementClipboard';
import { ImageEditingControls } from '../../features/imageEditing';
import { unpresentedInsertions } from '../../features/editingPreview';

const props = defineProps<{
  sourceEditBusy?: boolean;
}>();

const emit = defineEmits<{
  sourceEditSubmit: [payload: SourceSelectionEditSubmitPayload];
}>();

const slidesStore = useSlidesStore();
const renderStore = useSlidesRenderStore();
const manualEditingStore = useSlidesManualSubmissionStore();
const manualEditingEnabled = useManualEditingEnabled();
  const manualEditingStoreSelection = useSlidesManualSelectionStore();
const { manualEditingMessage } = useManualEditingLocalization();
const { slidesPreviewMessage } = useSlidesPreviewLocalization();
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
const manualPendingInsertions = computed(() => manualEditingEnabled.value && displayedSlide.value
  && displayedSlide.value.index === currentSlideRender.value?.index
  ? unpresentedInsertions(manualEditingStore.pendingInsertions.filter(entry => entry.slideIndex === displayedSlide.value?.index), displayedSlide.value) : []);


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
  && !preparingSlideVisuals.value
  && displayedSlideId.value === activeSlideId.value
));

// 不再有编辑模式：生成文稿的当前画面始终可选；能否手动写入由文稿状态决定。
const canManualSelect = computed(() => (
  renderModel.value?.sourceKind === 'generated'
  && displayedSlide.value !== null
  && displayedSlideId.value === activeSlideId.value
));
const canManualMutate = computed(() => manualEditingEnabled.value && canManualSelect.value);

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
  hasSourceTargetAt,
} = useSlideSourceSelectionInteraction({
  canSelectSourceElements,
  currentSlideRender: displayedSlide,
  renderScale,
  actualSlideSize,
  wrapperRef: konvaWrapperRef,
});

const manualResizePreview = shallowRef<ManualEditingVisualPreview | null>(null);
const projectEditingPreview = useSlideEditingPreview(displayedSlide);
const textWidthDragging = ref(false);
const manualSubmission = useManualEditSubmission();
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
  textSelectAll,
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
  hasTargetAt: hasManualTargetAt,
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
  canMutate: canManualMutate,
  currentSlide: displayedSlide,
  renderScale,
  slideSize: actualSlideSize,
  wrapperRef: konvaWrapperRef,
  visualPreview: manualResizePreview,
  projectPreview: projectEditingPreview,
  submitIntent: manualSubmission.enqueue,
  focusCanvas: () => scrollHostRef.value?.focus({ preventScroll: true }),
});

const inlineTextEditor = ref<InstanceType<typeof InlineTextEditor> | null>(null);
const textToolbarHost = ref<HTMLElement | null>(null);
const textPropertyToolbar = ref<InstanceType<typeof ElementPropertyToolbar> | null>(null);
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
  const geometries = collectEditingPreviewGeometries(displayedSlide.value?.elements ?? [], manualVisualPreviews.value, projectEditingPreview);
  return manualSelectedTargets.value.map(target => projectManualEditableTargetSelection(target, manualPreviewTranslations.value, geometries));
});
const manualPresentedSelectedTarget = computed(() => manualPresentedSelectedTargets.value.length === 1
  ? manualPresentedSelectedTargets.value[0] : null);
const showElementPropertyControls = computed(() => manualSelectedTargets.value.length > 1
  || (manualSelectedTarget.value !== null && (hasElementPropertyControls(manualSelectedTarget.value) || canAskAi.value)));
const manualPropertyTarget = computed(() => manualSelectedTarget.value
  ? projectElementPropertyTarget(manualSelectedTarget.value, manualVisualPreviews.value,
      textPresentations.value.find(draft => draft.target.elementId === manualSelectedTarget.value?.elementId)?.content)
  : null);

/** 多选时浮条跟随选区外框；能力取所有成员的交集，删除等动作只在全部可用时出现。 */
const manualAnchorTarget = computed(() => {
  const targets = manualPresentedSelectedTargets.value;
  const first = targets[0];
  if (targets.length <= 1 || !first) return manualPresentedSelectedTarget.value;
  const bounds = manualSelectionBounds(targets);
  return bounds ? { ...first, bounds,
    capabilities: first.capabilities.filter(capability => targets.every(target => target.capabilities.includes(capability))) } : null;
});
const manualToolbarTarget = computed(() => manualSelectedTargets.value.length > 1 ? manualAnchorTarget.value : manualPropertyTarget.value);
const manualToolbarKey = computed(() => manualSelectedTargets.value.length > 1
  ? `selection:${manualSelectedTargets.value.map(target => target.elementId).join('|')}`
  : `${manualPropertyTarget.value?.authoringRef.slideKey}/${manualPropertyTarget.value?.authoringRef.editKey}`);
const manualLayerAvailability = computed(() => manualSelectedTargets.value.length === 1 && manualSelectedTarget.value
  ? resolveLayerAvailability(displayedSlide.value?.elements ?? [], manualSelectedTarget.value) : null);
const { arrange: arrangeSelection, setLayer: setSelectionLayer } = useEditingCommands();
const { canCopy: canCopySelection, copy: copyElementSelection, duplicate: duplicateElementSelection } = useElementClipboard();
function copySelection(): void { void copyElementSelection(); }
function duplicateSelection(): void { void duplicateElementSelection(); }

const manualPropertyAnchor = useElementPropertyAnchor({
  target: manualAnchorTarget,
  // 文稿可编辑时舞台顶部常驻命令条（top 12px + 36px 高），浮条翻到对象下方避让。
  reservedTop: computed(() => manualEditingEnabled.value ? 56 : 0),
  slideElement: canvasShellRef,
  viewportElement: scrollHostRef,
  renderScale,
  geometryRevision: stageOverlayGeometryRevision,
});

const { handleStageBlankPointerDown, handleStagePointerDown, handleStagePointerMove, handleStagePointerUp, handleStagePointerCancel, handleStagePointerLeave, handleStageDoubleClick } = useStagePointerRouting({
  hasManualTargetAt, hasSourceTargetAt, handleManualPointerDown, handleSourcePointerDown, handleManualPointerMove, handleSourcePointerMove, handleManualPointerUp, handleSourcePointerUp, handleManualPointerCancel, handleSourcePointerCancel, handleManualPointerLeave, handleSourcePointerLeave, handleManualDoubleClick,
  clearManualSelection: manualEditingStoreSelection.clearSelection,
  clearSourceSelection: resetSourceSelection,
  focusCanvas: () => { if (!textEditorTarget.value) scrollHostRef.value?.focus({ preventScroll: true }); },
});

const { aiTargets, canAskAi, showAiPrompt, openAiPrompt, closeAiPrompt, sourcePromptPosition, handleSourceEditSubmit } = useStageAiPrompt({
  manualSelectedTargets, displayedSlide, selectedSourceTargets, canSelectSourceElements, stageOverlayGeometryRevision, canvasShellRef, renderScale, actualSlideSize, preparingSlideVisuals, activeSlideId,
  finishText: submitTextEdit,
  clearSourceSelection: resetSourceSelection,
  focusCanvas: () => scrollHostRef.value?.focus({ preventScroll: true }),
  submit: payload => emit('sourceEditSubmit', payload),
});

const showObjectToolbar = useStageToolbarVisibility(() => ({
  hasControls: showElementPropertyControls.value, aiPromptOpen: showAiPrompt.value,
  editingText: textEditorTarget.value !== null, translating: manualTranslationPreview.value !== null,
  resizing: manualResizePreview.value !== null, resizingText: textWidthDragging.value,
}));

const konvaWrapperStyle = computed(() => {
  const safeRasterScale = konvaRasterScale.value > 0 ? konvaRasterScale.value : 1;
  const wrapperScale = renderScale.value / safeRasterScale;
  const sourceSelectionCursor = manualHoveredTarget.value
    ? canManualMutate.value ? resolveManualEditingCursor(manualHoveredTarget.value) : 'pointer'
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
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k' && canAskAi.value) {
    event.preventDefault();
    event.stopPropagation();
    openAiPrompt();
    return;
  }
  if (event.key === 'Escape' && showAiPrompt.value) {
    event.preventDefault();
    closeAiPrompt();
    return;
  }
  if (handleManualKeydown(event)) {
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
  ([displayed, target]) => {
    // RenderModel 到达后仍需等待当前页图片/图表形成完整帧；同一对象引用表示该帧已提交。
    if (!displayed || displayed !== target) return;
    reconcileSourceSelection();
    reconcileManualSelection();
  },
);

usePresentedFrame(computed(() => {
  const model = renderModel.value;
  return model && displayedSlide.value === currentSlideRender.value
    ? { documentId: model.presentationId, revision: model.version, slide: displayedSlide.value } : null;
}));
watch(visualResourcePreparationFailed, failed => {
  const model = renderModel.value;
  if (failed && model) useSlidesDocumentRuntime().reportPresentationFailure({
    documentId: model.presentationId, revision: model.version, slide: currentSlideRender.value,
  }, slidesPreviewMessage('slides.preview.error.presentationRendering'));
});


</script>
