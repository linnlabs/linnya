// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue';
import {
  useTableCoordinateHeaderLayoutSync,
  type TableCoordinateHeaderFrameScheduler,
} from './useTableCoordinateHeaderLayoutSync';

interface FrameHarness {
  scheduler: TableCoordinateHeaderFrameScheduler;
  step(ms?: number): void;
  pendingCount(): number;
}

function createFrameHarness(): FrameHarness {
  let now = 0;
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  return {
    scheduler: {
      request(callback) {
        const id = nextId;
        nextId += 1;
        callbacks.set(id, callback);
        return id;
      },
      cancel(id) {
        callbacks.delete(id);
      },
      now() {
        return now;
      },
    },
    step(ms = 16) {
      now += ms;
      const entries = Array.from(callbacks.entries());
      callbacks.clear();
      entries.forEach(([, callback]) => callback(now));
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

function mountLayoutSyncHost(params: {
  sidebarVisible: Ref<boolean>;
  sidebarWidth: Ref<number>;
  measure: () => void;
  frame: TableCoordinateHeaderFrameScheduler;
  sidebarTransitionMs?: number;
}): App {
  const Host = defineComponent({
    setup() {
      useTableCoordinateHeaderLayoutSync({
        sidebarVisible: () => params.sidebarVisible.value,
        sidebarWidth: () => params.sidebarWidth.value,
        measure: params.measure,
        frame: params.frame,
        sidebarTransitionMs: params.sidebarTransitionMs,
      });
      return () => h('div');
    },
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);
  return app;
}

describe('useTableCoordinateHeaderLayoutSync', () => {
  const mountedApps: App[] = [];

  afterEach(() => {
    mountedApps.forEach((app) => app.unmount());
    mountedApps.length = 0;
    document.body.innerHTML = '';
  });

  it('measures throughout sidebar visibility transitions and finishes with a final measurement', async () => {
    const sidebarVisible = ref(true);
    const sidebarWidth = ref(260);
    const frames = createFrameHarness();
    let measureCount = 0;

    mountedApps.push(mountLayoutSyncHost({
      sidebarVisible,
      sidebarWidth,
      measure: () => {
        measureCount += 1;
      },
      frame: frames.scheduler,
      sidebarTransitionMs: 30,
    }));

    sidebarVisible.value = false;
    await nextTick();

    frames.step(10);
    frames.step(10);
    frames.step(10);
    frames.step(10);

    expect(measureCount).toBe(3);
    expect(frames.pendingCount()).toBe(0);
  });

  it('coalesces sidebar width changes into one frame measurement', async () => {
    const sidebarVisible = ref(true);
    const sidebarWidth = ref(260);
    const frames = createFrameHarness();
    let measureCount = 0;

    mountedApps.push(mountLayoutSyncHost({
      sidebarVisible,
      sidebarWidth,
      measure: () => {
        measureCount += 1;
      },
      frame: frames.scheduler,
    }));

    sidebarWidth.value = 280;
    sidebarWidth.value = 300;
    await nextTick();

    expect(frames.pendingCount()).toBe(1);
    frames.step();

    expect(measureCount).toBe(1);
    expect(frames.pendingCount()).toBe(0);
  });

  it('cancels stale transition frames when a newer sidebar transition starts', async () => {
    const sidebarVisible = ref(true);
    const sidebarWidth = ref(260);
    const frames = createFrameHarness();
    let measureCount = 0;

    mountedApps.push(mountLayoutSyncHost({
      sidebarVisible,
      sidebarWidth,
      measure: () => {
        measureCount += 1;
      },
      frame: frames.scheduler,
      sidebarTransitionMs: 20,
    }));

    sidebarVisible.value = false;
    await nextTick();
    expect(frames.pendingCount()).toBe(1);

    sidebarVisible.value = true;
    await nextTick();
    expect(frames.pendingCount()).toBe(1);

    frames.step(10);
    frames.step(10);
    frames.step(10);

    expect(measureCount).toBe(2);
    expect(frames.pendingCount()).toBe(0);
  });
});
