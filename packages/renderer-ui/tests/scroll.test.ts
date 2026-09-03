// @vitest-environment jsdom

import { createApp, ref, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const overlayScrollbarsMock = vi.hoisted(() => {
  const viewport = document.createElement('div');
  const horizontalScrollbar = document.createElement('div');
  const verticalScrollbar = document.createElement('div');
  const instance = {
    destroy: vi.fn(),
    elements: vi.fn(() => ({
      viewport,
      scrollbarHorizontal: { scrollbar: horizontalScrollbar },
      scrollbarVertical: { scrollbar: verticalScrollbar },
    })),
    update: vi.fn(),
  };
  const factory = Object.assign(vi.fn(() => instance), {
    valid: vi.fn((candidate: unknown) => candidate === instance),
  });

  return {
    factory,
    horizontalScrollbar,
    instance,
    verticalScrollbar,
    viewport,
  };
});

vi.mock('overlayscrollbars', () => ({
  OverlayScrollbars: overlayScrollbarsMock.factory,
}));

import {
  DEFAULT_OVERLAY_SCROLL_VIEWPORT_OPTIONS,
  type OverlayScrollViewportController,
  useOverlayScrollViewport,
} from '../src/scroll';

interface MountedScrollCapability {
  readonly app: App<Element>;
  readonly controller: OverlayScrollViewportController;
  readonly host: HTMLElement;
  readonly viewportMount: HTMLElement;
  readonly viewportRef: ReturnType<typeof ref<HTMLElement | null>>;
}

const mountedApps: App<Element>[] = [];
let animationFrameCallbacks: FrameRequestCallback[] = [];

function mountScrollCapability(
  options?: Parameters<typeof useOverlayScrollViewport>[0]['options'],
): MountedScrollCapability {
  const host = document.createElement('section');
  const viewportMount = document.createElement('div');
  host.append(viewportMount);

  const hostRef = ref<HTMLElement | null>(host);
  const viewportMountRef = ref<HTMLElement | null>(viewportMount);
  const viewportRef = ref<HTMLElement | null>(null);
  let controller: OverlayScrollViewportController | undefined;

  const app = createApp({
    setup() {
      controller = useOverlayScrollViewport({
        bindings: { hostRef, viewportMountRef, viewportRef },
        options,
      });
      return () => null;
    },
  });
  app.mount(document.createElement('div'));
  mountedApps.push(app);

  if (!controller) {
    throw new Error('Renderer UI scroll capability did not initialize during Vue setup');
  }

  return { app, controller, host, viewportMount, viewportRef };
}

describe('Renderer UI overlay scroll capability', () => {
  beforeEach(() => {
    animationFrameCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrameCallbacks.push(callback);
      return animationFrameCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    overlayScrollbarsMock.factory.mockClear();
    overlayScrollbarsMock.factory.valid.mockClear();
    overlayScrollbarsMock.instance.destroy.mockClear();
    overlayScrollbarsMock.instance.elements.mockClear();
    overlayScrollbarsMock.instance.update.mockClear();
  });

  afterEach(() => {
    while (mountedApps.length > 0) mountedApps.pop()?.unmount();
    vi.unstubAllGlobals();
  });

  it('uses the existing viewport element and merges local options without losing defaults', () => {
    const mounted = mountScrollCapability({
      overflow: { y: 'hidden' },
      scrollbars: { autoHideDelay: 240 },
    });

    expect(mounted.controller.init()).toBe(overlayScrollbarsMock.viewport);
    expect(mounted.viewportRef.value).toBe(overlayScrollbarsMock.viewport);
    expect(overlayScrollbarsMock.factory).toHaveBeenCalledWith(
      {
        target: mounted.host,
        elements: { viewport: mounted.viewportMount },
      },
      {
        ...DEFAULT_OVERLAY_SCROLL_VIEWPORT_OPTIONS,
        overflow: {
          ...DEFAULT_OVERLAY_SCROLL_VIEWPORT_OPTIONS.overflow,
          y: 'hidden',
        },
        scrollbars: {
          ...DEFAULT_OVERLAY_SCROLL_VIEWPORT_OPTIONS.scrollbars,
          autoHideDelay: 240,
        },
      },
    );
  });

  it('does not construct a runtime instance before both DOM bindings exist', () => {
    const hostRef = ref<HTMLElement | null>(null);
    const viewportMountRef = ref<HTMLElement | null>(null);
    const viewportRef = ref<HTMLElement | null>(document.createElement('div'));
    let controller: OverlayScrollViewportController | undefined;
    const app = createApp({
      setup() {
        controller = useOverlayScrollViewport({
          bindings: { hostRef, viewportMountRef, viewportRef },
        });
        return () => null;
      },
    });
    app.mount(document.createElement('div'));
    mountedApps.push(app);

    expect(controller?.init()).toBeNull();
    expect(viewportRef.value).toBeNull();
    expect(overlayScrollbarsMock.factory).not.toHaveBeenCalled();
  });

  it('coalesces repeated update requests into one animation frame', () => {
    const { controller } = mountScrollCapability();
    controller.init();

    controller.scheduleUpdate();
    controller.scheduleUpdate();

    expect(animationFrameCallbacks).toHaveLength(1);
    expect(overlayScrollbarsMock.instance.update).not.toHaveBeenCalled();

    animationFrameCallbacks[0]?.(0);
    expect(overlayScrollbarsMock.instance.update).toHaveBeenCalledTimes(1);
  });

  it('destroys the shared runtime and clears the exposed viewport on Vue unmount', () => {
    const mounted = mountScrollCapability();
    mounted.controller.init();

    mounted.app.unmount();
    mountedApps.splice(mountedApps.indexOf(mounted.app), 1);

    expect(overlayScrollbarsMock.instance.destroy).toHaveBeenCalledTimes(1);
    expect(mounted.viewportRef.value).toBeNull();
    expect(mounted.controller.getInstance()).toBeNull();
  });
});
