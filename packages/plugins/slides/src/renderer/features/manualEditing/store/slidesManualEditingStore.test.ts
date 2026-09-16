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
      op: 'set_text_content' as const, targetKind: 'text' as const,
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

  it('keeps a property preview until presentation and removes it on failure', () => {
    const store = useSlidesManualEditingStore();
    const operation = {
      op: 'set_text_style' as const,
      target: target.authoringRef,
      color: '#2563EB',
    };
    const preview = {
      elementId: target.elementId,
      affectedElementIds: [target.elementId],
      operation,
    };
    store.beginSubmit(operation, undefined, preview);
    expect(store.pendingVisual).toEqual(preview);
    store.commitSubmit(7);
    store.recordPresentedRevision(6);
    expect(store.pendingVisual).toEqual(preview);
    store.recordPresentedRevision(7);
    expect(store.pendingVisual).toBeNull();

    store.beginSubmit(operation, undefined, preview);
    store.failSubmit('编译失败');
    expect(store.pendingVisual).toBeNull();
    expect(store.errorMessage).toBe('编译失败');
  });

  it('starts queued intents one at a time after the prior revision is presented', () => {
    const store = useSlidesManualEditingStore();
    const first = {
      operation: {
        op: 'set_text_style' as const,
        target: target.authoringRef,
        fontSizePt: 24,
      },
      visualPreview: {
        elementId: target.elementId,
        affectedElementIds: [target.elementId],
        operation: {
          op: 'set_text_style' as const,
          target: target.authoringRef,
          fontSizePt: 24,
        },
      },
    };
    const second = {
      operation: {
        op: 'set_text_style' as const,
        target: target.authoringRef,
        color: '#2563EB',
      },
      visualPreview: {
        elementId: target.elementId,
        affectedElementIds: [target.elementId],
        operation: {
          op: 'set_text_style' as const,
          target: target.authoringRef,
          color: '#2563EB',
        },
      },
    };
    store.enqueueIntent(first);
    expect(store.startNextSubmit()).toEqual(first);
    expect(store.pendingVisual).toEqual(first.visualPreview);

    store.enqueueIntent(second);
    expect(store.queuedIntents).toEqual([second]);

    store.commitSubmit(8);
    expect(store.startNextSubmit()).toBeNull();
    store.recordPresentedRevision(8);
    expect(store.startNextSubmit()).toEqual(second);
    expect(store.pendingVisual).toEqual(second.visualPreview);
  });

  it('rolls back every queued preview when the active command fails', () => {
    const store = useSlidesManualEditingStore();
    store.enqueueIntent({
      operation: {
        op: 'set_text_style',
        target: target.authoringRef,
        color: '#2563EB',
      },
    });
    store.enqueueIntent({
      operation: {
        op: 'set_text_style',
        target: target.authoringRef,
        fontSizePt: 32,
      },
    });
    store.startNextSubmit();
    store.failSubmit('编译失败');

    expect(store.queuedIntents).toEqual([]);
    expect(store.pendingVisual).toBeNull();
  });
});
