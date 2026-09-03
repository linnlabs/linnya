// @vitest-environment jsdom

import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('./DeckOutline.vue', () => ({
  default: {
    name: 'DeckOutlineStub',
    template: '<div class="deck-outline-stub" />',
  },
}));

vi.mock('../preview/SlideStage.vue', () => ({
  default: {
    name: 'SlideStageStub',
    template: '<div class="slide-stage-stub" />',
  },
}));

vi.mock('../shared/SlidesStatusState.vue', () => ({
  default: {
    name: 'SlidesStatusStateStub',
    props: ['title'],
    template: '<div class="slides-status-state-stub">{{ title }}</div>',
  },
}));

vi.mock('../../features/documentBuildFailure', () => ({
  SlidesDraftFailureLog: {
    name: 'SlidesDraftFailureLogStub',
    template: '<div />',
  },
}));

vi.mock('../../features/previewRenderState', () => ({
  useSlidesPreviewLocalization: () => ({
    slidesPreviewMessage: () => '演示文稿渲染失败',
  }),
}));

vi.mock('../../features/konvaPreview', () => ({
  isKonvaNodeSupported: () => true,
}));

vi.mock('../../features/sourceSelection', () => ({
  resolveSourceSelectionAvailability: () => ({
    canEnableMode: false,
    label: '',
  }),
}));

vi.mock('@linnya/renderer-ui/icons', () => ({
  AddIcon: { template: '<span />' },
  HomeIcon: { template: '<span />' },
  MinusIcon: { template: '<span />' },
  SelectObjectIcon: { template: '<span />' },
}));

import DeckViewer from './DeckViewer.vue';
import { useSlidesRenderStore } from '../../store/slidesRenderStore';
import { useSlidesStore } from '../../store/slidesStore';

describe('DeckViewer document transition', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('进入另一份文稿的首次加载时立即撤下旧错误页和缩略图', async () => {
    const slidesStore = useSlidesStore();
    const renderStore = useSlidesRenderStore();
    slidesStore.currentDeckId = 'deck-old';
    slidesStore.deckPreview = {
      nodeId: 'deck-old',
      versionNumber: 1,
      title: 'Old deck',
      slideSize: { width: 10, height: 5.625 },
      slides: [{ slideId: 'slide-1', number: 1, elements: [] }],
      theme: {
        colors: {},
        fonts: { major: 'Arial', minor: 'Arial' },
      },
      warnings: [],
    };
    renderStore.renderError = 'old render failure';

    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(DeckViewer);
    app.mount(host);

    expect(host.querySelector('.slides-status-state-stub')).not.toBeNull();
    expect(host.querySelector('.deck-outline-stub')).not.toBeNull();

    slidesStore.deckPreview = null;
    slidesStore.deckLoading = true;
    renderStore.clearRenderModel();
    await nextTick();

    expect(host.querySelector('.slides-status-state-stub')).toBeNull();
    expect(host.querySelector('.deck-outline-stub')).toBeNull();
    expect(host.querySelector('.stage-loading-spacer')).not.toBeNull();
    expect(host.querySelector('.outline-loading-spacer')).not.toBeNull();

    app.unmount();
  });
});
