// @vitest-environment jsdom

import { computed, nextTick } from 'vue';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  mountBlockChromeLifecycle,
} from './useBlockChromeLifecycle';
import './blockChromeRuntimePerf';

describe('useBlockChromeLifecycle', () => {
  beforeEach(() => {
    window.__BLOCK_CHROME_LIFECYCLE_PERF__?.clear();
  });

  it('挂载时记录生命周期、绑定 pointer 监听并补发迟到 hover', () => {
    const outerEl = document.createElement('div');
    const onPointerEnter = vi.fn();
    const onPointerLeave = vi.fn();
    const onMountedWhileHovered = vi.fn();
    const setupDropIndicator = vi.fn();
    const cleanupDropIndicator = vi.fn();
    const cleanupHoverTimer = vi.fn();
    const cleanupDomSync = vi.fn();
    const clearRevisionToolbarHover = vi.fn();

    outerEl.matches = vi.fn((selector: string) => selector === ':hover');

    const cleanup = mountBlockChromeLifecycle({
      blockId: computed(() => 'root-a'),
      setupStartedAt: performance.now(),
      getOuterEl: () => outerEl,
      onPointerEnter,
      onPointerLeave,
      onMountedWhileHovered,
      setupDropIndicator,
      cleanupDropIndicator,
      cleanupHoverTimer,
      cleanupDomSync,
      clearRevisionToolbarHover,
    });

    expect(window.__BLOCK_CHROME_LIFECYCLE_PERF__?.getLast()).toMatchObject({
      blockId: 'root-a',
      phase: 'mount',
    });
    expect(onMountedWhileHovered).toHaveBeenCalledTimes(1);
    expect(setupDropIndicator).toHaveBeenCalledTimes(1);

    const enterEvent = new Event('pointerenter');
    const leaveEvent = new Event('pointerleave');
    outerEl.dispatchEvent(enterEvent);
    outerEl.dispatchEvent(leaveEvent);

    expect(onPointerEnter).toHaveBeenCalledWith(enterEvent);
    expect(onPointerLeave).toHaveBeenCalledWith(leaveEvent);

    cleanup();

    expect(window.__BLOCK_CHROME_LIFECYCLE_PERF__?.getLast()).toMatchObject({
      blockId: 'root-a',
      phase: 'unmount',
    });
    expect(cleanupDomSync).toHaveBeenCalledTimes(1);
    expect(clearRevisionToolbarHover).toHaveBeenCalledTimes(1);
    expect(cleanupHoverTimer).toHaveBeenCalledTimes(1);
    expect(cleanupDropIndicator).toHaveBeenCalledTimes(1);
  });

  it('cleanup 后移除 pointer 监听，避免旧块继续响应 hover', async () => {
    const outerEl = document.createElement('div');
    const onPointerEnter = vi.fn();
    const cleanup = mountBlockChromeLifecycle({
      blockId: computed(() => 'root-a'),
      setupStartedAt: performance.now(),
      getOuterEl: () => outerEl,
      onPointerEnter,
      onPointerLeave: vi.fn(),
      onMountedWhileHovered: vi.fn(),
      setupDropIndicator: vi.fn(),
      cleanupDropIndicator: vi.fn(),
      cleanupHoverTimer: vi.fn(),
      cleanupDomSync: vi.fn(),
      clearRevisionToolbarHover: vi.fn(),
    });

    cleanup();
    outerEl.dispatchEvent(new Event('pointerenter'));
    await nextTick();

    expect(onPointerEnter).not.toHaveBeenCalled();
  });
});
