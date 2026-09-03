import type { BlockVisibilityManager } from './useBlockVisibilityManager';
import {
  getRootBlockNodeViewLifecycleEntries,
  subscribeRootBlockNodeViewLifecycle,
  type RootBlockNodeViewLifecycleEntry,
  type RootBlockNodeViewLifecycleEvent,
} from '../../features/RenderVirtualization/state/nodeViewLifecycle';
import type { RenderVirtualizationOwner } from '../../features/RenderVirtualization';
import { getFlag } from '../services/editorFeatureFlags';

export interface ShellBlockVisibilityBridge {
  refresh: () => void;
  getObservedCount: () => number;
  cleanup: () => void;
}

export interface ShellBlockVisibilityBridgeOptions {
  getEditorRoot: () => HTMLElement | null;
  owner: RenderVirtualizationOwner;
  visibilityManager: BlockVisibilityManager;
}

interface EditorEventBusLike {
  on?: (eventName: string, listener: () => void) => void;
  off?: (eventName: string, listener: () => void) => void;
}

interface ShellBlockVisibilityLifecycleOptions extends ShellBlockVisibilityBridgeOptions {
  getEditorEventBus: () => EditorEventBusLike | null | undefined;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function logShellVisibilityBridgeStage(stage: string, metrics: readonly string[]): void {
  if (!getFlag('renderVirtualizationDebugLogging')) return;
  console.info(`[ShellVisibilityBridge] ${stage} ${metrics.join(' ')}`);
}

/**
 * Shell NodeView 可见性桥。
 *
 * 中文说明：
 * - Vue BlockView 会在组件 mounted 时注册 blockVisibilityManager；
 * - 大文档 Shell NodeView 没有 Vue 生命周期，所以需要一个外部桥接层扫描 DOM 并注册；
 * - 虚拟化文档里 placeholder 只是占高壳，不能参与 IntersectionObserver。
 *   否则 10000 块会在首开后给所有 placeholder 建观察关系，把成本从 Vue NodeView
 *   转移到浏览器 IO/visibility 链路上。
 * - 本文件只负责“hydrated DOM blockId -> visibilityManager”，不读取 Revision store，保持模块边界清楚。
 */
export function createShellBlockVisibilityBridge(
  options: ShellBlockVisibilityBridgeOptions
): ShellBlockVisibilityBridge {
  const observed = new Map<string, HTMLElement>();
  const unsubscribeLifecycle = subscribeRootBlockNodeViewLifecycle(handleLifecycleEvent, {
    replayExisting: true,
    owner: options.owner,
  });

  function unregisterBlockId(blockId: string): boolean {
    const previousEl = observed.get(blockId);
    if (!previousEl) return false;
    options.visibilityManager.unregisterBlockVisibility(blockId, previousEl);
    observed.delete(blockId);
    return true;
  }

  function registerEntry(entry: RootBlockNodeViewLifecycleEntry): boolean {
    const { blockId, dom } = entry;
    if (!blockId) return false;
    if (entry.mode !== 'hydrated') {
      return unregisterBlockId(blockId);
    }

    const previousEl = observed.get(blockId);
    if (previousEl === dom) return false;
    if (previousEl) {
      options.visibilityManager.unregisterBlockVisibility(blockId, previousEl);
    }

    options.visibilityManager.registerBlockVisibility(blockId, dom);
    observed.set(blockId, dom);
    return true;
  }

  function unregisterEntry(entry: RootBlockNodeViewLifecycleEntry): void {
    const { blockId, dom } = entry;
    if (!blockId) return;
    if (observed.get(blockId) !== dom) return;
    options.visibilityManager.unregisterBlockVisibility(blockId, dom);
    observed.delete(blockId);
  }

  function handleLifecycleEvent(event: RootBlockNodeViewLifecycleEvent): void {
    if (event.type === 'unmount') {
      unregisterEntry(event);
      return;
    }
    registerEntry(event);
  }

  function refresh(): void {
    const startedAt = nowMs();
    const root = options.getEditorRoot();
    if (!root) return;
    const entries = getRootBlockNodeViewLifecycleEntries(options.owner);
    const activeHydratedBlockIds = new Set<string>();
    let registeredOrReplacedCount = 0;
    let skippedPlaceholderCount = 0;
    let outsideRootCount = 0;
    let staleRemovedCount = 0;

    logShellVisibilityBridgeStage('refresh:start', [
      `entries=${entries.length}`,
      `observedBefore=${observed.size}`,
    ]);

    entries.forEach(entry => {
      if (!root.contains(entry.dom)) {
        outsideRootCount += 1;
        return;
      }
      if (entry.mode !== 'hydrated') {
        skippedPlaceholderCount += 1;
        return;
      }
      activeHydratedBlockIds.add(entry.blockId);
      if (registerEntry(entry)) registeredOrReplacedCount += 1;
    });

    observed.forEach((el, blockId) => {
      if (activeHydratedBlockIds.has(blockId) && root.contains(el)) return;
      if (unregisterBlockId(blockId)) staleRemovedCount += 1;
    });

    logShellVisibilityBridgeStage('refresh:end', [
      `entries=${entries.length}`,
      `registered=${registeredOrReplacedCount}`,
      `skippedPlaceholder=${skippedPlaceholderCount}`,
      `outsideRoot=${outsideRootCount}`,
      `staleRemoved=${staleRemovedCount}`,
      `observedAfter=${observed.size}`,
      `durationMs=${Math.round((nowMs() - startedAt) * 10) / 10}`,
    ]);
  }

  function cleanup(): void {
    unsubscribeLifecycle();
    observed.forEach((el, blockId) => {
      options.visibilityManager.unregisterBlockVisibility(blockId, el);
    });
    observed.clear();
  }

  return {
    refresh,
    getObservedCount: () => observed.size,
    cleanup,
  };
}

export function setupShellBlockVisibilityBridgeLifecycle(
  options: ShellBlockVisibilityLifecycleOptions
): () => void {
  const bridge = createShellBlockVisibilityBridge(options);
  let refreshRaf: number | null = null;

  function scheduleRefresh(reason = 'unknown'): void {
    logShellVisibilityBridgeStage('schedule', [
      `reason=${reason}`,
      `framePending=${refreshRaf !== null}`,
      `observed=${bridge.getObservedCount()}`,
    ]);
    if (refreshRaf !== null) return;
    refreshRaf = requestAnimationFrame(() => {
      logShellVisibilityBridgeStage('raf:start', [
        `reason=${reason}`,
        `observedBefore=${bridge.getObservedCount()}`,
      ]);
      refreshRaf = null;
      bridge.refresh();
      logShellVisibilityBridgeStage('raf:end', [
        `reason=${reason}`,
        `observedAfter=${bridge.getObservedCount()}`,
      ]);
    });
  }

  const eventBus = options.getEditorEventBus();
  const scheduleFileContentLoaded = (): void => scheduleRefresh('file-content-loaded');
  const schedulePendingRevisionsLoaded = (): void => scheduleRefresh('pending-revisions-loaded');
  eventBus?.on?.('file-content-loaded', scheduleFileContentLoaded);
  eventBus?.on?.('pending-revisions-loaded', schedulePendingRevisionsLoaded);
  scheduleRefresh('initial');

  return () => {
    eventBus?.off?.('file-content-loaded', scheduleFileContentLoaded);
    eventBus?.off?.('pending-revisions-loaded', schedulePendingRevisionsLoaded);
    if (refreshRaf !== null) {
      cancelAnimationFrame(refreshRaf);
      refreshRaf = null;
    }
    bridge.cleanup();
  };
}
