// @vitest-environment jsdom

import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  OverlayScrollViewportController,
  UseOverlayScrollViewportParams,
} from '@linnya/renderer-ui/scroll';
import DeckFilmstrip from './DeckFilmstrip.vue';
import { useSlidesStore } from '../../../store/slidesStore';

interface OverlayCall {
  params: UseOverlayScrollViewportParams;
  controller: OverlayScrollViewportController;
}

const overlayMockState = vi.hoisted(() => ({ calls: [] as OverlayCall[] }));

vi.mock('@linnya/renderer-ui/scroll', () => ({
  useOverlayScrollViewport: (params: UseOverlayScrollViewportParams): OverlayScrollViewportController => {
    const adopt = () => {
      params.bindings.viewportRef.value = params.bindings.viewportMountRef.value;
      return params.bindings.viewportMountRef.value;
    };
    const controller: OverlayScrollViewportController = {
      init: vi.fn(adopt),
      update: vi.fn(adopt),
      scheduleUpdate: vi.fn(),
      beginStructureTransition: vi.fn(),
      finishStructureTransition: vi.fn(),
      destroy: vi.fn(),
      getViewport: vi.fn(() => params.bindings.viewportRef.value),
      getInstance: vi.fn(() => null),
    };
    overlayMockState.calls.push({ params, controller });
    return controller;
  },
}));

vi.mock('@app/localization', () => ({
  useLocalization: () => ({
    message: (_key: string, fallback: string, params?: Record<string, string | number>) =>
      fallback.replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? '')),
  }),
}));

vi.mock('./SlideThumbnail.vue', () => ({
  default: {
    name: 'SlideThumbnailStub',
    props: ['width', 'height', 'bitmap'],
    template: '<div class="slide-thumbnail-stub" :data-width="width" :data-height="height" />',
  },
}));

async function flushDomUpdates(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function seedDeck(slideCount: number, slideSize = { width: 10, height: 5.625 }): void {
  useSlidesStore().deckPreview = {
    nodeId: 'deck-1',
    versionNumber: 1,
    title: 'Deck',
    slideSize,
    slides: Array.from({ length: slideCount }, (_, index) => ({
      slideId: `slide-${index + 1}`,
      number: index + 1,
      elements: [],
    })),
    theme: { colors: {}, fonts: { major: 'sans-serif', minor: 'sans-serif' } },
    warnings: [],
  };
}

describe('DeckFilmstrip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    overlayMockState.calls.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    // jsdom 没有元素滚动 API；Chromium 中由视口原生实现。
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    document.body.innerHTML = '';
  });

  it('mounts the shared overlay scroll host around a horizontal thumbnail viewport', async () => {
    seedDeck(2, { width: 10, height: 7.5 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(DeckFilmstrip);
    app.mount(container);
    await flushDomUpdates();

    const host = container.querySelector('.deck-filmstrip');
    const viewport = container.querySelector<HTMLElement>('.deck-filmstrip__viewport');
    const overlayCall = overlayMockState.calls[0];

    expect(host?.hasAttribute('data-overlayscrollbars-initialize')).toBe(false);
    expect(host?.getAttribute('data-overlay-scroll-visibility')).toBe('strict-hover');
    expect(viewport?.hasAttribute('data-overlayscrollbars-initialize')).toBe(true);
    expect(viewport?.style.overflowX).toBe('auto');
    expect(overlayCall?.controller.init).toHaveBeenCalled();
    expect(overlayCall?.params.bindings.hostRef.value).toBe(host);
    expect(overlayCall?.params.bindings.viewportMountRef.value).toBe(viewport);
    // 长列表需要可见的横向滚动条，而不是沿用共享默认的纵向滚动。
    expect(overlayCall?.params.options?.overflow).toEqual({ x: 'scroll', y: 'hidden' });
    // 4:3 文稿保持 72px 页面条高度，宽度随比例变化。
    expect(container.querySelector('.slide-thumbnail-stub')?.getAttribute('data-width')).toBe('96');
    expect(container.querySelector('.slide-thumbnail-stub')?.getAttribute('data-height')).toBe('72');

    app.unmount();
  });

  it('marks the current slide and moves it with click and arrow keys', async () => {
    seedDeck(3);
    const slidesStore = useSlidesStore();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(DeckFilmstrip);
    app.mount(container);
    await flushDomUpdates();

    const items = () => [...container.querySelectorAll<HTMLButtonElement>('.deck-filmstrip__item')];
    expect(items().map(item => item.getAttribute('aria-current'))).toEqual(['true', null, null]);
    expect(items().map(item => item.tabIndex)).toEqual([0, -1, -1]);
    expect(items()[1]?.getAttribute('aria-label')).toBe('第 2 页');

    items()[2]?.click();
    expect(slidesStore.currentSlideIndex).toBe(2);

    const viewport = container.querySelector<HTMLElement>('.deck-filmstrip__viewport');
    viewport?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await flushDomUpdates();
    expect(slidesStore.currentSlideIndex).toBe(1);
    expect(document.activeElement).toBe(items()[1]);

    viewport?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(slidesStore.currentSlideIndex).toBe(0);

    app.unmount();
  });
});
