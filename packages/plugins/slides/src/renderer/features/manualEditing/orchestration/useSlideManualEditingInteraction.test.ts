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
      capabilities: ['translate', 'set_text_content'],
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
      authoringEdit: { capabilities: ['translate'] },
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

function createInteraction(
  submitOperation: ReturnType<typeof vi.fn>,
  currentSlide: SlideRenderModel = slide,
) {
  const wrapper = document.createElement('div');
  wrapper.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 960, height: 540 });
  wrapper.setPointerCapture = vi.fn();
  wrapper.releasePointerCapture = vi.fn();
  wrapper.hasPointerCapture = vi.fn(() => true);
  const interaction = useSlideManualEditingInteraction({
    canEdit: ref(true),
    currentSlide: ref(currentSlide),
    renderScale: ref(1),
    slideSize: ref({ width: 10, height: 5.625 }),
    wrapperRef: ref(wrapper),
    submitOperation,
  });
  wrapper.addEventListener('pointerdown', interaction.handlePointerDown);
  wrapper.addEventListener('pointermove', interaction.handlePointerMove);
  wrapper.addEventListener('pointerup', interaction.handlePointerUp);
  wrapper.addEventListener('dblclick', interaction.handleDoubleClick);
  return { interaction, wrapper };
}

describe('useSlideManualEditingInteraction', () => {
  beforeEach(() => setActivePinia(createPinia()));

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
      op: 'translate_by',
      target: { slideKey: 'overview', editKey: 'headline' },
      targetKind: 'text',
      delta: { dx: 1, dy: 0.5 },
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
      op: 'set_text_content',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: '新的标题',
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
      op: 'translate_by',
      target: { slideKey: 'overview', editKey: 'card1' },
      targetKind: 'frame',
    }));
    expect(interaction.pendingTranslation.value?.affectedElementIds).toEqual([
      'authoring-overview-card1',
      'authoring-overview-card1Label',
    ]);
  });
});
