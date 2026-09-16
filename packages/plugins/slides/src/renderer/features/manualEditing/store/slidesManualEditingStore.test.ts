import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSlidesManualEditingStore } from './slidesManualEditingStore';

const target = {
  elementId: 'authoring-overview-headline',
  nodeKind: 'text' as const,
  targetKind: 'text' as const,
  capabilities: ['translate', 'set_text_style'] as const,
  authoringRef: { slideKey: 'overview', editKey: 'headline' },
  authoringAncestorRefs: [],
  bounds: { x: 1, y: 1, w: 3, h: 1 },
  polygon: [
    { x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 2 }, { x: 1, y: 2 },
  ],
  translationElementIds: ['authoring-overview-headline'],
};

describe('slidesManualEditingStore', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('keeps transient selection and drag preview inside the feature', () => {
    const store = useSlidesManualEditingStore();
    store.setEnabled(true);
    store.selectTarget(target);
    store.setTranslationPreview({
      elementId: target.elementId,
      affectedElementIds: target.translationElementIds,
      dx: 0.2,
      dy: -0.1,
    });
    expect(store.selectedTarget).toEqual(target);
    expect(store.translationPreview).toMatchObject({ dx: 0.2, dy: -0.1 });

    store.setEnabled(false);
    expect(store.selectedTarget).toBeNull();
    expect(store.translationPreview).toBeNull();
  });

});
