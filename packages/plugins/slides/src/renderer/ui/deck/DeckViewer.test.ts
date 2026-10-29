// @vitest-environment jsdom
import { installTestPresentation } from '../../features/documentRuntime/testing/installTestPresentation';

import { createApp, h, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../features/deckNavigator', () => ({
  DeckNavigatorBar: {
    name: 'DeckNavigatorBarStub',
    template: '<div class="deck-navigator-stub" />',
  },
  SlideGridView: {
    name: 'SlideGridViewStub',
    template: '<div class="slide-grid-stub" />',
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

vi.mock('../../features/sourceSelection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/sourceSelection')>()),
  resolveSourceSelectionAvailability: () => ({
    canEnableMode: false,
    label: '',
  }),
}));

vi.mock('@linnya/renderer-ui/icons', () => ({
  AddIcon: { template: '<span />' },
  ChevronIcon: { template: '<span />' },
  EditIcon: { template: '<span />' },
  MinusIcon: { template: '<span />' },
  SelectObjectIcon: { template: '<span />' },
}));

import DeckViewer from './DeckViewer.vue';
import { useSlidesStore } from '../../store/slidesStore';
import { useSlidesManualEditingStore, provideManualEditSubmission } from '../../features/manualEditing';
import { useSlidesUiStore } from '../../store/slidesUiStore';

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
    installTestPresentation({ documentId: 'deck-old' });
    installTestPresentation({ preview: {
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
    } });
    installTestPresentation({ error: 'old render failure' });

    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({ setup() {
      provideManualEditSubmission({
        flush: async () => {},
        enqueue: () => { throw new Error('Stubbed Stage must not submit an edit'); },
        refreshPresentation: async () => undefined,
      });
      return () => h(DeckViewer);
    } });
    app.mount(host);

    expect(host.querySelector('.slides-status-state-stub')).not.toBeNull();
    expect(host.querySelector('.deck-navigator-stub')).not.toBeNull();

    const zoom = host.querySelector<HTMLInputElement>('input[type="range"]');
    if (!zoom) throw new Error('Zoom slider missing');
    zoom.value = '150';
    zoom.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(useSlidesUiStore().zoomLevel).toBe(1.5);
    expect(useSlidesUiStore().zoomMode).toBe('manual');
    useSlidesUiStore().setZoom(2, 'manual');
    await nextTick();
    expect(zoom.valueAsNumber).toBe(200);

    installTestPresentation({ preview: null });
    installTestPresentation({ loading: true });
    await nextTick();

    expect(host.querySelector('.slides-status-state-stub')).toBeNull();
    expect(host.querySelector('.deck-navigator-stub')).toBeNull();
    expect(host.querySelector('.stage-loading-spacer')).not.toBeNull();
    expect(host.querySelector('.navigator-loading-spacer')).not.toBeNull();

    app.unmount();
  });

  it('没有编辑模式开关：ready 的生成文稿自动可手动编辑，刷新自己的修订时不闪成只读', async () => {
    const slidesStore = useSlidesStore();
    const manualStore = useSlidesManualEditingStore();
    installTestPresentation({ documentId: 'deck-1' });
    installTestPresentation({ buildState: {
      state: 'ready',
      presentationId: 'deck-1',
      versionId: 'revision-2',
      versionNumber: 2,
      sourceHash: 'a'.repeat(64),
    } });
    installTestPresentation({ preview: {
      nodeId: 'deck-1', versionNumber: 2, title: 'Deck',
      slideSize: { width: 10, height: 5.625 },
      slides: [{ slideId: 'slide-1', number: 1, elements: [] }],
      theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
      warnings: [],
    } });
    installTestPresentation({ renderModel: {
      presentationId: 'deck-1', title: 'Deck', version: 2, sourceKind: 'generated',
      slideSize: { width: 10, height: 5.625, unit: 'in' },
      slides: [{
        slideId: 'slide-1', index: 0, layoutKey: 'freeform',
        background: { paint: { type: 'none' } },
        elements: [{
          id: 'authoring-overview-card', kind: 'shape', zIndex: 1,
          box: { x: 1, y: 1, w: 2, h: 1, unit: 'in' },
          geometry: { type: 'preset', name: 'rect' },
          sourceSpan: { startLine: 3, endLine: 3 },
          authoringRef: { slideKey: 'overview', editKey: 'card', targetKind: 'shape' },
          authoringEdit: { capabilities: ['translate'] },
        }],
      }],
      capabilities: {
        hasSemanticRender: true, hasReferencePreview: false,
        hasHitTest: true, hasSelection: true,
      },
    } });

    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({ setup() {
      provideManualEditSubmission({
        flush: async () => {},
        enqueue: () => { throw new Error('Stubbed Stage must not submit an edit'); },
        refreshPresentation: async () => undefined,
      });
      return () => h(DeckViewer);
    } });
    app.mount(host);
    await nextTick();

    expect(host.querySelector('.stage-zoom-slider__edit-btn')).toBeNull();
    expect(host.querySelector('.stage-zoom-slider__select-btn')).toBeNull();
    expect(manualStore.enabled).toBe(true);

    installTestPresentation({ buildState: {
      ...slidesStore.documentBuildState,
      state: 'ready',
      versionId: 'revision-3',
      versionNumber: 3,
    } });
    await nextTick();
    expect(manualStore.enabled).toBe(true);

    const generated = slidesStore.renderModel;
    if (!generated) throw new Error('Render model fixture missing');
    installTestPresentation({ renderModel: { ...generated, version: 3, sourceKind: 'imported' } });
    await nextTick();
    expect(manualStore.enabled).toBe(false);

    app.unmount();
  });

  it('平铺视图替换舞台并隐藏舞台工具条；百分比菜单切换适应窗口与固定档位', async () => {
    const uiStore = useSlidesUiStore();
    installTestPresentation({ documentId: 'deck-1' });
    installTestPresentation({ preview: {
      nodeId: 'deck-1', versionNumber: 1, title: 'Deck',
      slideSize: { width: 10, height: 5.625 },
      slides: [{ slideId: 'slide-1', number: 1, elements: [] }],
      theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
      warnings: [],
    } });

    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({ setup() {
      provideManualEditSubmission({
        flush: async () => {},
        enqueue: () => { throw new Error('Stubbed Stage must not submit an edit'); },
        refreshPresentation: async () => undefined,
      });
      return () => h(DeckViewer);
    } });
    app.mount(host);
    await nextTick();

    expect(host.querySelector('.slide-stage-stub')).not.toBeNull();
    const trigger = host.querySelector<HTMLButtonElement>('.stage-zoom-menu__trigger');
    if (!trigger) throw new Error('Zoom percentage trigger missing');
    trigger.click();
    await nextTick();
    const option = (label: string) => [...host.querySelectorAll<HTMLElement>('.stage-zoom-menu__panel [role="menuitem"]')]
      .find(element => element.textContent?.trim() === label);
    option('150%')?.click();
    await nextTick();
    expect(uiStore.zoomMode).toBe('manual');
    expect(uiStore.zoomLevel).toBe(1.5);
    expect(host.querySelector('.stage-zoom-menu__panel')).toBeNull();

    trigger.click();
    await nextTick();
    option('适应窗口')?.click();
    await nextTick();
    expect(uiStore.zoomMode).toBe('fit');

    uiStore.setDeckViewMode('grid');
    await nextTick();
    expect(host.querySelector('.slide-grid-stub')).not.toBeNull();
    expect(host.querySelector('.slide-stage-stub')).toBeNull();
    expect(host.querySelector('.stage-zoom-slider')).toBeNull();
    expect(host.querySelector('.deck-navigator-stub')).not.toBeNull();

    app.unmount();
  });
});
