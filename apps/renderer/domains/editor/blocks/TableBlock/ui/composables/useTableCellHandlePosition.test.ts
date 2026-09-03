// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue';
import {
  useTableCellHandlePosition,
  type TableCellHandleFrameScheduler,
  type TableCellHandlePosition,
} from './useTableCellHandlePosition';

interface FrameHarness {
  scheduler: TableCellHandleFrameScheduler;
  step(): void;
  pendingCount(): number;
}

function createFrameHarness(): FrameHarness {
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
    },
    step() {
      const entries = Array.from(callbacks.values());
      callbacks.clear();
      entries.forEach((callback) => callback(0));
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

class ResizeObserverHarness implements ResizeObserver {
  static instances: ResizeObserverHarness[] = [];

  readonly observedElements = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverHarness.instances.push(this);
  }

  observe(target: Element): void {
    this.observedElements.add(target);
  }

  unobserve(target: Element): void {
    this.observedElements.delete(target);
  }

  disconnect(): void {
    this.observedElements.clear();
  }

  trigger(): void {
    this.callback([], this);
  }
}

function dispatchTransition(
  target: Element,
  type: 'transitionrun' | 'transitionend',
  propertyName: string
): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: propertyName });
  target.dispatchEvent(event);
}

function mountPositionHost(params: {
  showHandle: Ref<boolean>;
  activeCellPos: Ref<number | null>;
  editorRoot: Ref<HTMLElement | null>;
  getCellRect: (posInsideCell: number) => DOMRect | null;
  frame: TableCellHandleFrameScheduler;
}): { app: App; position: () => TableCellHandlePosition | null } {
  let position: Readonly<Ref<TableCellHandlePosition | null>> | null = null;
  const Host = defineComponent({
    setup() {
      position = useTableCellHandlePosition(params);
      return () => h('div');
    },
  });

  const mountTarget = document.createElement('div');
  document.body.appendChild(mountTarget);
  const app = createApp(Host);
  app.mount(mountTarget);

  return {
    app,
    position: () => position?.value ?? null,
  };
}

describe('useTableCellHandlePosition', () => {
  const mountedApps: App[] = [];

  beforeEach(() => {
    ResizeObserverHarness.instances.length = 0;
    vi.stubGlobal('ResizeObserver', ResizeObserverHarness);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  afterEach(() => {
    mountedApps.forEach((app) => app.unmount());
    mountedApps.length = 0;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('uses viewport cell coordinates and the cell start inner position', async () => {
    const frames = createFrameHarness();
    const requestedPositions: number[] = [];
    const editorRoot = document.createElement('div');
    document.body.appendChild(editorRoot);

    const host = mountPositionHost({
      showHandle: ref(true),
      activeCellPos: ref(12),
      editorRoot: ref(editorRoot),
      getCellRect: (posInsideCell) => {
        requestedPositions.push(posInsideCell);
        return new DOMRect(420, 160, 100, 30);
      },
      frame: frames.scheduler,
    });
    mountedApps.push(host.app);

    await nextTick();
    frames.step();

    expect(requestedPositions).toEqual([13]);
    expect(host.position()).toEqual({ left: 414, top: 154 });
  });

  it('remeasures every frame while an ancestor transform is transitioning', async () => {
    const frames = createFrameHarness();
    const pane = document.createElement('section');
    const editorRoot = document.createElement('div');
    pane.appendChild(editorRoot);
    document.body.appendChild(pane);
    let cellLeft = 500;

    const host = mountPositionHost({
      showHandle: ref(true),
      activeCellPos: ref(8),
      editorRoot: ref(editorRoot),
      getCellRect: () => new DOMRect(cellLeft, 120, 80, 30),
      frame: frames.scheduler,
    });
    mountedApps.push(host.app);

    await nextTick();
    frames.step();
    dispatchTransition(pane, 'transitionrun', 'transform');

    cellLeft = 508;
    frames.step();
    expect(host.position()?.left).toBe(502);
    expect(frames.pendingCount()).toBe(1);

    cellLeft = 516;
    frames.step();
    expect(host.position()?.left).toBe(510);

    dispatchTransition(pane, 'transitionend', 'transform');
    frames.step();
    expect(frames.pendingCount()).toBe(0);
  });

  it('remeasures after pane attributes or editor dimensions change', async () => {
    const frames = createFrameHarness();
    const pane = document.createElement('section');
    const editorRoot = document.createElement('div');
    pane.appendChild(editorRoot);
    document.body.appendChild(pane);
    let cellLeft = 300;

    const host = mountPositionHost({
      showHandle: ref(true),
      activeCellPos: ref(5),
      editorRoot: ref(editorRoot),
      getCellRect: () => new DOMRect(cellLeft, 100, 80, 30),
      frame: frames.scheduler,
    });
    mountedApps.push(host.app);

    await nextTick();
    frames.step();

    cellLeft = 620;
    pane.classList.add('workspace-stage__document--right');
    await nextTick();
    frames.step();
    expect(host.position()?.left).toBe(614);

    cellLeft = 640;
    ResizeObserverHarness.instances[0]?.trigger();
    frames.step();
    expect(host.position()?.left).toBe(634);
  });

  it('does not attach layout observers after unmounting during initial setup', async () => {
    const frames = createFrameHarness();
    const editorRoot = document.createElement('div');
    document.body.appendChild(editorRoot);
    const host = mountPositionHost({
      showHandle: ref(true),
      activeCellPos: ref(3),
      editorRoot: ref(editorRoot),
      getCellRect: () => new DOMRect(100, 100, 80, 30),
      frame: frames.scheduler,
    });

    host.app.unmount();
    await nextTick();

    expect(ResizeObserverHarness.instances).toHaveLength(0);
    expect(frames.pendingCount()).toBe(0);
  });
});
