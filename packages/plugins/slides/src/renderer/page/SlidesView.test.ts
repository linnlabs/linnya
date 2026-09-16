// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia, getActivePinia } from 'pinia';
import type { DeckPreviewViewModel } from '../types/preview';
import type { PresentationRenderModel } from '../types/render';

const getRenderModelMock = vi.hoisted(() => vi.fn());
const submitManualEditMock = vi.hoisted(() => vi.fn());

vi.mock('@plugin/renderer/workspaceRuntime', () => ({
  getActiveFileSession: () => ({ documentId: 'deck-1', type: 'presentation' }),
  markActiveFileDirty: vi.fn(),
}));

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
    setup() { return { enqueue: useManualEditSubmission().enqueue }; },
    template: `<button class="deck-viewer-stub" @click="enqueue({
      operation: {
        op: 'translate_by',
        target: { slideKey: 'overview', editKey: 'hero' },
        targetKind: 'image',
        delta: { dx: 0.2, dy: -0.1 }
      },
      translationPreview: {
        elementId: 'hero',
        affectedElementIds: ['hero'],
        dx: 0.2,
        dy: -0.1
      }
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
import { useSlidesManualEditingStore, useManualEditSubmission } from '../features/manualEditing';

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
    vi.resetAllMocks();

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

  it('文稿先加载再挂载页面时，首条保存仍刷新并继续提交队列', async () => {
    app?.unmount();
    const slidesStore = useSlidesStore();
    const renderStore = useSlidesRenderStore();
    slidesStore.currentDeckId = 'deck-1';
    slidesStore.documentBuildState = readyBuildState(3);
    slidesStore.deckPreview = makeDeckPreview(3);
    getRenderModelMock.mockResolvedValueOnce(makeRenderModel(3)).mockResolvedValueOnce(makeRenderModel(4));
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    app = createApp(SlidesView);
    const pinia = getActivePinia();
    if (!pinia) throw new Error('Missing fixture Pinia');
    app.use(pinia);
    app.mount(host);
    await flushUpdates();
    submitManualEditMock.mockImplementation(async command => ({
      status: 'committed', commandId: command.commandId, documentId: command.documentId,
      revisionId: 'version-4', revision: 4,
    }));
    vi.spyOn(slidesStore, 'refreshDeck').mockImplementation(async () => {
      slidesStore.documentBuildState = readyBuildState(4);
      slidesStore.deckPreview = makeDeckPreview(4);
    });
    document.querySelector<HTMLButtonElement>('.deck-viewer-stub')?.click();
    document.querySelector<HTMLButtonElement>('.deck-viewer-stub')?.click();
    await flushUpdates(); await flushUpdates();
    expect(renderStore.renderModel?.version).toBe(4);
    useSlidesManualEditingStore().recordPresentedRevision(4);
    await flushUpdates();
    expect(submitManualEditMock).toHaveBeenCalledTimes(2);
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

  it('queues a second edit and submits it after the first revision is presented', async () => {
    getRenderModelMock.mockResolvedValueOnce(makeRenderModel(3))
      .mockImplementation(async () => makeRenderModel(useSlidesStore().documentBuildState?.versionNumber ?? 3));
    const firstResult = createDeferred<{
      status: 'committed';
      commandId: string;
      documentId: string;
      revisionId: string;
      revision: number;
    }>();
    submitManualEditMock
      .mockReturnValueOnce(firstResult.promise)
      .mockImplementationOnce(async command => ({
        status: 'committed',
        commandId: command.commandId,
        documentId: command.documentId,
        revisionId: 'version-5',
        revision: 5,
      }));

    const slidesStore = useSlidesStore();
    const renderStore = useSlidesRenderStore();
    const manualStore = useSlidesManualEditingStore();
    const refreshDeck = vi.spyOn(slidesStore, 'refreshDeck').mockImplementation(
      async (_nodeId, expectedVersion) => {
        if (expectedVersion === undefined) return;
        slidesStore.documentBuildState = readyBuildState(expectedVersion);
        renderStore.renderModel = makeRenderModel(expectedVersion);
        manualStore.recordPresentedRevision(expectedVersion);
      },
    );
    slidesStore.currentDeckId = 'deck-1';
    slidesStore.documentBuildState = readyBuildState(3);
    slidesStore.deckPreview = makeDeckPreview(3);
    await flushUpdates();

    const button = document.querySelector<HTMLButtonElement>('.deck-viewer-stub');
    button?.click();
    button?.click();
    await flushUpdates();
    expect(submitManualEditMock).toHaveBeenCalledTimes(1);
    expect(manualStore.queuedIntents).toHaveLength(1);

    const firstCommand = submitManualEditMock.mock.calls[0]?.[0];
    if (!firstCommand) throw new Error('First queued command was not submitted');
    firstResult.resolve({
      status: 'committed',
      commandId: firstCommand.commandId,
      documentId: firstCommand.documentId,
      revisionId: 'version-4',
      revision: 4,
    });
    await flushUpdates();
    await flushUpdates();

    expect(submitManualEditMock).toHaveBeenCalledTimes(2);
    expect(submitManualEditMock.mock.calls[1]?.[0]).toMatchObject({
      expectedBase: {
        revisionId: 'version-4',
        revision: 4,
        sourceHash: '4'.padStart(64, '0'),
      },
    });
    expect(refreshDeck).toHaveBeenCalledWith('deck-1', 4);
  });
});
