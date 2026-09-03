// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { type Ref, ref } from 'vue';
import type {
  RenderBox,
  RenderSourceSpan,
  ShapeRenderNode,
  SlideRenderModel,
} from '../../../types/render';
import { useSlideSourceSelectionInteraction } from './useSlideSourceSelectionInteraction';
import { useSlidesSourceSelectionStore } from '../store/slidesSourceSelectionStore';

const SOURCE_SPAN: RenderSourceSpan = { startLine: 1, endLine: 1 };

function box(input: Omit<RenderBox, 'unit'>): RenderBox {
  return { ...input, unit: 'in' };
}

function shape(id: string, shapeBox: RenderBox, zIndex: number): ShapeRenderNode {
  return {
    id,
    kind: 'shape',
    box: shapeBox,
    zIndex,
    visible: true,
    geometry: { type: 'preset', name: 'rect' },
    sourceSpan: SOURCE_SPAN,
  };
}

function makeSlideRender(): SlideRenderModel {
  return {
    slideId: 's1',
    index: 0,
    layoutKey: 'freeform',
    background: {},
    elements: [
      shape('a', box({ x: 1, y: 1, w: 1, h: 1 }), 1),
      shape('b', box({ x: 3, y: 1, w: 1, h: 1 }), 2),
    ],
  };
}

function makeSlideRenderWithIds(ids: readonly string[]): SlideRenderModel {
  return {
    slideId: 's1',
    index: 0,
    layoutKey: 'freeform',
    background: {},
    elements: ids.map((id, index) =>
      shape(id, box({ x: 1 + index * 2, y: 1, w: 1, h: 1 }), index + 1)),
  };
}

function createInteraction(
  currentSlideRender: Ref<SlideRenderModel | null>,
  canSelectSourceElements: Ref<boolean> = ref(true),
) {
  const wrapper = makeWrapper();
  return useSlideSourceSelectionInteraction({
    canSelectSourceElements,
    currentSlideRender,
    renderScale: ref(1),
    actualSlideSize: ref({ width: 10, height: 5.625 }),
    wrapperRef: ref(wrapper),
  });
}

function makeWrapper(): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => ({
      left: 10,
      top: 20,
      width: 960,
      height: 540,
      right: 970,
      bottom: 560,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }),
  });
  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = vi.fn(() => true);
  element.releasePointerCapture = vi.fn();
  return element;
}

function pointerEvent(
  type: string,
  element: HTMLElement,
  init: PointerEventInit,
): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: 1,
    button: 0,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, 'currentTarget', { value: element });
  return event;
}

describe('useSlideSourceSelectionInteraction', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('selects a source-backed element on click', () => {
    const wrapper = makeWrapper();
    const interaction = useSlideSourceSelectionInteraction({
      canSelectSourceElements: ref(true),
      currentSlideRender: ref(makeSlideRender()),
      renderScale: ref(1),
      actualSlideSize: ref({ width: 10, height: 5.625 }),
      wrapperRef: ref(wrapper),
    });
    const store = useSlidesSourceSelectionStore();

    interaction.handleSourcePointerDown(pointerEvent('pointerdown', wrapper, {
      clientX: 10 + 1.5 * 96,
      clientY: 20 + 1.5 * 96,
    }));
    interaction.handleSourcePointerUp(pointerEvent('pointerup', wrapper, {
      clientX: 10 + 1.5 * 96,
      clientY: 20 + 1.5 * 96,
    }));

    expect(store.selectedElementIds).toEqual(['a']);
    expect(interaction.selectedSourceTargets.value.map((target) => target.elementId)).toEqual(['a']);
  });

  it('selects intersecting source-backed elements with marquee drag', () => {
    const wrapper = makeWrapper();
    const interaction = useSlideSourceSelectionInteraction({
      canSelectSourceElements: ref(true),
      currentSlideRender: ref(makeSlideRender()),
      renderScale: ref(1),
      actualSlideSize: ref({ width: 10, height: 5.625 }),
      wrapperRef: ref(wrapper),
    });
    const store = useSlidesSourceSelectionStore();

    interaction.handleSourcePointerDown(pointerEvent('pointerdown', wrapper, {
      clientX: 10,
      clientY: 20,
    }));
    interaction.handleSourcePointerMove(pointerEvent('pointermove', wrapper, {
      clientX: 10 + 4.5 * 96,
      clientY: 20 + 2.5 * 96,
    }));
    expect(interaction.sourceMarqueeRect.value).toEqual({ x: 0, y: 0, w: 4.5, h: 2.5 });

    interaction.handleSourcePointerUp(pointerEvent('pointerup', wrapper, {
      clientX: 10 + 4.5 * 96,
      clientY: 20 + 2.5 * 96,
    }));

    expect(store.selectedElementIds).toEqual(['a', 'b']);
    expect(interaction.sourceMarqueeRect.value).toBeNull();
  });

  it('tracks hover target without opening selection', () => {
    const wrapper = makeWrapper();
    const interaction = useSlideSourceSelectionInteraction({
      canSelectSourceElements: ref(true),
      currentSlideRender: ref(makeSlideRender()),
      renderScale: ref(1),
      actualSlideSize: ref({ width: 10, height: 5.625 }),
      wrapperRef: ref(wrapper),
    });
    const store = useSlidesSourceSelectionStore();

    interaction.handleSourcePointerMove(pointerEvent('pointermove', wrapper, {
      clientX: 10 + 1.5 * 96,
      clientY: 20 + 1.5 * 96,
    }));

    expect(store.hoveredElementId).toBe('a');
    expect(store.selectedElementIds).toEqual([]);
    expect(interaction.hoveredSourceTarget.value?.elementId).toBe('a');

    interaction.handleSourcePointerLeave();

    expect(store.hoveredElementId).toBeNull();
    expect(interaction.hoveredSourceTarget.value).toBeNull();
  });

  it('restores still-existing selected ids after render model refresh', () => {
    const currentSlideRender = ref<SlideRenderModel | null>(makeSlideRenderWithIds(['a', 'b']));
    const interaction = createInteraction(currentSlideRender);
    const store = useSlidesSourceSelectionStore();
    store.setSelectedElementIds(['a', 'b']);

    currentSlideRender.value = makeSlideRenderWithIds(['a', 'c']);
    interaction.reconcileSourceSelection();

    expect(store.selectedElementIds).toEqual(['a']);
    expect(interaction.selectedSourceTargets.value.map((target) => target.elementId)).toEqual(['a']);
  });

  it('ignores pointer selection while source element selection mode is disabled', () => {
    const wrapper = makeWrapper();
    const canSelectSourceElements = ref(false);
    const interaction = useSlideSourceSelectionInteraction({
      canSelectSourceElements,
      currentSlideRender: ref(makeSlideRender()),
      renderScale: ref(1),
      actualSlideSize: ref({ width: 10, height: 5.625 }),
      wrapperRef: ref(wrapper),
    });
    const store = useSlidesSourceSelectionStore();

    interaction.handleSourcePointerDown(pointerEvent('pointerdown', wrapper, {
      clientX: 10 + 1.5 * 96,
      clientY: 20 + 1.5 * 96,
    }));
    interaction.handleSourcePointerUp(pointerEvent('pointerup', wrapper, {
      clientX: 10 + 1.5 * 96,
      clientY: 20 + 1.5 * 96,
    }));

    expect(store.selectedElementIds).toEqual([]);
  });
});
