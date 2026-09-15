import { shallowRef, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import type { SlideRenderModel } from '../../../types/render';
import {
  resolveSlidePointerPoint,
  type SourceSelectionPoint,
} from '../../sourceSelection';
import type {
  ManualEditIntent,
  ManualEditableTarget,
  ManualEditingVisualOperation,
} from '../definitions/manualEditingTypes';
import {
  findManualEditableTargetPathAtPoint,
  findManualEditableTargetPathByElementId,
  type ManualEditingHitProjection,
} from '../functions/manualEditableTargets';
import { useSlidesManualEditingStore } from '../store/slidesManualEditingStore';
import { useSlideTextEditingSession } from '../../textEditing';
import { createManualVisualPreview } from '../functions/manualVisualPreview';
import { resolveManualClickSelection } from '../functions/resolveManualClickSelection';
import { createManualDeleteOperation } from '../functions/createManualDeleteOperation';

export interface SlideManualEditingInteractionOptions {
  /** 当前正式画面是否仍可命中。提交中的旧画面也应允许用户表达下一次选择。 */
  readonly canSelect: Ref<boolean>;
  readonly currentSlide: Ref<SlideRenderModel | null>;
  readonly renderScale: Ref<number>;
  readonly slideSize: Ref<{ readonly width: number; readonly height: number }>;
  readonly wrapperRef: Ref<HTMLElement | null>;
  readonly submitIntent: (intent: ManualEditIntent) => void;
}

const DRAG_THRESHOLD_PX = 3;

interface DeferredManualSelection {
  readonly elementId: string | null;
}

export function useSlideManualEditingInteraction(options: SlideManualEditingInteractionOptions) {
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
  const textEditing = useSlideTextEditingSession({
    submitOperation: operation => {
      options.submitIntent({ operation });
    },
  });
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
  let deferredSelection: DeferredManualSelection | null = null;

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
    if (textEditing.target.value) {
      if (textEditing.submissionPending.value) {
        deferSelection(selection.target?.elementId ?? null);
        event.preventDefault();
        return;
      }
      const result = textEditing.requestCommit();
      if (result === 'submitted') {
        deferSelection(selection.target?.elementId ?? null);
        event.preventDefault();
        return;
      }
      if (result === 'blocked') {
        event.preventDefault();
        return;
      }
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
    event.preventDefault();
    store.selectTarget(target, path);
    textEditing.open(target.textEditing);
  }

  function selectHierarchyTarget(target: ManualEditableTarget): void {
    if (!selectionPath.value.some(candidate => candidate.elementId === target.elementId)) return;
    store.selectTarget(target, selectionPath.value);
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
    textEditing.reconcileTarget(next?.textEditing ?? null);
    hoveredTarget.value = null;
  }

  function resetInteraction(): void {
    pointerSession = null;
    deferredSelection = null;
    hoveredTarget.value = null;
    store.clearSelection();
    textEditing.reset();
  }

  function readHitProjection(): ManualEditingHitProjection {
    return {
      transientTranslation: translationPreview.value,
      pendingTranslation: pendingTranslation.value,
      pendingVisual: pendingVisual.value,
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

  function completeTextEditing(): void {
    textEditing.complete();
    applyDeferredSelection();
  }

  function rejectDeferredSelection(): void {
    deferredSelection = null;
  }

  function deferSelection(elementId: string | null): void {
    deferredSelection = { elementId };
  }

  function applyDeferredSelection(): void {
    if (!deferredSelection) return;
    const { elementId } = deferredSelection;
    deferredSelection = null;
    if (elementId === null) {
      store.clearSelection();
      return;
    }
    const slide = options.currentSlide.value;
    const path = slide
      ? findManualEditableTargetPathByElementId(slide.elements, elementId)
      : [];
    const target = path.find(candidate => candidate.elementId === elementId) ?? null;
    store.selectTarget(target, path);
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
    textEditorSubmissionPending: textEditing.submissionPending,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleDoubleClick,
    selectHierarchyTarget,
    submitVisualOperation,
    deleteSelectedTarget,
    submitTextEdit: textEditing.requestCommit,
    closeTextEditor: textEditing.cancel,
    handleTextCompositionStart: textEditing.beginComposition,
    handleTextCompositionEnd: textEditing.endComposition,
    handleTextEditorEscape: textEditing.handleEscape,
    handleTextEditorSubmitShortcut: textEditing.handleCommitShortcut,
    completeTextEditing,
    rejectDeferredSelection,
    rejectTextEditingSubmission: textEditing.rejectSubmission,
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
