import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSlidesManualEditingStore } from './slidesManualEditingStore';

const target = {
  elementId: 'authoring-overview-headline',
  nodeKind: 'text' as const,
  targetKind: 'text' as const,
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

  it('keeps a translation visible until the committed RenderModel revision is presented', () => {
    const store = useSlidesManualEditingStore();
    const operation = {
      op: 'translate_by' as const,
      target: target.authoringRef,
      targetKind: target.targetKind,
      delta: { dx: 0.2, dy: -0.1 },
    };
    const preview = {
      elementId: target.elementId,
      affectedElementIds: target.translationElementIds,
      dx: 0.2,
      dy: -0.1,
    };
    store.beginSubmit(operation, preview);
    expect(store.submitting).toBe(true);
    expect(store.pendingTranslation).toEqual(preview);

    store.commitSubmit(4);
    expect(store.submitting).toBe(false);
    store.recordPresentedRevision(3);
    expect(store.pendingTranslation).toEqual(preview);
    store.recordPresentedRevision(4);
    expect(store.pendingTranslation).toBeNull();
  });

  it('settles text submission only after the committed revision is presented', () => {
    const store = useSlidesManualEditingStore();
    const operation = {
      op: 'set_text_content' as const,
      target: target.authoringRef,
      content: 'Changed title',
    };
    store.beginSubmit(operation);
    store.failSubmit('版本已变化');
    expect(store.errorMessage).toBe('版本已变化');
    expect(store.textSubmissionPending).toBe(false);

    store.beginSubmit(operation);
    store.commitSubmit(5);
    expect(store.textSubmissionPending).toBe(true);
    store.recordPresentedRevision(5);
    expect(store.textSubmissionPending).toBe(false);
  });

  it('settles immediately when the visual frame arrived before the command response', () => {
    const store = useSlidesManualEditingStore();
    const operation = {
      op: 'translate_by' as const,
      target: target.authoringRef,
      targetKind: target.targetKind,
      delta: { dx: 0.2, dy: 0.1 },
    };
    store.beginSubmit(operation, {
      elementId: target.elementId,
      affectedElementIds: target.translationElementIds,
      dx: 0.2,
      dy: 0.1,
    });
    store.recordPresentedRevision(4);
    store.commitSubmit(4);
    expect(store.pendingTranslation).toBeNull();
    expect(store.pendingPresentationRevision).toBeNull();
  });
});
