// @vitest-environment jsdom

import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  OverlayScrollViewportController,
  UseOverlayScrollViewportParams,
} from '@linnya/renderer-ui/scroll';
import DeckOutline from './DeckOutline.vue';
import { useSlidesStore } from '../../store/slidesStore';

interface MockOverlayController extends OverlayScrollViewportController {
  init: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  scheduleUpdate: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  getViewport: ReturnType<typeof vi.fn>;
  getInstance: ReturnType<typeof vi.fn>;
}

interface OverlayCall {
  params: UseOverlayScrollViewportParams;
  controller: MockOverlayController;
}

const overlayMockState = vi.hoisted(() => {
  return {
    calls: [] as OverlayCall[],
  };
});

vi.mock('@linnya/renderer-ui/scroll', () => {
  return {
    useOverlayScrollViewport: (params: UseOverlayScrollViewportParams): OverlayScrollViewportController => {
      const controller: MockOverlayController = {
        init: vi.fn(() => {
          params.bindings.viewportRef.value = params.bindings.viewportMountRef.value;
          return params.bindings.viewportMountRef.value;
        }),
        update: vi.fn(() => {
          params.bindings.viewportRef.value = params.bindings.viewportMountRef.value;
          return params.bindings.viewportMountRef.value;
        }),
        scheduleUpdate: vi.fn(),
        beginStructureTransition: vi.fn(),
        finishStructureTransition: vi.fn(),
        destroy: vi.fn(),
        getViewport: vi.fn(() => params.bindings.viewportRef.value),
        getInstance: vi.fn(() => null),
      };

      overlayMockState.calls.push({
        params,
        controller,
      });

      return controller;
    },
  };
});

vi.mock('./SlideThumbnail.vue', () => {
  return {
    default: {
      name: 'SlideThumbnailStub',
      template: '<div class="slide-thumbnail-stub" />',
    },
  };
});

async function flushDomUpdates(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe('DeckOutline overlay scroll adoption', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    overlayMockState.calls.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('mounts shared overlay scroll host and viewport around the thumbnail list', async () => {
    const slidesStore = useSlidesStore();
    slidesStore.deckPreview = {
      nodeId: 'deck-1',
      versionNumber: 1,
      title: 'Deck',
      slideSize: { width: 10, height: 7.5 },
      slides: [
        { slideId: 'slide-1', number: 1, elements: [] },
        { slideId: 'slide-2', number: 2, elements: [] },
      ],
      theme: {
        colors: {},
        fonts: { major: 'sans-serif', minor: 'sans-serif' },
      },
      warnings: [],
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(DeckOutline);
    app.mount(container);
    await flushDomUpdates();

    const host = container.querySelector('.deck-outline-scroll-host');
    const viewport = container.querySelector('.outline-list');
    const overlayCall = overlayMockState.calls[0];

    expect(host).not.toBeNull();
    expect(host?.hasAttribute('data-overlayscrollbars-initialize')).toBe(false);
    expect(host?.getAttribute('data-overlay-scroll-theme')).toBe('linnya');
    expect(host?.getAttribute('data-overlay-scroll-visibility')).toBe('strict-hover');
    expect(viewport).not.toBeNull();
    expect(viewport?.hasAttribute('data-overlayscrollbars-initialize')).toBe(true);
    expect(overlayCall).toBeDefined();
    expect(overlayCall.controller.init).toHaveBeenCalled();
    expect(overlayCall.params.bindings.hostRef.value).toBe(host);
    expect(overlayCall.params.bindings.viewportMountRef.value).toBe(viewport);
    expect(overlayCall.params.bindings.viewportRef.value).toBe(viewport);

    app.unmount();
  });
});
