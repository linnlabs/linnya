// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { usePanelPositioning } from './usePanelPositioning';

class ResizeObserverHarness {
  static instances = [];

  observedElements = new Set();

  constructor(callback) {
    this.callback = callback;
    ResizeObserverHarness.instances.push(this);
  }

  observe(target) {
    this.observedElements.add(target);
  }

  unobserve(target) {
    this.observedElements.delete(target);
  }

  disconnect() {
    this.observedElements.clear();
  }

  trigger() {
    this.callback([], this);
  }
}

function createFrameHarness() {
  let nextId = 1;
  const callbacks = new Map();

  return {
    request(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    step() {
      const pendingCallbacks = Array.from(callbacks.values());
      callbacks.clear();
      pendingCallbacks.forEach(callback => callback(0));
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

function mountPositioningHost(options) {
  const Host = defineComponent({
    setup() {
      usePanelPositioning(options);
      return () => h('div');
    },
  });
  const mountTarget = document.createElement('div');
  document.body.appendChild(mountTarget);
  const app = createApp(Host);
  app.mount(mountTarget);
  return app;
}

describe('usePanelPositioning', () => {
  const mountedApps = [];
  let frames;

  beforeEach(() => {
    ResizeObserverHarness.instances.length = 0;
    frames = createFrameHarness();
    vi.stubGlobal('ResizeObserver', ResizeObserverHarness);
    vi.stubGlobal('requestAnimationFrame', frames.request);
    vi.stubGlobal('cancelAnimationFrame', frames.cancel);
  });

  afterEach(() => {
    mountedApps.forEach(app => app.unmount());
    mountedApps.length = 0;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('observes the current editor owner viewport and coalesces pane resizes by frame', async () => {
    const layoutViewport = document.createElement('section');
    const recalculateAllPositions = vi.fn();
    const app = mountPositioningHost({
      editor: ref({ view: { dom: document.createElement('div') } }),
      panelPositionManager: ref({
        getLayoutViewportElement: () => layoutViewport,
        recalculateAllPositions,
      }),
    });
    mountedApps.push(app);

    await nextTick();
    await nextTick();

    const observer = ResizeObserverHarness.instances[0];
    expect(observer?.observedElements.has(layoutViewport)).toBe(true);

    observer?.trigger();
    observer?.trigger();
    expect(frames.pendingCount()).toBe(1);

    frames.step();
    await Promise.resolve();
    expect(recalculateAllPositions).toHaveBeenCalledTimes(1);
    expect(recalculateAllPositions).toHaveBeenCalledWith(false);
  });

  it('does not attach an owner observer after unmount during initial setup', async () => {
    const app = mountPositioningHost({
      editor: ref({ view: { dom: document.createElement('div') } }),
      panelPositionManager: ref({
        getLayoutViewportElement: () => document.createElement('section'),
        recalculateAllPositions: vi.fn(),
      }),
    });

    app.unmount();
    await nextTick();

    expect(ResizeObserverHarness.instances).toHaveLength(0);
    expect(frames.pendingCount()).toBe(0);
  });
});
