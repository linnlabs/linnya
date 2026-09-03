// @vitest-environment jsdom

import { computed, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkBlockViewInViewportSync,
  clearBlockViewPostMountQueueForTest,
  runBlockViewPostMountWork,
  scheduleBlockViewPostMountWork,
} from './useBlockViewPostMountWork';

describe('useBlockViewPostMountWork', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearBlockViewPostMountQueueForTest();
    window.__EDITOR_PERF_BENCH_CONTROL__ = undefined;
    window.__EDITOR_BLOCK_VIEW_MOUNT_MICROTASK_COUNT__ = undefined;
  });

  afterEach(() => {
    clearBlockViewPostMountQueueForTest();
    vi.useRealTimers();
  });

  function createVisibleElement(): HTMLElement {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => new DOMRect(0, 0, 100, 40);
    return el;
  }

  it('同步判断块是否在初始视口附近', () => {
    const visibleEl = createVisibleElement();
    const zeroHeightEl = document.createElement('div');
    zeroHeightEl.getBoundingClientRect = () => new DOMRect(0, 0, 100, 0);

    expect(checkBlockViewInViewportSync(visibleEl)).toBe(true);
    expect(checkBlockViewInViewportSync(zeroHeightEl)).toBe(false);
  });

  it('执行 post-mount 注册并在初始视口内请求挂载 BlockChrome', () => {
    const el = createVisibleElement();
    const observeBlock = vi.fn();
    const registerBlockVisibility = vi.fn();
    const requestBlockChromeMount = vi.fn();

    runBlockViewPostMountWork({
      blockId: computed(() => 'root-a'),
      shouldMountBlockChrome: computed(() => false),
      isUnmounted: () => false,
      getRootBlockOuterEl: () => el,
      observeBlock,
      registerBlockVisibility,
      requestBlockChromeMount,
    });

    expect(observeBlock).toHaveBeenCalledWith(el);
    expect(registerBlockVisibility).toHaveBeenCalledWith('root-a', el);
    expect(requestBlockChromeMount).toHaveBeenCalledTimes(1);
  });

  it('benchmark 禁用初始 chrome mount 时仍保留可见性注册', () => {
    window.__EDITOR_PERF_BENCH_CONTROL__ = {
      disableInitialBlockChromeMount: true,
    };
    const el = createVisibleElement();
    const observeBlock = vi.fn();
    const registerBlockVisibility = vi.fn();
    const requestBlockChromeMount = vi.fn();

    runBlockViewPostMountWork({
      blockId: computed(() => 'root-a'),
      shouldMountBlockChrome: computed(() => false),
      isUnmounted: () => false,
      getRootBlockOuterEl: () => el,
      observeBlock,
      registerBlockVisibility,
      requestBlockChromeMount,
    });

    expect(observeBlock).toHaveBeenCalledWith(el);
    expect(registerBlockVisibility).toHaveBeenCalledWith('root-a', el);
    expect(requestBlockChromeMount).not.toHaveBeenCalled();
  });

  it('队列执行前 blockId 变化时取消旧 post-mount job', () => {
    const blockId = ref('root-a');
    const observeBlock = vi.fn();

    scheduleBlockViewPostMountWork({
      blockId: computed(() => blockId.value),
      shouldMountBlockChrome: computed(() => false),
      isUnmounted: () => false,
      getRootBlockOuterEl: () => createVisibleElement(),
      observeBlock,
      registerBlockVisibility: vi.fn(),
      requestBlockChromeMount: vi.fn(),
    });

    blockId.value = 'root-b';
    vi.runOnlyPendingTimers();

    expect(observeBlock).not.toHaveBeenCalled();
  });
});
