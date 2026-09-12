import { computed, ref, type Ref } from 'vue';
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
  const { selectedTarget, translationPreview } = storeToRefs(store);
  const textEditorTarget = ref<ManualEditableTarget | null>(null);
  const textDraft = ref('');
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
    const point = readPoint(event);
    const slide = options.currentSlide.value;
    if (!point || !slide) return;
    const target = findManualEditableTargetAtPoint(slide.elements, point);
    if (!target) {
      store.clearSelection();
      closeTextEditor();
      return;
    }
    event.preventDefault();
    capturePointer(event);
    store.selectTarget(target);
    closeTextEditor();
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
    store.setTranslationPreview(null);
    if (Math.abs(preview.dx) <= Number.EPSILON && Math.abs(preview.dy) <= Number.EPSILON) return;
    options.submitOperation({
      op: 'translate_by',
      target: session.target.authoringRef,
      targetKind: session.target.targetKind,
      delta: { dx: preview.dx, dy: preview.dy },
    });
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
    if (!target || target.textContent === undefined) return;
    event.preventDefault();
    store.selectTarget(target);
    textEditorTarget.value = target;
    textDraft.value = target.textContent;
  }

  function submitTextEdit(): void {
    const target = textEditorTarget.value;
    if (!target || target.textContent === undefined || textDraft.value === target.textContent) {
      closeTextEditor();
      return;
    }
    options.submitOperation({
      op: 'set_text_content',
      target: target.authoringRef,
      content: textDraft.value,
    });
    closeTextEditor();
  }

  function closeTextEditor(): void {
    textEditorTarget.value = null;
    textDraft.value = '';
  }

  function reconcileSelection(): void {
    const selectedId = selectedTarget.value?.elementId;
    if (!selectedId) return;
    const next = editableTargets.value.find(target => target.elementId === selectedId) ?? null;
    store.selectTarget(next);
    if (!next) closeTextEditor();
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
    textEditorTarget,
    textDraft,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleDoubleClick,
    submitTextEdit,
    closeTextEditor,
    reconcileSelection,
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
