import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { DeckPreview } from '../types/api';

const getDeckPreviewMock = vi.fn();
const getDocumentBuildStateMock = vi.fn();
const notifyDocumentOpenedMock = vi.fn(async () => ({ success: true }));

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
    vi.clearAllMocks();
    getDocumentBuildStateMock.mockImplementation(async (nodeId: string) => ({
      state: 'ready',
      presentationId: nodeId,
      versionId: 'version-1',
      versionNumber: 1,
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
