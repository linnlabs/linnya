import { computed, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { SlideRenderModel } from '../../../types/render';
import { INCHES_TO_PX } from '../../../shared/constants';
import type {
  SourceSelectableElement,
  SourceSelectionPoint,
} from '../definitions/sourceSelectionTypes';
import {
  collectSourceElementsInRect,
  findSourceElementAtPoint,
  findSourceElementsByIds,
} from '../functions/renderNodeSourceSelection';
import {
  rectFromPoints,
} from '../functions/sourceSelectionGeometry';
import {
  resolveSourceElementClickSelection,
  resolveSourceMarqueeSelection,
} from '../functions/sourceSelectionState';
import { useSlidesSourceSelectionStore } from '../store/slidesSourceSelectionStore';

interface SlideSourceSelectionSize {
  width: number;
  height: number;
}

export interface SlideSourceSelectionInteractionOptions {
  canSelectSourceElements: Ref<boolean>;
  currentSlideRender: Ref<SlideRenderModel | null>;
  renderScale: Ref<number>;
  actualSlideSize: Ref<SlideSourceSelectionSize>;
  wrapperRef: Ref<globalThis.HTMLElement | null>;
}

const MARQUEE_START_THRESHOLD_PX = 4;

export function useSlideSourceSelectionInteraction(options: SlideSourceSelectionInteractionOptions) {
  const sourceSelectionStore = useSlidesSourceSelectionStore();
  const { selectedElementIds, hoveredElementId, marqueeDraft } = storeToRefs(sourceSelectionStore);
  let pointerSession: {
    pointerId: number;
    anchor: SourceSelectionPoint;
    focus: SourceSelectionPoint;
    screenAnchor: SourceSelectionPoint;
    additive: boolean;
    hasDragged: boolean;
  } | null = null;

  const selectedSourceTargets = computed(() =>
    options.currentSlideRender.value
      ? findSourceElementsByIds(options.currentSlideRender.value.elements, selectedElementIds.value)
      : [],
  );

  const hoveredSourceTarget = computed<SourceSelectableElement | null>(() => {
    if (!options.currentSlideRender.value || !hoveredElementId.value) {
      return null;
    }
    return findSourceElementsByIds(options.currentSlideRender.value.elements, [hoveredElementId.value])[0] ?? null;
  });

  const sourceMarqueeRect = computed(() =>
    marqueeDraft.value
      ? rectFromPoints(marqueeDraft.value.anchor, marqueeDraft.value.focus)
      : null,
  );

  function resetSourceSelection(): void {
    sourceSelectionStore.$reset();
    pointerSession = null;
  }

  function reconcileSourceSelection(): void {
    const slideRender = options.currentSlideRender.value;
    pointerSession = null;
    sourceSelectionStore.setMarqueeDraft(null);

    if (!slideRender || !options.canSelectSourceElements.value) {
      sourceSelectionStore.clearSelection();
      sourceSelectionStore.setHoveredElementId(null);
      return;
    }

    const restoredIds = findSourceElementsByIds(slideRender.elements, selectedElementIds.value)
      .map((target) => target.elementId);
    sourceSelectionStore.setSelectedElementIds(restoredIds);
    const restoredHoveredTarget = hoveredElementId.value
      ? findSourceElementsByIds(slideRender.elements, [hoveredElementId.value])[0] ?? null
      : null;
    sourceSelectionStore.setHoveredElementId(restoredHoveredTarget?.elementId ?? null);
  }

  function handleSourcePointerDown(event: globalThis.PointerEvent): void {
    if (!options.canSelectSourceElements.value || event.button !== 0) {
      return;
    }

    const point = resolvePointerPoint(event);
    if (!point) {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    target?.setPointerCapture(event.pointerId);
    pointerSession = {
      pointerId: event.pointerId,
      anchor: point,
      focus: point,
      screenAnchor: { x: event.clientX, y: event.clientY },
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      hasDragged: false,
    };
    sourceSelectionStore.setMarqueeDraft(null);
  }

  function handleSourcePointerMove(event: globalThis.PointerEvent): void {
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) {
      updateHoveredTarget(event);
      return;
    }

    event.preventDefault();
    const point = resolvePointerPoint(event);
    if (!point) {
      return;
    }

    pointerSession.focus = point;
    const movedX = event.clientX - pointerSession.screenAnchor.x;
    const movedY = event.clientY - pointerSession.screenAnchor.y;
    if (!pointerSession.hasDragged && Math.hypot(movedX, movedY) < MARQUEE_START_THRESHOLD_PX) {
      return;
    }

    pointerSession.hasDragged = true;
    sourceSelectionStore.setMarqueeDraft({
      anchor: pointerSession.anchor,
      focus: pointerSession.focus,
    });
  }

  function handleSourcePointerUp(event: globalThis.PointerEvent): void {
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    releasePointerCapture(event);
    const session = pointerSession;
    pointerSession = null;
    sourceSelectionStore.setMarqueeDraft(null);

    const point = resolvePointerPoint(event) ?? session.focus;
    const slideRender = options.currentSlideRender.value;
    if (!slideRender || !options.canSelectSourceElements.value) {
      sourceSelectionStore.clearSelection();
      return;
    }

    if (session.hasDragged) {
      const rect = rectFromPoints(session.anchor, point);
      const marqueeTargets = collectSourceElementsInRect(slideRender.elements, rect);
      sourceSelectionStore.setSelectedElementIds(resolveSourceMarqueeSelection({
        currentElementIds: selectedElementIds.value,
        marqueeElementIds: marqueeTargets.map((target) => target.elementId),
        additive: session.additive,
      }));
      return;
    }

    const target = findSourceElementAtPoint(slideRender.elements, point);
    if (target) {
      sourceSelectionStore.setHoveredElementId(target.elementId);
      sourceSelectionStore.setSelectedElementIds(resolveSourceElementClickSelection({
        currentElementIds: selectedElementIds.value,
        clickedElementId: target.elementId,
        additive: session.additive,
      }));
      return;
    }

    if (!session.additive) {
      sourceSelectionStore.clearSelection();
    }
  }

  function handleSourcePointerLeave(): void {
    if (pointerSession) {
      return;
    }
    sourceSelectionStore.setHoveredElementId(null);
  }

  function handleSourcePointerCancel(event: globalThis.PointerEvent): void {
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    releasePointerCapture(event);
    pointerSession = null;
    sourceSelectionStore.setMarqueeDraft(null);
  }

  function updateHoveredTarget(event: globalThis.PointerEvent): void {
    if (!options.canSelectSourceElements.value) {
      sourceSelectionStore.setHoveredElementId(null);
      return;
    }
    const point = resolvePointerPoint(event);
    const slideRender = options.currentSlideRender.value;
    if (!point || !slideRender) {
      sourceSelectionStore.setHoveredElementId(null);
      return;
    }
    const target = findSourceElementAtPoint(slideRender.elements, point);
    sourceSelectionStore.setHoveredElementId(target?.elementId ?? null);
  }

  function releasePointerCapture(event: globalThis.PointerEvent): void {
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (target?.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  }

  function resolvePointerPoint(event: globalThis.PointerEvent): SourceSelectionPoint | null {
    const element = options.wrapperRef.value;
    if (!element || options.renderScale.value <= 0) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const xPx = (event.clientX - rect.left) / options.renderScale.value;
    const yPx = (event.clientY - rect.top) / options.renderScale.value;
    const x = clampNumber(xPx / INCHES_TO_PX, 0, options.actualSlideSize.value.width);
    const y = clampNumber(yPx / INCHES_TO_PX, 0, options.actualSlideSize.value.height);
    return { x, y };
  }

  return {
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
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
