// @vitest-environment jsdom

import { computed, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveBlockChromeOuterElement,
  useBlockChromeDomSync,
} from './useBlockChromeDomSync';
import type { RenderVirtualizationKeepAliveReason } from '../../features/RenderVirtualization/state/keepAliveRegistry';

describe('useBlockChromeDomSync', () => {
  it('同步旧 BlockChrome 交互状态到父级 DOM，并在 cleanup 时统一释放', async () => {
    const outerEl = document.createElement('div');
    const rootBlockEl = document.createElement('div');
    const isDragging = ref(false);
    const isBlockSelected = ref(false);
    const isHandleSelected = ref(false);
    const hasAnnotations = ref(false);
    const revisionToolbarActive = ref(false);
    const isInHistoryMode = ref(false);
    const isInSideBySideMode = ref(false);
    const keepAlive = vi.fn((reason: RenderVirtualizationKeepAliveReason, active: boolean) => {
      void reason;
      void active;
    });

    const domSync = useBlockChromeDomSync({
      rootBlockOuterEl: () => outerEl,
      rootBlockEl: () => rootBlockEl,
      isDragging,
      isBlockSelected,
      isHandleSelected,
      hasAnnotations,
      revisionToolbarActive: computed(() => revisionToolbarActive.value),
      isInHistoryMode: computed(() => isInHistoryMode.value),
      isInSideBySideMode: computed(() => isInSideBySideMode.value),
      setRenderVirtualizationKeepAlive: keepAlive,
    });

    isDragging.value = true;
    isBlockSelected.value = true;
    isHandleSelected.value = true;
    hasAnnotations.value = true;
    revisionToolbarActive.value = true;
    isInHistoryMode.value = true;
    isInSideBySideMode.value = true;
    await nextTick();

    expect(outerEl.classList.contains('is-dragging')).toBe(true);
    expect(outerEl.classList.contains('is-block-selected')).toBe(true);
    expect(outerEl.classList.contains('handle-selected')).toBe(true);
    expect(outerEl.classList.contains('revision-toolbar-active')).toBe(true);
    expect(outerEl.getAttribute('data-has-annotations')).toBe('true');
    expect(rootBlockEl.classList.contains('history-mode')).toBe(true);
    expect(rootBlockEl.classList.contains('history-side-by-side-mode')).toBe(true);
    expect(keepAlive).toHaveBeenCalledWith('dragging', true);
    expect(keepAlive).toHaveBeenCalledWith('revision-toolbar', true);
    expect(keepAlive).toHaveBeenCalledWith('history-mode', true);

    domSync.cleanup();

    expect(outerEl.className).toBe('');
    expect(outerEl.hasAttribute('data-has-annotations')).toBe(false);
    expect(rootBlockEl.className).toBe('');
    expect(keepAlive).toHaveBeenCalledWith('dragging', false);
    expect(keepAlive).toHaveBeenCalledWith('revision-toolbar', false);
    expect(keepAlive).toHaveBeenCalledWith('history-mode', false);

    const callCountAfterCleanup = keepAlive.mock.calls.length;
    isDragging.value = false;
    await nextTick();
    expect(keepAlive).toHaveBeenCalledTimes(callCountAfterCleanup);
  });

  it('解析 HTMLElement 或 Vue 组件根元素，不使用不安全类型断言', () => {
    const outerEl = document.createElement('div');

    expect(resolveBlockChromeOuterElement(outerEl)).toBe(outerEl);
    expect(resolveBlockChromeOuterElement({ $el: outerEl })).toBe(outerEl);
    expect(resolveBlockChromeOuterElement({ $el: {} })).toBeNull();
    expect(resolveBlockChromeOuterElement(null)).toBeNull();
  });
});
