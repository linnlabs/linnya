// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type {
  RenderVirtualizationEngine,
  RenderVirtualizationEngineSnapshot,
  RenderVirtualizationKeepAlivePort,
  RenderVirtualizationRefreshReason,
} from '../../../RenderVirtualization';
import { setupShellPendingProjectionBridge } from './setupShellPendingProjectionBridge';
import { setFlag } from '../../../../ui/services/editorFeatureFlags';
import { useRevisionStore } from '../../store/useRevisionStore';
import type { PendingProjectionResult, RevisionStore } from '../../store/types';

vi.mock('../../store/useRevisionStore', () => ({
  useRevisionStore: vi.fn(),
}));

class EventBusMock {
  private readonly listeners = new Map<string, Set<() => void>>();

  on(eventName: string, listener: () => void): void {
    const listeners = this.listeners.get(eventName) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
  }

  off(eventName: string, listener: () => void): void {
    this.listeners.get(eventName)?.delete(listener);
  }

  emit(eventName: string): void {
    this.listeners.get(eventName)?.forEach((listener) => listener());
  }
}

function createSnapshot(
  visibleBlockIds: readonly string[],
  hydratedBlockIds: readonly string[] = visibleBlockIds,
  refreshReason: RenderVirtualizationRefreshReason = { type: 'manual', label: 'test' }
): RenderVirtualizationEngineSnapshot {
  return {
    version: 1,
    reason: 'test',
    refreshReason,
    capturedAt: 1,
    virtualizationEnabled: true,
    visibleBlockIds,
    hydratedBlockIds,
    pinnedBlockIds: [],
    requestedHydrateBlockIds: [],
    requestedDehydrateBlockIds: [],
    scrollTop: 0,
    viewportTop: 0,
    viewportBottom: 600,
    totalEstimatedHeight: 1000,
  };
}

function createKeepAlivePortMock(): RenderVirtualizationKeepAlivePort {
  return {
    acquire: vi.fn(() => true),
    release: vi.fn(() => true),
    releaseReason: vi.fn(() => []),
    hasReason: vi.fn(() => false),
  };
}

function createRenderEngineMock(
  initialBlockIds: readonly string[] = [],
  options: {
    publishOnScheduleRefresh?: boolean
    refreshNowBlockIds?: readonly string[]
  } = {}
) {
  let snapshot = createSnapshot(initialBlockIds);
  let refreshNowBlockIds = options.refreshNowBlockIds;
  const listeners = new Set<(nextSnapshot: RenderVirtualizationEngineSnapshot) => void>();
  const publishOnScheduleRefresh = options.publishOnScheduleRefresh ?? true;
  const engine: RenderVirtualizationEngine = {
    keepAlivePort: createKeepAlivePortMock(),
    scheduleRefresh: vi.fn(() => {
      if (!publishOnScheduleRefresh) return;
      listeners.forEach((listener) => listener(snapshot));
    }),
    refreshNow: vi.fn(() => {
      if (refreshNowBlockIds) {
        snapshot = {
          ...createSnapshot(refreshNowBlockIds),
          version: snapshot.version + 1,
        };
      }
      listeners.forEach((listener) => listener(snapshot));
      return snapshot;
    }),
    remeasureHydratedWindow: vi.fn(),
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    cleanup: vi.fn(),
  };

  return {
    engine,
    setRefreshNowBlockIds(blockIds: readonly string[]): void {
      refreshNowBlockIds = blockIds;
    },
    emit(blockIds: readonly string[]): void {
      snapshot = {
        ...createSnapshot(blockIds),
        version: snapshot.version + 1,
      };
      listeners.forEach((listener) => listener(snapshot));
    },
    emitSnapshot(params: {
      visibleBlockIds: readonly string[]
      hydratedBlockIds: readonly string[]
      refreshReason?: RenderVirtualizationRefreshReason
    }): void {
      snapshot = {
        ...createSnapshot(params.visibleBlockIds, params.hydratedBlockIds, params.refreshReason),
        version: snapshot.version + 1,
      };
      listeners.forEach((listener) => listener(snapshot));
    },
  };
}

function installRafQueue(): {
  flushNext: () => void;
  flushAll: () => void;
  size: () => number;
} {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  return {
    flushNext() {
      callbacks.shift()?.(16);
    },
    flushAll() {
      for (let index = 0; index < 20 && callbacks.length > 0; index += 1) {
        callbacks.shift()?.(16);
      }
    },
    size() {
      return callbacks.length;
    },
  };
}

interface TestIdleDeadline {
  didTimeout: boolean
  timeRemaining: () => number
}

type TestIdleCallback = (deadline: TestIdleDeadline) => void;

function installIdleQueue(): {
  flushNext: () => void;
  flushAll: () => void;
  size: () => number;
  cancelSpy: ReturnType<typeof vi.fn>;
} {
  let nextHandle = 1;
  const callbacks = new Map<number, TestIdleCallback>();
  const cancelSpy = vi.fn((handle: number) => {
    callbacks.delete(handle);
  });

  vi.stubGlobal('requestIdleCallback', (callback: TestIdleCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  });
  vi.stubGlobal('cancelIdleCallback', cancelSpy);

  const makeDeadline = (): TestIdleDeadline => ({
    didTimeout: false,
    timeRemaining: () => 8,
  });

  return {
    flushNext() {
      const [handle, callback] = callbacks.entries().next().value ?? [];
      if (typeof handle !== 'number' || !callback) return;
      callbacks.delete(handle);
      callback(makeDeadline());
    },
    flushAll() {
      for (let index = 0; index < 20 && callbacks.size > 0; index += 1) {
        this.flushNext();
      }
    },
    size() {
      return callbacks.size;
    },
    cancelSpy,
  };
}

async function waitForQueuedFrame(raf: { size: () => number }): Promise<void> {
  for (let index = 0; index < 8 && raf.size() === 0; index += 1) {
    await Promise.resolve();
  }
}

function createProjectionResult(blockIds: readonly string[]): PendingProjectionResult {
  return {
    requestedCount: blockIds.length,
    batchCount: blockIds.length,
    projectedCount: blockIds.length,
    skippedCount: 0,
    failedCount: 0,
    totalMs: 0,
    flushMs: 0,
  };
}

function createRevisionStoreMock(params: {
  projectPendingRevisionsForBlocks: ReturnType<typeof vi.fn>
  pendingIds: Set<string>
  activeIds?: Set<string>
}): RevisionStore {
  return {
    hasCanonicalPending: (blockId: string) => params.pendingIds.has(blockId),
    getRevisionState: (blockId: string) => {
      if (!params.activeIds?.has(blockId)) return null;
      return {
        blockId,
        revisionId: `revision-${blockId}`,
        status: 'pending',
        createdAt: 1,
      };
    },
    projectPendingRevisionsForBlocks: params.projectPendingRevisionsForBlocks,
  } as unknown as RevisionStore;
}

describe('setupShellPendingProjectionBridge', () => {
  beforeEach(() => {
    setFlag('rootBlockShellEnabled', true);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    setFlag('rootBlockShellEnabled', false);
    vi.unstubAllGlobals();
    vi.mocked(useRevisionStore).mockReset();
  });

  it('projects hydrated render-window blocks after pending revisions are loaded', () => {
    const raf = installRafQueue();
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const pendingIds = new Set<string>();
    const projectPendingRevisionsForBlocks = vi.fn(async (blockIds: string[]) => createProjectionResult(blockIds));
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds,
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock(['block-a']);

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    raf.flushAll();
    expect(projectPendingRevisionsForBlocks).not.toHaveBeenCalled();

    pendingIds.add('block-a');
    eventBus.emit('pending-revisions-loaded');
    raf.flushAll();

    expect(renderEngine.engine.scheduleRefresh).toHaveBeenCalledWith({
      type: 'content-loaded',
      source: 'pending-revisions',
    });
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledWith(['block-a']);

    cleanup();
  });

  it('replays the current hydrated window when bridge starts after pending already exists', () => {
    const raf = installRafQueue();
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const projectPendingRevisionsForBlocks = vi.fn(async (blockIds: string[]) => createProjectionResult(blockIds));
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds: new Set(['already-visible']),
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock(['already-visible']);

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    raf.flushAll();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledWith(['already-visible']);

    cleanup();
  });

  it('uses idle scheduling for shell pending projection when the browser supports it', () => {
    const raf = installRafQueue();
    const idle = installIdleQueue();
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const projectPendingRevisionsForBlocks = vi.fn(async (blockIds: string[]) => createProjectionResult(blockIds));
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds: new Set(['idle-visible']),
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock(['idle-visible']);

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    expect(raf.size()).toBe(0);
    expect(idle.size()).toBe(1);
    expect(projectPendingRevisionsForBlocks).not.toHaveBeenCalled();

    idle.flushAll();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledWith(['idle-visible']);

    cleanup();
  });

  it('uses frame scheduling for typed scroll correction snapshots without relying on label text', () => {
    const raf = installRafQueue();
    const idle = installIdleQueue();
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const projectPendingRevisionsForBlocks = vi.fn(async (blockIds: string[]) => createProjectionResult(blockIds));
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds: new Set(['correction-visible']),
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock();

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    renderEngine.emitSnapshot({
      visibleBlockIds: ['correction-visible'],
      hydratedBlockIds: ['correction-visible'],
      refreshReason: {
        type: 'scroll',
        source: 'native',
        isCorrection: true,
      },
    });

    expect(idle.size()).toBe(0);
    expect(raf.size()).toBe(1);
    raf.flushAll();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledWith(['correction-visible']);

    cleanup();
  });

  it('waits for the render engine snapshot after pending-loaded when refresh is deferred', () => {
    const raf = installRafQueue();
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const pendingIds = new Set<string>();
    const projectPendingRevisionsForBlocks = vi.fn(async (blockIds: string[]) => createProjectionResult(blockIds));
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds,
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock([], { publishOnScheduleRefresh: false });

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    raf.flushAll();
    expect(projectPendingRevisionsForBlocks).not.toHaveBeenCalled();

    pendingIds.add('block-a');
    eventBus.emit('pending-revisions-loaded');
    raf.flushAll();

    expect(renderEngine.engine.scheduleRefresh).toHaveBeenCalledWith({
      type: 'content-loaded',
      source: 'pending-revisions',
    });
    expect(projectPendingRevisionsForBlocks).not.toHaveBeenCalled();

    renderEngine.emit(['block-a']);
    raf.flushAll();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledWith(['block-a']);

    cleanup();
  });

  it('projects the latest hydrated render window instead of stale blocks', () => {
    const raf = installRafQueue();
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const projectPendingRevisionsForBlocks = vi.fn(async (blockIds: string[]) => createProjectionResult(blockIds));
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds: new Set(['top-block', 'bottom-block']),
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock();

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    renderEngine.emit(['top-block']);
    renderEngine.emit(['bottom-block']);

    expect(projectPendingRevisionsForBlocks).not.toHaveBeenCalled();
    raf.flushNext();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledWith(['bottom-block']);

    cleanup();
  });

  it('does not project until the render engine reports hydrated blocks', () => {
    const raf = installRafQueue();
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const projectPendingRevisionsForBlocks = vi.fn(async (blockIds: string[]) => createProjectionResult(blockIds));
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds: new Set(['visible']),
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock();

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    renderEngine.emit([]);
    raf.flushAll();
    expect(projectPendingRevisionsForBlocks).not.toHaveBeenCalled();

    renderEngine.emit(['visible']);
    raf.flushAll();
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledWith(['visible']);

    cleanup();
  });

  it('projects only hydrated blocks and ignores placeholder-only visible blocks', () => {
    const raf = installRafQueue();
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const projectPendingRevisionsForBlocks = vi.fn(async (blockIds: string[]) => createProjectionResult(blockIds));
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds: new Set(['placeholder-pending', 'hydrated-pending']),
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock();

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    renderEngine.emitSnapshot({
      visibleBlockIds: ['placeholder-pending', 'hydrated-pending'],
      hydratedBlockIds: ['hydrated-pending'],
    });
    raf.flushAll();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledWith(['hydrated-pending']);

    cleanup();
  });

  it('projects shell pending in small chunks so a large window does not monopolize the frame', async () => {
    const raf = installRafQueue();
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const pendingIds = new Set(Array.from({ length: 9 }, (_value, index) => `block-${index}`));
    const activeIds = new Set<string>();
    const projectPendingRevisionsForBlocks = vi.fn(async (blockIds: string[]) => {
      for (const blockId of blockIds) activeIds.add(blockId);
      return createProjectionResult(blockIds);
    });
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds,
      activeIds,
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock();

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    renderEngine.emit([...pendingIds]);
    raf.flushNext();
    await waitForQueuedFrame(raf);

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(projectPendingRevisionsForBlocks).toHaveBeenLastCalledWith([
      'block-0',
      'block-1',
      'block-2',
      'block-3',
      'block-4',
      'block-5',
      'block-6',
      'block-7',
    ]);

    await Promise.resolve();
    await Promise.resolve();
    await waitForQueuedFrame(raf);
    raf.flushAll();
    await Promise.resolve();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(2);
    expect(projectPendingRevisionsForBlocks).toHaveBeenLastCalledWith(['block-8']);

    cleanup();
  });

  it('does not remember a hydrated window as projected before canonical pending arrives', () => {
    const raf = installRafQueue();
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const projectPendingRevisionsForBlocks = vi.fn(async (blockIds: string[]) => createProjectionResult(blockIds));
    const pendingIds = new Set<string>();
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds,
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock();

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    renderEngine.emit(['block-a']);
    raf.flushAll();
    expect(projectPendingRevisionsForBlocks).not.toHaveBeenCalled();

    pendingIds.add('block-a');
    eventBus.emit('pending-revisions-loaded');
    raf.flushAll();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledWith(['block-a']);

    cleanup();
  });

  it('retries the latest hydrated candidates after an in-flight projection finishes', async () => {
    const raf = installRafQueue();
    let clock = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    let resolveFirstProjection = (): void => {
      throw new Error('projection resolver was not initialized');
    };
    const projectPendingRevisionsForBlocks = vi.fn((blockIds: string[]) => {
      if (blockIds[0] === 'old-visible') {
        return new Promise<PendingProjectionResult>((resolve) => {
          resolveFirstProjection = () => resolve(createProjectionResult(blockIds));
        });
      }
      return Promise.resolve(createProjectionResult(blockIds));
    });
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds: new Set(['old-visible', 'current-visible']),
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock();

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    renderEngine.emit(['old-visible']);
    clock = 100;
    raf.flushNext();
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(projectPendingRevisionsForBlocks).toHaveBeenLastCalledWith(['old-visible']);

    renderEngine.emit(['current-visible']);
    raf.flushNext();
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);

    resolveFirstProjection();
    await waitForQueuedFrame(raf);
    clock = 200;
    raf.flushAll();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(2);
    expect(projectPendingRevisionsForBlocks).toHaveBeenLastCalledWith(['current-visible']);

    await Promise.resolve();
    cleanup();
    nowSpy.mockRestore();
  });

  it('does not schedule a rerun after cleanup while a projection is still in flight', async () => {
    const raf = installRafQueue();
    let clock = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    let resolveFirstProjection = (): void => {
      throw new Error('projection resolver was not initialized');
    };
    const projectPendingRevisionsForBlocks = vi.fn((blockIds: string[]) => new Promise<PendingProjectionResult>((resolve) => {
      resolveFirstProjection = () => resolve(createProjectionResult(blockIds));
    }));
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds: new Set(['old-visible', 'current-visible']),
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock();

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    renderEngine.emit(['old-visible']);
    clock = 100;
    raf.flushNext();
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(projectPendingRevisionsForBlocks).toHaveBeenLastCalledWith(['old-visible']);

    renderEngine.emit(['current-visible']);
    raf.flushNext();
    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);

    cleanup();
    resolveFirstProjection();
    await Promise.resolve();
    await Promise.resolve();
    clock = 200;
    raf.flushAll();
    await Promise.resolve();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it('does not mark a failed projection window as projected', async () => {
    const raf = installRafQueue();
    let clock = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const eventBus = new EventBusMock();
    const editor = {
      isDestroyed: false,
      eventBus,
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor & { eventBus: EventBusMock };
    const projectPendingRevisionsForBlocks = vi.fn(async () => ({
      requestedCount: 1,
      batchCount: 1,
      projectedCount: 0,
      skippedCount: 0,
      failedCount: 1,
      totalMs: 1,
      flushMs: 0,
    }));
    vi.mocked(useRevisionStore).mockReturnValue(createRevisionStoreMock({
      projectPendingRevisionsForBlocks,
      pendingIds: new Set(['block-a']),
    }) as ReturnType<typeof useRevisionStore>);
    const renderEngine = createRenderEngineMock();

    const cleanup = setupShellPendingProjectionBridge({
      getEditor: () => editor,
      renderVirtualizationEngine: renderEngine.engine,
    });

    renderEngine.emit(['block-a']);
    raf.flushAll();
    await Promise.resolve();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(1);
    expect(window.__SHELL_PENDING_PROJECTION_PERF__?.getLast()?.reason).toBe('failed');

    clock = 200;
    renderEngine.emit(['block-a']);
    await Promise.resolve();
    await Promise.resolve();
    raf.flushAll();
    await Promise.resolve();

    expect(projectPendingRevisionsForBlocks).toHaveBeenCalledTimes(2);

    cleanup();
    nowSpy.mockRestore();
  });
});
