import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import type { PresentationRenderModel } from '../types/render';

const getRenderModelMock = vi.fn();

vi.mock('../services/slidesRenderApi', () => ({
  slidesRenderApi: {
    getRenderModel: getRenderModelMock,
  },
}));

function makeModel(id: string): PresentationRenderModel {
  return {
    presentationId: id,
    title: id,
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: [{
      slideId: `${id}-s1`,
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('slidesRenderStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', {
      electronAPI: {
        onApiPortSet: vi.fn(),
      },
    });
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('keeps the latest render-model request and ignores stale responses', async () => {
    const first = createDeferred<PresentationRenderModel>();
    const second = createDeferred<PresentationRenderModel>();
    getRenderModelMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { useSlidesRenderStore } = await import('./slidesRenderStore');
    const store = useSlidesRenderStore();

    const firstLoad = store.loadRenderModel('node-old');
    const secondLoad = store.loadRenderModel('node-new');

    second.resolve(makeModel('node-new'));
    await secondLoad;
    expect(store.renderModel?.presentationId).toBe('node-new');

    first.resolve(makeModel('node-old'));
    await firstLoad;
    expect(store.renderModel?.presentationId).toBe('node-new');
  });

  it('clears render model when slidesStore currentDeckId becomes null', async () => {
    const { useSlidesRenderStore } = await import('./slidesRenderStore');
    const { useSlidesStore } = await import('./slidesStore');
    const renderStore = useSlidesRenderStore();
    const slidesStore = useSlidesStore();

    renderStore.renderModel = makeModel('node-1');
    slidesStore.currentDeckId = 'node-1';
    await nextTick();

    slidesStore.currentDeckId = null;
    await nextTick();

    expect(renderStore.renderModel).toBeNull();
    expect(renderStore.renderError).toBeNull();
    expect(renderStore.renderLoading).toBe(false);
  });
});
