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

    // 文稿暂时不能手动写入时，选区仍可交给 AI。
    store.setEnabled(false);
    expect(store.selectedTarget).toEqual(target);
    store.clearSelection();
    expect(store.selectedTarget).toBeNull();
    expect(store.translationPreview).toBeNull();
  });

});

describe('pending insertions', () => {
  it('exposes boxes of queued and active insertions until they are presented', () => {
    setActivePinia(createPinia());
    const store = useSlidesManualEditingStore();
    const object = { kind: 'shape' as const, editKey: 'new', geometry: 'rect' as const, fill: '#2563EB', content: '', box: { x: 1, y: 1, w: 2, h: 1 } };
    const entry = { intent: { operation: { op: 'insert_objects' as const, index: 2, objects: [object] } }, clientOperationIds: ['a'] as [string] };
    store.setQueue([entry]);
    expect(store.pendingInsertions).toEqual([{ slideIndex: 2, object }]);
    store.setQueue([]); store.setSubmission({ phase: 'awaiting_frame', entry, commandId: 'a', revision: 3 });
    expect(store.pendingInsertions).toHaveLength(1);
    store.setSubmission({ phase: 'idle' });
    expect(store.pendingInsertions).toEqual([]);
  });
});
