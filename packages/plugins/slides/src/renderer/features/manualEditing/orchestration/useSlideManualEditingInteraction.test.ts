// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlideRenderModel } from '../../../types/render';
import { useSlidesManualEditingStore } from '../store/slidesManualEditingStore';
import { useSlideManualEditingInteraction } from './useSlideManualEditingInteraction';

const slide: SlideRenderModel = {
  slideId: 'slide-1',
  index: 0,
  layoutKey: 'freeform',
  background: { paint: { type: 'none' } },
  elements: [{
    id: 'authoring-overview-headline',
    kind: 'text',
    box: { x: 1, y: 1, w: 3, h: 1, unit: 'in' },
    zIndex: 1,
    paragraphs: [{ runs: [{ text: '增长' }, { text: ' 2026' }] }],
    authoringRef: { slideKey: 'overview', editKey: 'headline', targetKind: 'text' },
    authoringEdit: {
      capabilities: ['translate', 'delete', 'set_text_content', 'set_text_style'],
      text: { kind: 'plain_text', content: '增长 2026' },
    },
  }],
};

const frameSlide: SlideRenderModel = {
  ...slide,
  elements: [
    {
      id: 'authoring-overview-card1',
      kind: 'shape',
      box: { x: 1, y: 1, w: 4, h: 2, unit: 'in' },
      zIndex: 1,
      geometry: { type: 'preset', name: 'roundRect' },
      authoringRef: { slideKey: 'overview', editKey: 'card1', targetKind: 'frame' },
      authoringEdit: { capabilities: ['translate', 'set_fill_color', 'delete'] },
    },
    {
      ...slide.elements[0],
      id: 'authoring-overview-card1Label',
      box: { x: 1.4, y: 1.4, w: 2, h: 0.5, unit: 'in' },
      zIndex: 2,
      authoringRef: { slideKey: 'overview', editKey: 'card1Label', targetKind: 'text' },
      authoringAncestorRefs: [{
        slideKey: 'overview', editKey: 'card1', targetKind: 'frame',
      }],
    },
  ],
};

const siblingSlide: SlideRenderModel = {
  ...frameSlide,
  elements: [
    ...frameSlide.elements,
    {
      ...slide.elements[0],
      id: 'authoring-overview-card1Value',
      box: { x: 2.6, y: 1.4, w: 2, h: 0.5, unit: 'in' },
      zIndex: 3,
      authoringRef: { slideKey: 'overview', editKey: 'card1Value', targetKind: 'text' },
      authoringAncestorRefs: [{
        slideKey: 'overview', editKey: 'card1', targetKind: 'frame',
      }],
    },
  ],
};

function createInteraction(
  submitOperation: ReturnType<typeof vi.fn>,
  currentSlide: SlideRenderModel = slide,
  gates: { readonly canSelect?: boolean; readonly canMutate?: boolean } = {},
) {
  const wrapper = document.createElement('div');
  wrapper.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 960, height: 540 });
  wrapper.setPointerCapture = vi.fn();
  wrapper.releasePointerCapture = vi.fn();
  wrapper.hasPointerCapture = vi.fn(() => true);
  const canSelect = ref(gates.canSelect ?? true);
  const canMutate = ref(gates.canMutate ?? true);
  const interaction = useSlideManualEditingInteraction({
    canSelect,
    currentSlide: ref(currentSlide),
    renderScale: ref(1),
    slideSize: ref({ width: 10, height: 5.625 }),
    wrapperRef: ref(wrapper),
    submitIntent: intent => {
      submitOperation(intent);
      const store = useSlidesManualEditingStore();
      store.enqueueIntent(intent);
      if (canMutate.value) store.startNextSubmit();
    },
  });
  wrapper.addEventListener('pointerdown', interaction.handlePointerDown);
  wrapper.addEventListener('pointermove', interaction.handlePointerMove);
  wrapper.addEventListener('pointerup', interaction.handlePointerUp);
  wrapper.addEventListener('pointerleave', interaction.handlePointerLeave);
  wrapper.addEventListener('dblclick', interaction.handleDoubleClick);
  return { interaction, wrapper, canMutate };
}

describe('useSlideManualEditingInteraction', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('hovers only real author targets and leaves the slide background inactive', () => {
    const { interaction, wrapper } = createInteraction(vi.fn());

    wrapper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 1, clientX: 48, clientY: 48,
    }));
    expect(interaction.hoveredTarget.value).toBeNull();

    wrapper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 1, clientX: 144, clientY: 144,
    }));
    expect(interaction.hoveredTarget.value?.elementId).toBe('authoring-overview-headline');

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 2, clientX: 144, clientY: 144,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, button: 0, pointerId: 2, clientX: 144, clientY: 144,
    }));
    expect(interaction.selectedTarget.value?.elementId).toBe('authoring-overview-headline');

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 3, clientX: 48, clientY: 48,
    }));
    expect(interaction.selectedTarget.value).toBeNull();
    expect(interaction.hoveredTarget.value).toBeNull();

    wrapper.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 1 }));
    expect(interaction.hoveredTarget.value).toBeNull();
  });

  it('promotes a drag preview to an optimistic translation before submitting', () => {
    const submitOperation = vi.fn();
    const { wrapper } = createInteraction(submitOperation);
    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 7, clientX: 144, clientY: 144,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 7, clientX: 240, clientY: 192,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 7, clientX: 240, clientY: 192,
    }));

    const store = useSlidesManualEditingStore();
    expect(store.translationPreview).toBeNull();
    expect(store.pendingTranslation).toEqual({
      elementId: 'authoring-overview-headline',
      affectedElementIds: ['authoring-overview-headline'],
      dx: 1,
      dy: 0.5,
    });
    expect(submitOperation).toHaveBeenCalledWith({
      operation: {
        op: 'translate_by',
        target: { slideKey: 'overview', editKey: 'headline' },
        targetKind: 'text',
        delta: { dx: 1, dy: 0.5 },
      },
      translationPreview: {
        elementId: 'authoring-overview-headline',
        affectedElementIds: ['authoring-overview-headline'],
        dx: 1,
        dy: 0.5,
      },
    });
  });

  it('does not submit text during IME composition and preserves the draft on failure', () => {
    const submitOperation = vi.fn();
    const { interaction, wrapper } = createInteraction(submitOperation);
    wrapper.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, button: 0, clientX: 144, clientY: 144,
    }));
    interaction.textDraft.value = '新的标题';
    interaction.handleTextCompositionStart();
    interaction.submitTextEdit();
    expect(submitOperation).not.toHaveBeenCalled();

    interaction.handleTextCompositionEnd();
    interaction.submitTextEdit();
    expect(submitOperation).toHaveBeenCalledWith({
      operation: {
        op: 'set_text_content',
        target: { slideKey: 'overview', editKey: 'headline' },
        content: '新的标题',
      },
    });
    const store = useSlidesManualEditingStore();
    store.failSubmit('保存失败');
    expect(interaction.textEditorTarget.value?.elementId).toBe('authoring-overview-headline');
    expect(interaction.textDraft.value).toBe('新的标题');
  });

  it('selects a Frame first and enters its child on the next click', () => {
    const { interaction, wrapper } = createInteraction(vi.fn(), frameSlide);

    for (let click = 0; click < 2; click += 1) {
      wrapper.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, button: 0, pointerId: click + 1, clientX: 144, clientY: 144,
      }));
      wrapper.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, button: 0, pointerId: click + 1, clientX: 144, clientY: 144,
      }));
      expect(interaction.selectedTarget.value?.elementId).toBe(
        click === 0 ? 'authoring-overview-card1' : 'authoring-overview-card1Label',
      );
    }

    expect(interaction.selectionPath.value.map(target => target.elementId)).toEqual([
      'authoring-overview-card1',
      'authoring-overview-card1Label',
    ]);
  });

  it('switches directly between children of the selected Frame', () => {
    const { interaction, wrapper } = createInteraction(vi.fn(), siblingSlide);
    for (let click = 0; click < 2; click += 1) {
      wrapper.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, button: 0, pointerId: click + 1, clientX: 144, clientY: 144,
      }));
      wrapper.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, button: 0, pointerId: click + 1, clientX: 144, clientY: 144,
      }));
    }
    expect(interaction.selectedTarget.value?.elementId).toBe('authoring-overview-card1Label');

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 3, clientX: 288, clientY: 144,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, button: 0, pointerId: 3, clientX: 288, clientY: 144,
    }));

    expect(interaction.selectedTarget.value?.elementId).toBe('authoring-overview-card1Value');
  });

  it('switches directly to a sibling after the selected child starts a style revision', () => {
    const { interaction, wrapper } = createInteraction(vi.fn(), siblingSlide);
    for (let click = 0; click < 2; click += 1) {
      wrapper.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, button: 0, pointerId: click + 1, clientX: 144, clientY: 144,
      }));
      wrapper.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, button: 0, pointerId: click + 1, clientX: 144, clientY: 144,
      }));
    }
    interaction.submitVisualOperation({
      op: 'set_text_style',
      target: { slideKey: 'overview', editKey: 'card1Label' },
      color: '#2563EB',
    });

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 3, clientX: 288, clientY: 144,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, button: 0, pointerId: 3, clientX: 288, clientY: 144,
    }));

    expect(useSlidesManualEditingStore().submitting).toBe(true);
    expect(interaction.selectedTarget.value?.elementId).toBe('authoring-overview-card1Value');
  });

  it('keeps a Frame as the drag owner when the pointer starts over a child', () => {
    const submitOperation = vi.fn();
    const { interaction, wrapper } = createInteraction(submitOperation, frameSlide);
    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 7, clientX: 144, clientY: 144,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 7, clientX: 240, clientY: 192,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 7, clientX: 240, clientY: 192,
    }));

    expect(submitOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({
        op: 'translate_by',
        target: { slideKey: 'overview', editKey: 'card1' },
        targetKind: 'frame',
      }),
    }));
    expect(interaction.pendingTranslation.value?.affectedElementIds).toEqual([
      'authoring-overview-card1',
      'authoring-overview-card1Label',
    ]);
  });

  it('queues a drag while the prior revision still owns the mutation gate', () => {
    const submitOperation = vi.fn();
    const { interaction, wrapper } = createInteraction(
      submitOperation,
      frameSlide,
      { canMutate: false },
    );
    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 7, clientX: 144, clientY: 144,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 7, clientX: 240, clientY: 192,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, button: 0, pointerId: 7, clientX: 240, clientY: 192,
    }));

    expect(interaction.selectedTarget.value?.elementId).toBe('authoring-overview-card1');
    expect(interaction.translationPreview.value).toBeNull();
    expect(submitOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ op: 'translate_by' }),
    }));
    expect(interaction.queuedIntents.value).toHaveLength(1);
  });

  it('starts the next drag from the pending target visible position', () => {
    const submitOperation = vi.fn();
    const { interaction, wrapper } = createInteraction(submitOperation);
    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 7, clientX: 144, clientY: 144,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 7, clientX: 528, clientY: 240,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 7, clientX: 528, clientY: 240,
    }));

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 8, clientX: 528, clientY: 240,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 8, clientX: 624, clientY: 240,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 8, clientX: 624, clientY: 240,
    }));

    expect(submitOperation).toHaveBeenCalledTimes(2);
    expect(interaction.queuedIntents.value[0]?.operation).toMatchObject({
      op: 'translate_by',
      delta: { dx: 1, dy: 0 },
    });
  });

  it('applies the next selection after an edited text revision is presented', () => {
    const nextSlide: SlideRenderModel = {
      ...slide,
      elements: [
        ...slide.elements,
        {
          id: 'authoring-overview-accent',
          kind: 'shape',
          box: { x: 5, y: 1, w: 2, h: 1, unit: 'in' },
          zIndex: 2,
          geometry: { type: 'preset', name: 'rect' },
          authoringRef: { slideKey: 'overview', editKey: 'accent', targetKind: 'shape' },
          authoringEdit: { capabilities: ['translate', 'set_fill_color'] },
        },
      ],
    };
    const submitOperation = vi.fn();
    const { interaction, wrapper } = createInteraction(submitOperation, nextSlide);
    wrapper.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, button: 0, clientX: 144, clientY: 144,
    }));
    interaction.textDraft.value = '新的标题';

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 9, clientX: 528, clientY: 144,
    }));

    expect(submitOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ op: 'set_text_content' }),
    }));
    expect(interaction.selectedTarget.value?.elementId).toBe('authoring-overview-headline');

    interaction.completeTextEditing();
    expect(interaction.textEditorTarget.value).toBeNull();
    expect(interaction.selectedTarget.value?.elementId).toBe('authoring-overview-accent');
  });

  it('starts an immediate property preview and clears selection for Frame deletion', () => {
    const submitOperation = vi.fn();
    const { interaction, wrapper } = createInteraction(submitOperation, frameSlide);
    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 1, clientX: 144, clientY: 144,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, button: 0, pointerId: 1, clientX: 144, clientY: 144,
    }));

    interaction.submitVisualOperation({
      op: 'set_fill_color',
      target: { slideKey: 'overview', editKey: 'card1' },
      targetKind: 'frame',
      color: '#2563EB',
    });
    expect(interaction.pendingVisual.value).toMatchObject({
      elementId: 'authoring-overview-card1',
      operation: { op: 'set_fill_color', color: '#2563EB' },
    });
    expect(submitOperation).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ op: 'set_fill_color' }),
    }));

    useSlidesManualEditingStore().failSubmit('测试下一条操作');
    interaction.submitVisualOperation({
      op: 'delete_target',
      target: { slideKey: 'overview', editKey: 'card1' },
      targetKind: 'frame',
    });
    expect(interaction.selectedTarget.value).toBeNull();
    expect(interaction.pendingVisual.value?.affectedElementIds).toEqual([
      'authoring-overview-card1',
      'authoring-overview-card1Label',
    ]);
  });

  it('deletes the selected atomic target through the same optimistic intent queue', () => {
    const submitOperation = vi.fn();
    const { interaction, wrapper } = createInteraction(submitOperation);
    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 1, clientX: 144, clientY: 144,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, button: 0, pointerId: 1, clientX: 144, clientY: 144,
    }));

    expect(interaction.deleteSelectedTarget()).toBe(true);
    expect(submitOperation).toHaveBeenCalledWith({
      operation: {
        op: 'delete_target',
        target: { slideKey: 'overview', editKey: 'headline' },
        targetKind: 'text',
      },
      visualPreview: {
        elementId: 'authoring-overview-headline',
        affectedElementIds: ['authoring-overview-headline'],
        operation: {
          op: 'delete_target',
          target: { slideKey: 'overview', editKey: 'headline' },
          targetKind: 'text',
        },
      },
    });
    expect(interaction.selectedTarget.value).toBeNull();
    expect(interaction.pendingVisual.value?.affectedElementIds).toEqual([
      'authoring-overview-headline',
    ]);
  });

  it('does not delete the selected target while inline text editing owns the keyboard', () => {
    const submitOperation = vi.fn();
    const { interaction, wrapper } = createInteraction(submitOperation);
    wrapper.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, button: 0, clientX: 144, clientY: 144,
    }));

    expect(interaction.deleteSelectedTarget()).toBe(false);
    expect(submitOperation).not.toHaveBeenCalled();
  });

  it('queues another property intent while the active revision is still compiling', () => {
    const submitOperation = vi.fn();
    const { interaction, wrapper, canMutate } = createInteraction(submitOperation, frameSlide);
    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 1, clientX: 144, clientY: 144,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, button: 0, pointerId: 1, clientX: 144, clientY: 144,
    }));

    interaction.submitVisualOperation({
      op: 'set_fill_color',
      target: { slideKey: 'overview', editKey: 'card1' },
      targetKind: 'frame',
      color: '#2563EB',
    });
    canMutate.value = false;
    interaction.submitVisualOperation({
      op: 'set_fill_color',
      target: { slideKey: 'overview', editKey: 'card1' },
      targetKind: 'frame',
      color: '#DC2626',
    });

    expect(interaction.pendingVisual.value?.operation).toMatchObject({ color: '#2563EB' });
    expect(interaction.queuedIntents.value).toHaveLength(1);
    expect(interaction.queuedIntents.value[0]?.visualPreview?.operation).toMatchObject({
      color: '#DC2626',
    });
  });
});
