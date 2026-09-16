import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { DeckPreview } from '../types/api';

const getDeckPreviewMock = vi.fn();
const getDocumentBuildStateMock = vi.fn();
const notifyDocumentOpenedMock = vi.fn(async () => ({ success: true }));

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

vi.mock('../services/slidesApi', () => ({
  slidesApi: {
    getDeckPreview: getDeckPreviewMock,
    getDocumentBuildState: getDocumentBuildStateMock,
  },
}));

vi.mock('@plugin/renderer/workspaceRuntime', () => ({
  notifyWorkspaceDocumentOpened: notifyDocumentOpenedMock,
}));

function makeDeckPreview(nodeId: string, versionNumber: number, slideCount: number): DeckPreview {
  return {
    nodeId,
    versionNumber,
    title: `Deck ${nodeId}`,
    slideSize: { width: 10, height: 5.625 },
    slides: Array.from({ length: slideCount }, (_, index) => ({
      slideId: `${nodeId}-s${index + 1}`,
      number: index + 1,
      layoutName: 'structured',
      elements: [],
    })),
    theme: {
      colors: {},
      fonts: { major: 'Arial', minor: 'Arial' },
    },
    warnings: [],
  };
}

describe('slidesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getDeckPreviewMock.mockReset();
    getDocumentBuildStateMock.mockReset();
    notifyDocumentOpenedMock.mockClear();
    getDocumentBuildStateMock.mockImplementation(async (nodeId: string) => ({
      state: 'ready',
      presentationId: nodeId,
      versionId: 'version-1',
      versionNumber: 1,
      sourceHash: 'a'.repeat(64),
    }));
  });

  it('refreshDeck preserves the current slide index while updating preview data', async () => {
    getDeckPreviewMock
      .mockResolvedValueOnce(makeDeckPreview('deck-1', 1, 3))
      .mockResolvedValueOnce(makeDeckPreview('deck-1', 2, 3));

    const { useSlidesStore } = await import('./slidesStore');
    const store = useSlidesStore();

    await store.loadDeck('deck-1');
    store.setCurrentSlide(2);

    await store.refreshDeck('deck-1');

    expect(store.currentDeckId).toBe('deck-1');
    expect(store.currentSlideIndex).toBe(2);
    expect(store.deckPreview?.versionNumber).toBe(2);
    expect(notifyDocumentOpenedMock).toHaveBeenCalledTimes(1);
  });

  it('openDeckAtSlide loads the deck and lands on the requested slide', async () => {
    getDeckPreviewMock.mockResolvedValueOnce(makeDeckPreview('deck-2', 1, 4));

    const { useSlidesStore } = await import('./slidesStore');
    const store = useSlidesStore();

    await store.openDeckAtSlide('deck-2', 3);

    expect(store.currentDeckId).toBe('deck-2');
    expect(store.currentSlideIndex).toBe(2);
    expect(store.deckPreview?.versionNumber).toBe(1);
    expect(notifyDocumentOpenedMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces mutation and command refreshes for the same committed revision', async () => {
    const nextBuildState = createDeferred<{
      state: 'ready'; presentationId: string; versionId: string;
      versionNumber: number; sourceHash: string;
    }>();
    getDeckPreviewMock
      .mockResolvedValueOnce(makeDeckPreview('deck-1', 1, 2))
      .mockResolvedValueOnce(makeDeckPreview('deck-1', 2, 2));

    const { useSlidesStore } = await import('./slidesStore');
    const store = useSlidesStore();
    await store.loadDeck('deck-1');
    getDocumentBuildStateMock.mockReturnValueOnce(nextBuildState.promise);

    const commandRefresh = store.refreshDeck('deck-1', 2);
    const mutationRefresh = store.refreshDeck('deck-1', 2);
    nextBuildState.resolve({
      state: 'ready', presentationId: 'deck-1', versionId: 'version-2',
      versionNumber: 2, sourceHash: 'b'.repeat(64),
    });
    await Promise.all([commandRefresh, mutationRefresh]);

    expect(getDocumentBuildStateMock).toHaveBeenCalledTimes(2);
    expect(getDeckPreviewMock).toHaveBeenCalledTimes(2);
    await store.refreshDeck('deck-1', 2);
    expect(getDocumentBuildStateMock).toHaveBeenCalledTimes(2);
  });

  it('never lets a stale refresh reactivate or overwrite a newly opened deck', async () => {
    const staleBuildState = createDeferred<{
      state: 'ready'; presentationId: string; versionId: string;
      versionNumber: number; sourceHash: string;
    }>();
    getDocumentBuildStateMock
      .mockResolvedValueOnce({
        state: 'ready', presentationId: 'deck-a', versionId: 'version-1',
        versionNumber: 1, sourceHash: 'a'.repeat(64),
      })
      .mockReturnValueOnce(staleBuildState.promise)
      .mockResolvedValueOnce({
        state: 'ready', presentationId: 'deck-b', versionId: 'version-1',
        versionNumber: 1, sourceHash: 'b'.repeat(64),
      });
    getDeckPreviewMock
      .mockResolvedValueOnce(makeDeckPreview('deck-a', 1, 2))
      .mockResolvedValueOnce(makeDeckPreview('deck-b', 1, 3));

    const { useSlidesStore } = await import('./slidesStore');
    const store = useSlidesStore();
    await store.loadDeck('deck-a');
    const staleRefresh = store.refreshDeck('deck-a', 2);
    await store.loadDeck('deck-b');
    staleBuildState.resolve({
      state: 'ready', presentationId: 'deck-a', versionId: 'version-2',
      versionNumber: 2, sourceHash: 'c'.repeat(64),
    });
    await staleRefresh;

    expect(store.currentDeckId).toBe('deck-b');
    expect(store.deckPreview?.nodeId).toBe('deck-b');
    expect(store.documentBuildState?.presentationId).toBe('deck-b');
    await store.refreshDeck('deck-a', 2);
    expect(getDocumentBuildStateMock).toHaveBeenCalledTimes(3);
  });

  it('把未解决 draft 作为已打开但不可预览的文档状态', async () => {
    getDocumentBuildStateMock.mockResolvedValueOnce({
      state: 'draft',
      presentationId: 'deck-draft',
      versionId: 'version-1',
      versionNumber: 1,
      draftStatus: {
        baseVersionId: 'version-1',
        baseVersionNumber: 1,
        errorKind: 'slides.codegen.typecheck',
        errorSummary: 'TS8006 at line 1',
        updatedAt: 100,
      },
    });
    const { useSlidesStore } = await import('./slidesStore');
    const store = useSlidesStore();

    await store.loadDeck('deck-draft');

    expect(store.currentDeckId).toBe('deck-draft');
    expect(store.documentBuildState?.state).toBe('draft');
    expect(store.deckPreview).toBeNull();
    expect(store.deckError).toBeNull();
    expect(getDeckPreviewMock).not.toHaveBeenCalled();
    expect(notifyDocumentOpenedMock).toHaveBeenCalledWith({ documentId: 'deck-draft' });
  });
});
