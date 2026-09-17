import { computed, shallowRef } from 'vue';
import { storeToRefs } from 'pinia';
import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import {
  resolveSlidePointerPoint,
  type SourceSelectionPoint,
} from '../../sourceSelection';
import {
  type ManualEditableTarget,
  type ManualEditingVisualOperation,
  createPresentedTextEditingTarget,
  findManualEditableTargetPathAtPoint,
  findManualEditableTargetPathByElementId,
  type ManualEditingHitProjection,
  useSlidesManualEditingStore,
  createManualVisualPreview,
  resolveManualClickSelection,
  createManualDeleteOperation,
} from '../../manualEditing';
import { useTextInputSession } from './useTextInputSession';
import { useSlidesEditingInteractionStore } from '../store/slidesEditingInteractionStore';
import { projectTextDraftPresentations } from '../functions/projectTextDraftPresentations';

import type { SlideEditingInteractionOptions } from '../definitions/editingInteractionTypes';

const DRAG_THRESHOLD_PX = 3;

export function useSlideEditingInteraction(options: SlideEditingInteractionOptions) {
  const store = useSlidesManualEditingStore();
  const {
    selectedTarget,
    selectionPath,
    translationPreview,
    pendingTranslation,
    pendingVisual,
    queuedIntents,
  } = storeToRefs(store);
  const hoveredTarget = shallowRef<ManualEditableTarget | null>(null);
  const interactionStore = useSlidesEditingInteractionStore();
  const textEditing = useTextInputSession({ enqueue: options.submitIntent });
  const textPresentations = computed(() => projectTextDraftPresentations(
    options.currentSlide.value?.elements ?? [], interactionStore.textDrafts,
    readHitProjection(), textEditing.target.value?.elementId,
  ));
  const hiddenTextElementIds = computed(() => new Set([
    ...textPresentations.value.map(entry => entry.target.elementId),
    ...(textEditing.target.value ? [textEditing.target.value.elementId] : []),
  ]));
  let pointerSession: {
    readonly pointerId: number;
    readonly target: ManualEditableTarget;
    readonly path: readonly ManualEditableTarget[];
    readonly clickTarget: ManualEditableTarget;
    readonly anchor: SourceSelectionPoint;
    readonly screenX: number;
    readonly screenY: number;
    readonly canTranslate: boolean;
    dragged: boolean;
  } | null = null;

  function handlePointerDown(event: PointerEvent): void {
    if (!options.canSelect.value || event.button !== 0) return;
    const point = readPoint(event);
    const slide = options.currentSlide.value;
    if (!point || !slide) return;
    const path = findManualEditableTargetPathAtPoint(slide.elements, point, readHitProjection());
    const selection = resolveManualClickSelection(
      path,
      selectionPath.value,
      selectedTarget.value?.elementId,
    );
    hoveredTarget.value = selection.target;
    // 点击切换立即生效；输入结束与保存/编译完成不再互相等待。
    // IME 先让浏览器自然 blur，compositionend 会完成已请求的文字交接。
    const composing = textEditing.composing.value;
    textEditing.requestCommit();
    if (composing) {
      store.selectTarget(selection.target, path);
      return;
    }
    if (!selection.target || !selection.clickTarget) {
      store.clearSelection();
      return;
    }
    event.preventDefault();
    capturePointer(event);
    store.selectTarget(selection.target, path);
    pointerSession = {
      pointerId: event.pointerId,
      target: selection.target,
      path,
      clickTarget: selection.clickTarget,
      anchor: point,
      screenX: event.clientX,
      screenY: event.clientY,
      canTranslate: options.canSelect.value
        && selection.target.capabilities.includes('translate'),
      dragged: false,
    };
  }

  function handlePointerMove(event: PointerEvent): void {
    const session = pointerSession;
    if (!session) {
      updateHoveredTarget(event);
      return;
    }
    if (session.pointerId !== event.pointerId) return;
    const point = readPoint(event);
    if (!point) return;
    event.preventDefault();
    if (!session.dragged && Math.hypot(
      event.clientX - session.screenX,
      event.clientY - session.screenY,
    ) < DRAG_THRESHOLD_PX) return;
    session.dragged = true;
    if (!session.canTranslate) return;
    store.setTranslationPreview({
      elementId: session.target.elementId,
      affectedElementIds: session.target.translationElementIds,
      dx: point.x - session.anchor.x,
      dy: point.y - session.anchor.y,
    });
  }

  function handlePointerUp(event: PointerEvent): void {
    const session = pointerSession;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    releasePointer(event);
    pointerSession = null;
    const preview = translationPreview.value;
    if (!session.dragged) {
      if (session.clickTarget.elementId !== session.target.elementId) {
        store.selectTarget(session.clickTarget, session.path);
      }
      return;
    }
    if (!session.canTranslate) {
      store.setTranslationPreview(null);
      return;
    }
    if (!preview || preview.elementId !== session.target.elementId) return;
    if (Math.abs(preview.dx) <= Number.EPSILON && Math.abs(preview.dy) <= Number.EPSILON) {
      store.setTranslationPreview(null);
      return;
    }
    const operation: SlidesManualEditOperation = {
      op: 'translate_by',
      target: session.target.authoringRef,
      targetKind: session.target.targetKind,
      delta: { dx: preview.dx, dy: preview.dy },
    };
    store.setTranslationPreview(null);
    options.submitIntent({ operation, translationPreview: preview });
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) return;
    releasePointer(event);
    pointerSession = null;
    store.setTranslationPreview(null);
    hoveredTarget.value = null;
  }

  function handlePointerLeave(): void {
    if (!pointerSession) hoveredTarget.value = null;
  }

  function handleDoubleClick(event: MouseEvent): void {
    if (!options.canSelect.value) return;
    const point = readPoint(event);
    const slide = options.currentSlide.value;
    if (!point || !slide) return;
    const path = findManualEditableTargetPathAtPoint(slide.elements, point, readHitProjection());
    const target = path[path.length - 1];
    if (!target?.textEditing) return;
    const editorTarget = createPresentedTextEditingTarget(slide.elements, target, readHitProjection());
    if (!editorTarget) return;
    event.preventDefault();
    store.selectTarget(target, path);
    textEditing.open(editorTarget, textPresentations.value.find(draft => draft.target.elementId === target.elementId));
  }

  function submitVisualOperation(operation: ManualEditingVisualOperation): boolean {
    const target = selectedTarget.value;
    if (!target || !options.canSelect.value) return false;
    const preview = createManualVisualPreview(target, operation);
    if (!preview) return false;
    options.submitIntent({ operation, visualPreview: preview });
    if (operation.op === 'delete_target') {
      hoveredTarget.value = null;
      store.clearSelection();
    }
    return true;
  }

  function deleteSelectedTarget(): boolean {
    if (textEditing.target.value) return false;
    const target = selectedTarget.value;
    if (!target) return false;
    const operation = createManualDeleteOperation(target);
    return operation ? submitVisualOperation(operation) : false;
  }

  function reconcileSelection(): void {
    const selectedId = selectedTarget.value?.elementId;
    if (!selectedId) return;
    const path = options.currentSlide.value
      ? findManualEditableTargetPathByElementId(options.currentSlide.value.elements, selectedId)
      : [];
    const next = path.find(target => target.elementId === selectedId) ?? null;
    store.reconcileSelectedTarget(next, path);
    const editingId = textEditing.target.value?.elementId;
    if (editingId && options.currentSlide.value) {
      const editingTarget = findManualEditableTargetPathByElementId(options.currentSlide.value.elements, editingId)
        .find(candidate => candidate.elementId === editingId);
      textEditing.reconcileTarget(editingTarget
        ? createPresentedTextEditingTarget(options.currentSlide.value.elements, editingTarget, readHitProjection())
        : null);
    }
    hoveredTarget.value = null;
  }

  function resetInteraction(): void {
    pointerSession = null;
    hoveredTarget.value = null;
    store.clearSelection();
    textEditing.requestCommit();
  }

  function readHitProjection(): ManualEditingHitProjection {
    return {
      transientTranslation: translationPreview.value,
      pendingTranslation: pendingTranslation.value,
      pendingVisual: pendingVisual.value,
      transientVisual: options.visualPreview?.value,
      queuedIntents: queuedIntents.value,
    };
  }

  function updateHoveredTarget(event: Pick<PointerEvent, 'clientX' | 'clientY'>): void {
    const point = readPoint(event);
    const slide = options.currentSlide.value;
    if (!options.canSelect.value || !point || !slide) {
      hoveredTarget.value = null;
      return;
    }
    const path = findManualEditableTargetPathAtPoint(slide.elements, point, readHitProjection());
    hoveredTarget.value = resolveManualClickSelection(
      path,
      selectionPath.value,
      selectedTarget.value?.elementId,
    ).target;
  }

  function readPoint(event: Pick<MouseEvent, 'clientX' | 'clientY'>): SourceSelectionPoint | null {
    const wrapper = options.wrapperRef.value;
    if (!wrapper) return null;
    return resolveSlidePointerPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      wrapperRect: wrapper.getBoundingClientRect(),
      renderScale: options.renderScale.value,
      slideSize: options.slideSize.value,
    });
  }

  return {
    selectedTarget,
    selectionPath,
    translationPreview,
    pendingTranslation,
    pendingVisual,
    queuedIntents,
    hoveredTarget,
    textEditorTarget: textEditing.target,
    textDraft: textEditing.draft,
    textSessionId: textEditing.sessionId,
    textPresentations,
    hiddenTextElementIds,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleDoubleClick,
    submitVisualOperation,
    deleteSelectedTarget,
    submitTextEdit: textEditing.requestCommit,
    closeTextEditor: textEditing.cancel,
    handleTextCompositionStart: textEditing.beginComposition,
    handleTextCompositionEnd: textEditing.endComposition,
    handleTextEditorEscape: (event: KeyboardEvent) => {
      textEditing.handleEscape(event);
      if (!textEditing.target.value) options.focusCanvas?.();
    },
    handleTextEditorSubmitShortcut: (event: KeyboardEvent) => {
      textEditing.handleCommitShortcut(event);
      if (!textEditing.target.value) options.focusCanvas?.();
    },
    reconcileSelection,
    resetInteraction,
  };
}

function capturePointer(event: PointerEvent): void {
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  target?.setPointerCapture(event.pointerId);
}

function releasePointer(event: PointerEvent): void {
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
}
