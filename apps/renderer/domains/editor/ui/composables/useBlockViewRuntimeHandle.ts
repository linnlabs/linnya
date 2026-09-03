import type { ComputedRef, Ref } from 'vue';
import type {
  RootBlockRuntimeHandle,
  RootBlockRuntimeRegistryOwner,
} from '../../features/RenderVirtualization/runtime/RootBlockRuntimeRegistry';
import { registerRootBlockRuntimeHandle } from '../../features/RenderVirtualization/runtime/RootBlockRuntimeRegistry';

export type BlockViewOuterElementSource =
  | HTMLElement
  | {
      $el?: unknown;
    }
  | null;

export interface UseBlockViewRuntimeHandleOptions {
  blockId: ComputedRef<string>;
  rootBlockOuterRef: Ref<BlockViewOuterElementSource>;
  rootBlockRef: Ref<HTMLElement | null>;
  historyMountRef: Ref<HTMLElement | null>;
  getPos: () => number;
  runtimeRegistryOwner: RootBlockRuntimeRegistryOwner;
}

export interface UseBlockViewRuntimeHandleReturn {
  getRootBlockOuterEl: () => HTMLElement | null;
  getRootBlockContentEl: () => HTMLElement | null;
  refreshRootBlockRuntimeHandle: () => void;
  cleanupRootBlockRuntimeHandle: () => void;
}

function isHtmlElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

export function resolveBlockViewOuterElement(source: BlockViewOuterElementSource): HTMLElement | null {
  if (isHtmlElement(source)) return source;
  if (!source || typeof source !== 'object') return null;

  return isHtmlElement(source.$el) ? source.$el : null;
}

export function findRootBlockContentElement(rootBlockEl: HTMLElement | null): HTMLElement | null {
  if (!rootBlockEl) return null;

  for (const child of Array.from(rootBlockEl.children)) {
    if (child instanceof HTMLElement && child.classList.contains('content')) return child;
  }

  return null;
}

export function readRootBlockPosForRuntimeHandle(getPos: () => number): number | null {
  try {
    const pos = getPos();
    return Number.isFinite(pos) ? pos : null;
  } catch {
    // 中文说明：ProseMirror 在 NodeView 销毁或重建边界会让 getPos 暂时不可用。
    // runtime handle 是 action-time API；返回 null 让调用方显式处理“当前位置失效”。
    return null;
  }
}

export function createBlockViewRuntimeHandle(options: {
  blockId: string;
  getRootBlockOuterEl: () => HTMLElement | null;
  getRootBlockContentEl: () => HTMLElement | null;
  getChromeAnchor: () => HTMLElement | null;
  getPos: () => number | null;
}): RootBlockRuntimeHandle {
  return {
    blockId: options.blockId,
    mode: 'hydrated',
    getDom: options.getRootBlockOuterEl,
    getContentDom: options.getRootBlockContentEl,
    getChromeAnchor: options.getChromeAnchor,
    getPos: options.getPos,
    getRect: () => options.getRootBlockOuterEl()?.getBoundingClientRect() ?? null,
    measure: () => {
      const rect = options.getRootBlockOuterEl()?.getBoundingClientRect();
      return rect ? Math.max(0, rect.height) : null;
    },
  };
}

/**
 * 旧小文档 BlockView 的 runtime handle 注册边界。
 *
 * 中文说明：大文档裸 DOM NodeView 也注册同类 handle；这里把旧 Vue NodeView
 * 的 DOM 解析和 registry 写入集中在一个 composable 中，避免 BlockView.vue
 * 继续持有 `$el` 穿透和 runtime registry 的细节。
 */
export function useBlockViewRuntimeHandle(
  options: UseBlockViewRuntimeHandleOptions
): UseBlockViewRuntimeHandleReturn {
  let unregisterRuntimeHandle: (() => void) | null = null;

  const getRootBlockOuterEl = (): HTMLElement | null => {
    return resolveBlockViewOuterElement(options.rootBlockOuterRef.value);
  };

  const getRootBlockContentEl = (): HTMLElement | null => {
    return findRootBlockContentElement(options.rootBlockRef.value);
  };

  const cleanupRootBlockRuntimeHandle = (): void => {
    unregisterRuntimeHandle?.();
    unregisterRuntimeHandle = null;
  };

  const refreshRootBlockRuntimeHandle = (): void => {
    cleanupRootBlockRuntimeHandle();

    const blockId = options.blockId.value;
    if (!blockId) return;

    unregisterRuntimeHandle = registerRootBlockRuntimeHandle(
      createBlockViewRuntimeHandle({
        blockId,
        getRootBlockOuterEl,
        getRootBlockContentEl,
        getChromeAnchor: () => options.historyMountRef.value ?? options.rootBlockRef.value,
        getPos: () => readRootBlockPosForRuntimeHandle(options.getPos),
      }),
      options.runtimeRegistryOwner
    );
  };

  return {
    getRootBlockOuterEl,
    getRootBlockContentEl,
    refreshRootBlockRuntimeHandle,
    cleanupRootBlockRuntimeHandle,
  };
}
