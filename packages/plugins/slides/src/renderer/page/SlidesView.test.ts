// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { DeckPreviewViewModel } from '../types/preview';
import type { PresentationRenderModel } from '../types/render';

const getRenderModelMock = vi.hoisted(() => vi.fn());
const submitManualEditMock = vi.hoisted(() => vi.fn());

vi.mock('../services/slidesRenderApi', () => ({
  slidesRenderApi: {
    getRenderModel: getRenderModelMock,
  },
}));

vi.mock('../services/slidesApi', () => ({
  slidesApi: {
    submitManualEdit: submitManualEditMock,
  },
}));

vi.mock('../ui/deck/DeckViewer.vue', () => ({
  default: {
    name: 'DeckViewerStub',
    emits: ['manualEditSubmit'],
    template: `<button class="deck-viewer-stub" @click="$emit('manualEditSubmit', {
      op: 'translate_by',
      target: { slideKey: 'overview', editKey: 'hero' },
      targetKind: 'image',
      delta: { dx: 0.2, dy: -0.1 }
    })" />`,
  },
}));

vi.mock('../ui/shared/SlidesStatusState.vue', () => ({
  default: {
    name: 'SlidesStatusStateStub',
    template: '<div class="slides-status-state-stub" />',
  },
}));

import SlidesView from './SlidesView.vue';
import { useSlidesRenderStore } from '../store/slidesRenderStore';
import { useSlidesStore } from '../store/slidesStore';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function makeDeckPreview(versionNumber: number): DeckPreviewViewModel {
  return {
    nodeId: 'deck-1',
    versionNumber,
    title: 'Deck',
    slideSize: { width: 10, height: 5.625 },
    slides: [{
      slideId: 'slide-1',
      number: 1,
      elements: [],
    }],
    theme: {
      colors: {},
      fonts: { major: 'Arial', minor: 'Arial' },
    },
    warnings: [],
  };
}

function makeRenderModel(version: number): PresentationRenderModel {
  return {
    presentationId: 'deck-1',
    title: 'Deck',
    version,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: [{
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'structured',
      background: { color: '#FFFFFF' },
      elements: [],
    }],
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
  };
}

function readyBuildState(versionNumber: number) {
  return {
    state: 'ready' as const,
    presentationId: 'deck-1',
    versionId: `version-${versionNumber}`,
    versionNumber,
    sourceHash: String(versionNumber).padStart(64, '0'),
  };
}

async function flushUpdates(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe('SlidesView render-model lifecycle', () => {
  let app: App<Element> | null = null;

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();

    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(SlidesView);
    app.use(pinia);
    app.mount(host);
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
  });

  it('同一 ready deck 更新时保留旧 RenderModel，待新版本就绪后原子替换', async () => {
    const initialModel = createDeferred<PresentationRenderModel>();
    const refreshedModel = createDeferred<PresentationRenderModel>();
    getRenderModelMock
      .mockReturnValueOnce(initialModel.promise)
      .mockReturnValueOnce(refreshedModel.promise);

    const slidesStore = useSlidesStore();
    const renderStore = useSlidesRenderStore();
    slidesStore.currentDeckId = 'deck-1';
    slidesStore.documentBuildState = readyBuildState(1);
    slidesStore.deckPreview = makeDeckPreview(1);
    await flushUpdates();

    initialModel.resolve(makeRenderModel(1));
    await flushUpdates();
    expect(renderStore.renderModel?.version).toBe(1);

    slidesStore.documentBuildState = readyBuildState(2);
    slidesStore.deckPreview = makeDeckPreview(2);
    await flushUpdates();

    expect(getRenderModelMock).toHaveBeenCalledTimes(2);
    expect(renderStore.renderModel?.version).toBe(1);
    expect(renderStore.renderLoading).toBe(false);

    refreshedModel.resolve(makeRenderModel(2));
    await flushUpdates();
    expect(renderStore.renderModel?.version).toBe(2);
  });

  it('ready deck 进入 draft 时不保留旧 RenderModel', async () => {
    getRenderModelMock.mockResolvedValueOnce(makeRenderModel(1));

    const slidesStore = useSlidesStore();
    const renderStore = useSlidesRenderStore();
    slidesStore.currentDeckId = 'deck-1';
    slidesStore.documentBuildState = readyBuildState(1);
    slidesStore.deckPreview = makeDeckPreview(1);
    await flushUpdates();
    expect(renderStore.renderModel?.version).toBe(1);

    slidesStore.documentBuildState = {
      state: 'draft',
      presentationId: 'deck-1',
      versionId: 'version-1',
      versionNumber: 1,
      sourceHash: '1'.padStart(64, '0'),
      draftStatus: {
        baseVersionId: 'version-1',
        baseVersionNumber: 1,
        errorKind: 'slides.codegen.typecheck',
        errorSummary: 'TS8006 at line 1',
        updatedAt: 100,
      },
    };
    slidesStore.deckPreview = null;
    await flushUpdates();

    expect(renderStore.renderModel).toBeNull();
  });

  it('把画布人工移动提交为精确 revision 命令并刷新文稿', async () => {
    getRenderModelMock.mockResolvedValueOnce(makeRenderModel(3));
    submitManualEditMock.mockImplementationOnce(async command => ({
      status: 'committed',
      commandId: command.commandId,
      documentId: command.documentId,
      revisionId: 'version-4',
      revision: 4,
    }));

    const slidesStore = useSlidesStore();
    const refreshDeck = vi.spyOn(slidesStore, 'refreshDeck').mockResolvedValue();
    slidesStore.currentDeckId = 'deck-1';
    slidesStore.documentBuildState = readyBuildState(3);
    slidesStore.deckPreview = makeDeckPreview(3);
    await flushUpdates();

    document.querySelector<HTMLButtonElement>('.deck-viewer-stub')?.click();
    await flushUpdates();

    expect(submitManualEditMock).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 'deck-1',
      expectedBase: {
        revisionId: 'version-3',
        revision: 3,
        sourceHash: '3'.padStart(64, '0'),
      },
      operation: {
        op: 'translate_by',
        target: { slideKey: 'overview', editKey: 'hero' },
        targetKind: 'image',
        delta: { dx: 0.2, dy: -0.1 },
      },
    }));
    expect(refreshDeck).toHaveBeenCalledWith('deck-1', 4);
  });
});
