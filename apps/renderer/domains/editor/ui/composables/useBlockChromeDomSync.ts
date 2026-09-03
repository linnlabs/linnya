import { watch, type ComputedRef, type Ref, type WatchStopHandle } from 'vue';
import type { RenderVirtualizationKeepAliveReason } from '../../features/RenderVirtualization/state/keepAliveRegistry';

export type BlockChromeElementSource =
  | HTMLElement
  | {
      $el?: unknown;
    }
  | null;

export interface UseBlockChromeDomSyncOptions {
  rootBlockOuterEl: () => BlockChromeElementSource;
  rootBlockEl: () => HTMLElement | null;
  isDragging: Ref<boolean>;
  isBlockSelected: Ref<boolean>;
  isHandleSelected: Ref<boolean>;
  hasAnnotations: Ref<boolean>;
  revisionToolbarActive: ComputedRef<boolean>;
  isInHistoryMode: ComputedRef<boolean>;
  isInSideBySideMode: ComputedRef<boolean>;
  setRenderVirtualizationKeepAlive: (
    reason: RenderVirtualizationKeepAliveReason,
    active: boolean
  ) => void;
}

export interface UseBlockChromeDomSyncReturn {
  getOuterEl: () => HTMLElement | null;
  cleanup: () => void;
}

function isHtmlElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

export function resolveBlockChromeOuterElement(source: BlockChromeElementSource): HTMLElement | null {
  if (isHtmlElement(source)) return source;
  if (!source || typeof source !== 'object') return null;

  const maybeRoot = source.$el;
  return isHtmlElement(maybeRoot) ? maybeRoot : null;
}

/**
 * 同步旧小文档 BlockChrome 的交互状态到父级 RootBlock DOM。
 *
 * 中文说明：大文档路径已经由 BlockChromeHost 接管，这里只服务旧小文档路径。
 * DOM class / attribute 和 keep-alive release 必须集中清理，避免 SFC 内部分散 watcher
 * 在后续拆迁时漏掉 release 或残留 class。
 */
export function useBlockChromeDomSync(options: UseBlockChromeDomSyncOptions): UseBlockChromeDomSyncReturn {
  const stopHandles: WatchStopHandle[] = [];

  const getOuterEl = (): HTMLElement | null => {
    return resolveBlockChromeOuterElement(options.rootBlockOuterEl());
  };

  stopHandles.push(
    watch(() => options.isDragging.value, (active) => {
      getOuterEl()?.classList.toggle('is-dragging', active);
      options.setRenderVirtualizationKeepAlive('dragging', active);
    })
  );

  stopHandles.push(
    watch(() => options.isBlockSelected.value, (active) => {
      getOuterEl()?.classList.toggle('is-block-selected', active);
    })
  );

  stopHandles.push(
    watch(() => options.isHandleSelected.value, (active) => {
      getOuterEl()?.classList.toggle('handle-selected', active);
    })
  );

  stopHandles.push(
    watch(() => options.hasAnnotations.value, (hasAnnotations) => {
      const el = getOuterEl();
      if (!el) return;

      if (hasAnnotations) el.setAttribute('data-has-annotations', 'true');
      else el.removeAttribute('data-has-annotations');
    })
  );

  stopHandles.push(
    watch(
      () => options.revisionToolbarActive.value,
      (active) => {
        getOuterEl()?.classList.toggle('revision-toolbar-active', active);
        options.setRenderVirtualizationKeepAlive('revision-toolbar', active);
      },
      { immediate: true }
    )
  );

  stopHandles.push(
    watch(
      () => options.isInHistoryMode.value,
      (active) => {
        options.rootBlockEl()?.classList.toggle('history-mode', active);
        options.setRenderVirtualizationKeepAlive('history-mode', active);
      },
      { immediate: true }
    )
  );

  stopHandles.push(
    watch(() => options.isInSideBySideMode.value, (active) => {
      options.rootBlockEl()?.classList.toggle('history-side-by-side-mode', active);
    })
  );

  function cleanup(): void {
    stopHandles.splice(0).forEach((stop) => stop());

    options.setRenderVirtualizationKeepAlive('revision-toolbar', false);
    options.setRenderVirtualizationKeepAlive('history-mode', false);
    options.setRenderVirtualizationKeepAlive('dragging', false);

    const outerEl = getOuterEl();
    if (outerEl) {
      outerEl.classList.remove(
        'is-dragging',
        'is-block-selected',
        'handle-selected',
        'revision-toolbar-active'
      );
      outerEl.removeAttribute('data-has-annotations');
    }

    options.rootBlockEl()?.classList.remove('history-mode', 'history-side-by-side-mode');
  }

  return {
    getOuterEl,
    cleanup,
  };
}
