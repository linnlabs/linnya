import { onBeforeUnmount, onMounted, type ComputedRef } from 'vue';
import {
  recordBlockChromeMounted,
  recordBlockChromeUnmounted,
} from './blockChromeRuntimePerf';

export interface BlockChromeLifecycleOptions {
  blockId: ComputedRef<string | null>;
  setupStartedAt: number;
  getOuterEl: () => HTMLElement | null;
  onPointerEnter: (event: Event) => void;
  onPointerLeave: (event: Event) => void;
  onMountedWhileHovered: () => void;
  setupDropIndicator: () => void;
  cleanupDropIndicator: () => void;
  cleanupHoverTimer: () => void;
  cleanupDomSync: () => void;
  clearRevisionToolbarHover: () => void;
}

export type BlockChromeLifecycleCleanup = () => void;

export function mountBlockChromeLifecycle(options: BlockChromeLifecycleOptions): BlockChromeLifecycleCleanup {
  const blockId = options.blockId.value;
  if (blockId) {
    recordBlockChromeMounted({
      blockId,
      setupToMountedMs: performance.now() - options.setupStartedAt,
    });
  }

  const outerEl = options.getOuterEl();
  if (outerEl) {
    outerEl.addEventListener('pointerenter', options.onPointerEnter);
    outerEl.addEventListener('pointerleave', options.onPointerLeave);

    // 中文说明：
    // - 旧 BlockChrome 可能在鼠标已经停在块上时才挂载；
    // - 浏览器不会为迟到的监听器补发 pointerenter；
    // - 因此挂载后主动读取一次 hover 状态，避免批注 / 修订 hover UI 首次丢失。
    if (outerEl.matches(':hover')) {
      options.onMountedWhileHovered();
    }
  }

  options.setupDropIndicator();

  return () => {
    const currentBlockId = options.blockId.value;
    if (currentBlockId) {
      recordBlockChromeUnmounted(currentBlockId);
    }

    if (outerEl) {
      outerEl.removeEventListener('pointerenter', options.onPointerEnter);
      outerEl.removeEventListener('pointerleave', options.onPointerLeave);
    }

    options.cleanupDomSync();
    options.clearRevisionToolbarHover();
    options.cleanupHoverTimer();
    options.cleanupDropIndicator();
  };
}

export function useBlockChromeLifecycle(options: BlockChromeLifecycleOptions): void {
  let cleanup: BlockChromeLifecycleCleanup | null = null;

  onMounted(() => {
    cleanup = mountBlockChromeLifecycle(options);
  });

  onBeforeUnmount(() => {
    cleanup?.();
    cleanup = null;
  });
}
