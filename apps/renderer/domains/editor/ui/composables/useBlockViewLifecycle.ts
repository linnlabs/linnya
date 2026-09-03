import { onBeforeUnmount, onMounted, watch, type ComputedRef } from 'vue';
import {
  recordRootBlockNodeViewMounted,
  recordRootBlockNodeViewUnmounted,
} from '../../features/RenderVirtualization/debug/rootBlockNodeViewRuntimePerf';
import {
  logBlockViewMountMicrotask,
  scheduleBlockViewPostMountWork,
} from './useBlockViewPostMountWork';

export interface BlockViewLifecycleOptions {
  blockId: ComputedRef<string>;
  shouldMountBlockChrome: ComputedRef<boolean>;
  getRootBlockOuterEl: () => HTMLElement | null;
  refreshRootBlockRuntimeHandle: () => void;
  cleanupRootBlockRuntimeHandle: () => void;
  observeBlock: (el: HTMLElement) => void;
  unobserveBlock: (el: HTMLElement) => void;
  registerBlockVisibility: (blockId: string, el: HTMLElement) => void;
  unregisterBlockVisibility: (blockId: string, el?: HTMLElement | null) => void;
  requestBlockChromeMount: () => void;
}

export interface BlockViewLifecycleControl {
  mounted: () => void;
  beforeUnmount: () => void;
  blockIdChanged: (nextId: string, prevId: string) => void;
  isUnmounted: () => boolean;
}

export function createBlockViewLifecycleControl(
  options: BlockViewLifecycleOptions
): BlockViewLifecycleControl {
  let isBlockViewUnmounted = false;

  const isUnmounted = (): boolean => isBlockViewUnmounted;

  const mounted = (): void => {
    logBlockViewMountMicrotask(options.blockId.value, 'mounted:start');
    recordRootBlockNodeViewMounted({
      kind: 'vue',
      blockId: options.blockId.value,
    });
    options.refreshRootBlockRuntimeHandle();

    scheduleBlockViewPostMountWork({
      blockId: options.blockId,
      shouldMountBlockChrome: options.shouldMountBlockChrome,
      isUnmounted,
      getRootBlockOuterEl: options.getRootBlockOuterEl,
      observeBlock: options.observeBlock,
      registerBlockVisibility: options.registerBlockVisibility,
      requestBlockChromeMount: options.requestBlockChromeMount,
    });
  };

  const beforeUnmount = (): void => {
    isBlockViewUnmounted = true;
    options.cleanupRootBlockRuntimeHandle();
    recordRootBlockNodeViewUnmounted({
      kind: 'vue',
      blockId: options.blockId.value,
    });

    const el = options.getRootBlockOuterEl();
    if (el) {
      options.unobserveBlock(el);
      options.unregisterBlockVisibility(options.blockId.value, el);
    }
  };

  const blockIdChanged = (nextId: string, prevId: string): void => {
    const el = options.getRootBlockOuterEl();
    options.refreshRootBlockRuntimeHandle();
    if (!el || nextId === prevId) return;
    if (prevId) options.unregisterBlockVisibility(prevId, el);
    if (nextId) options.registerBlockVisibility(nextId, el);
  };

  return {
    mounted,
    beforeUnmount,
    blockIdChanged,
    isUnmounted,
  };
}

/**
 * 旧小文档 BlockView 的生命周期编排。
 *
 * 中文说明：这里集中串联 runtime handle、可见性注册和首屏 chrome mount 队列，
 * 让 SFC 只保留 DOM 结构和显式连接，不继续承载 NodeView 生命周期细节。
 */
export function useBlockViewLifecycle(options: BlockViewLifecycleOptions): void {
  logBlockViewMountMicrotask(options.blockId.value, 'setup');

  const lifecycle = createBlockViewLifecycleControl(options);
  onMounted(lifecycle.mounted);
  onBeforeUnmount(lifecycle.beforeUnmount);
  watch(options.blockId, lifecycle.blockIdChanged);
}
