import { computed, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import type { SlideRenderModel } from '../../../types/render';
import {
  resolveSlidePointerPoint,
  type SourceSelectionPoint,
} from '../../sourceSelection';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import {
  collectManualEditableTargets,
  findManualEditableTargetAtPoint,
} from '../functions/manualEditableTargets';
import { useSlidesManualEditingStore } from '../store/slidesManualEditingStore';
import { useSlideTextEditingSession } from '../../textEditing';

export interface SlideManualEditingInteractionOptions {
  readonly canEdit: Ref<boolean>;
  readonly currentSlide: Ref<SlideRenderModel | null>;
  readonly renderScale: Ref<number>;
  readonly slideSize: Ref<{ readonly width: number; readonly height: number }>;
  readonly wrapperRef: Ref<HTMLElement | null>;
  readonly submitOperation: (operation: SlidesManualEditOperation) => void;
}

const DRAG_THRESHOLD_PX = 3;

export function useSlideManualEditingInteraction(options: SlideManualEditingInteractionOptions) {
  const store = useSlidesManualEditingStore();
  const {
    selectedTarget,
    translationPreview,
    pendingTranslation,
    submitting,
  } = storeToRefs(store);
  const textEditing = useSlideTextEditingSession({
    submitting,
    submitOperation: operation => {
      store.beginSubmit(operation);
      options.submitOperation(operation);
    },
  });
  let pointerSession: {
    readonly pointerId: number;
    readonly target: ManualEditableTarget;
    readonly anchor: SourceSelectionPoint;
    readonly screenX: number;
    readonly screenY: number;
    dragged: boolean;
  } | null = null;

  const editableTargets = computed(() => options.currentSlide.value
    ? collectManualEditableTargets(options.currentSlide.value.elements)
    : []);

  function handlePointerDown(event: PointerEvent): void {
    if (!options.canEdit.value || event.button !== 0) return;
    if (textEditing.target.value) {
      const result = textEditing.requestCommit();
      if (result !== 'closed') {
        event.preventDefault();
        return;
      }
    }
    const point = readPoint(event);
    const slide = options.currentSlide.value;
    if (!point || !slide) return;
    const target = findManualEditableTargetAtPoint(slide.elements, point);
    if (!target) {
      store.clearSelection();
      return;
    }
    event.preventDefault();
    capturePointer(event);
    store.selectTarget(target);
    pointerSession = {
      pointerId: event.pointerId,
      target,
      anchor: point,
      screenX: event.clientX,
      screenY: event.clientY,
      dragged: false,
    };
  }

  function handlePointerMove(event: PointerEvent): void {
    const session = pointerSession;
    if (!session || session.pointerId !== event.pointerId) return;
    const point = readPoint(event);
    if (!point) return;
    event.preventDefault();
    if (!session.dragged && Math.hypot(
      event.clientX - session.screenX,
      event.clientY - session.screenY,
    ) < DRAG_THRESHOLD_PX) return;
    session.dragged = true;
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
    if (!session.dragged || !preview || preview.elementId !== session.target.elementId) return;
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
    store.beginSubmit(operation, preview);
    options.submitOperation(operation);
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) return;
    releasePointer(event);
    pointerSession = null;
    store.setTranslationPreview(null);
  }

  function handleDoubleClick(event: MouseEvent): void {
    if (!options.canEdit.value) return;
    const point = readPoint(event);
    const slide = options.currentSlide.value;
    if (!point || !slide) return;
    const target = findManualEditableTargetAtPoint(slide.elements, point);
    if (!target?.textEditing) return;
    event.preventDefault();
    store.selectTarget(target);
    textEditing.open(target.textEditing);
  }

  function reconcileSelection(): void {
    const selectedId = selectedTarget.value?.elementId;
    if (!selectedId) return;
    const next = editableTargets.value.find(target => target.elementId === selectedId) ?? null;
    store.reconcileSelectedTarget(next);
    textEditing.reconcileTarget(next?.textEditing ?? null);
  }

  function resetInteraction(): void {
    pointerSession = null;
    store.clearSelection();
    textEditing.reset();
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
    translationPreview,
    pendingTranslation,
    textEditorTarget: textEditing.target,
    textDraft: textEditing.draft,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleDoubleClick,
    submitTextEdit: textEditing.requestCommit,
    closeTextEditor: textEditing.cancel,
    handleTextCompositionStart: textEditing.beginComposition,
    handleTextCompositionEnd: textEditing.endComposition,
    handleTextEditorEscape: textEditing.handleEscape,
    handleTextEditorSubmitShortcut: textEditing.handleCommitShortcut,
    completeTextEditing: textEditing.complete,
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
