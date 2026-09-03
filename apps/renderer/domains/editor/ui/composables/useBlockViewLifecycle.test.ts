// @vitest-environment jsdom

import { computed, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlockViewLifecycleControl } from './useBlockViewLifecycle';
import { clearBlockViewPostMountQueueForTest } from './useBlockViewPostMountWork';
import '../../features/RenderVirtualization/debug/rootBlockNodeViewRuntimePerf';

describe('useBlockViewLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearBlockViewPostMountQueueForTest();
    window.__VUE_NODEVIEW_PERF__?.clear();
  });

  afterEach(() => {
    clearBlockViewPostMountQueueForTest();
    vi.useRealTimers();
  });

  it('挂载时记录 Vue NodeView、刷新 runtime handle 并调度 post-mount work', () => {
    const blockId = ref('root-a');
    const outerEl = document.createElement('div');
    outerEl.getBoundingClientRect = () => new DOMRect(0, 0, 100, 40);
    const refreshRootBlockRuntimeHandle = vi.fn();
    const observeBlock = vi.fn();
    const registerBlockVisibility = vi.fn();

    const lifecycle = createBlockViewLifecycleControl({
      blockId: computed(() => blockId.value),
      shouldMountBlockChrome: computed(() => false),
      getRootBlockOuterEl: () => outerEl,
      refreshRootBlockRuntimeHandle,
      cleanupRootBlockRuntimeHandle: vi.fn(),
      observeBlock,
      unobserveBlock: vi.fn(),
      registerBlockVisibility,
      unregisterBlockVisibility: vi.fn(),
      requestBlockChromeMount: vi.fn(),
    });

    lifecycle.mounted();

    const history = window.__VUE_NODEVIEW_PERF__?.getHistory() ?? [];
    expect(history[history.length - 1]).toMatchObject({
      kind: 'vue',
      blockId: 'root-a',
      phase: 'mount',
    });
    expect(refreshRootBlockRuntimeHandle).toHaveBeenCalledTimes(1);

    vi.runOnlyPendingTimers();
    expect(observeBlock).toHaveBeenCalledWith(outerEl);
    expect(registerBlockVisibility).toHaveBeenCalledWith('root-a', outerEl);
  });

  it('卸载时按当前 blockId 清理 runtime handle 和可见性注册', () => {
    const outerEl = document.createElement('div');
    const cleanupRootBlockRuntimeHandle = vi.fn();
    const unobserveBlock = vi.fn();
    const unregisterBlockVisibility = vi.fn();

    const lifecycle = createBlockViewLifecycleControl({
      blockId: computed(() => 'root-a'),
      shouldMountBlockChrome: computed(() => false),
      getRootBlockOuterEl: () => outerEl,
      refreshRootBlockRuntimeHandle: vi.fn(),
      cleanupRootBlockRuntimeHandle,
      observeBlock: vi.fn(),
      unobserveBlock,
      registerBlockVisibility: vi.fn(),
      unregisterBlockVisibility,
      requestBlockChromeMount: vi.fn(),
    });

    lifecycle.beforeUnmount();

    expect(lifecycle.isUnmounted()).toBe(true);
    expect(cleanupRootBlockRuntimeHandle).toHaveBeenCalledTimes(1);
    expect(unobserveBlock).toHaveBeenCalledWith(outerEl);
    expect(unregisterBlockVisibility).toHaveBeenCalledWith('root-a', outerEl);
    expect(window.__VUE_NODEVIEW_PERF__?.getHistory().at(-1)).toMatchObject({
      kind: 'vue',
      blockId: 'root-a',
      phase: 'unmount',
    });
  });

  it('blockId 变化时刷新 runtime handle，并把可见性注册迁移到新 id', () => {
    const outerEl = document.createElement('div');
    const refreshRootBlockRuntimeHandle = vi.fn();
    const registerBlockVisibility = vi.fn();
    const unregisterBlockVisibility = vi.fn();

    const lifecycle = createBlockViewLifecycleControl({
      blockId: computed(() => 'root-b'),
      shouldMountBlockChrome: computed(() => false),
      getRootBlockOuterEl: () => outerEl,
      refreshRootBlockRuntimeHandle,
      cleanupRootBlockRuntimeHandle: vi.fn(),
      observeBlock: vi.fn(),
      unobserveBlock: vi.fn(),
      registerBlockVisibility,
      unregisterBlockVisibility,
      requestBlockChromeMount: vi.fn(),
    });

    lifecycle.blockIdChanged('root-b', 'root-a');

    expect(refreshRootBlockRuntimeHandle).toHaveBeenCalledTimes(1);
    expect(unregisterBlockVisibility).toHaveBeenCalledWith('root-a', outerEl);
    expect(registerBlockVisibility).toHaveBeenCalledWith('root-b', outerEl);
  });
});
