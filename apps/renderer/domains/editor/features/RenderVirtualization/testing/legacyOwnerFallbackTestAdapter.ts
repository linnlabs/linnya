/**
 * legacyOwnerFallbackTestAdapter.ts
 *
 * 中文说明：
 * 这里是 RenderVirtualization 迁移期唯一允许测试主动访问 legacy ownerless
 * registry/cache/lifecycle 的入口。生产代码必须显式传 owner；历史测试如果确实
 * 要验证 legacy fallback，需要从本文件导入，避免 ownerless 调用继续散落。
 */

import {
  getLegacyRootBlockRuntimeRegistryForTest as getLegacyRootBlockRuntimeRegistry,
  registerLegacyRootBlockRuntimeHandleForTest as registerLegacyRootBlockRuntimeHandle,
  resetLegacyRootBlockRuntimeRegistryForTest as resetLegacyRootBlockRuntimeRegistry,
  type RootBlockRuntimeRegistry,
  type RootBlockRuntimeHandle,
} from '../runtime/RootBlockRuntimeRegistry'
import {
  awaitLegacyHydratedRootBlockNodeViewForTest as awaitLegacyHydratedRootBlockNodeView,
  getLegacyRootBlockNodeViewLifecycleDebugSnapshotForTest as getLegacyRootBlockNodeViewLifecycleDebugSnapshot,
  getLegacyRootBlockNodeViewLifecycleEntryForTest as getLegacyRootBlockNodeViewLifecycleEntry,
  publishLegacyRootBlockNodeViewMountedForTest as publishLegacyRootBlockNodeViewMounted,
  publishLegacyRootBlockNodeViewUnmountedForTest as publishLegacyRootBlockNodeViewUnmounted,
  resetLegacyRootBlockNodeViewLifecycleRegistryForTest as resetLegacyRootBlockNodeViewLifecycleRegistry,
  subscribeLegacyRootBlockNodeViewLifecycleForTest as subscribeLegacyRootBlockNodeViewLifecycle,
  type RootBlockNodeViewLifecycleEntry,
  type RootBlockNodeViewLifecycleEvent,
} from '../state/nodeViewLifecycle'
import {
  getLegacyRenderVirtualizationBlockHeightForTest as getRenderVirtualizationBlockHeight,
  getLegacyRenderVirtualizationBlockHeightCacheSnapshotForTest as getRenderVirtualizationBlockHeightCacheSnapshot,
  getLegacyRenderVirtualizationBlockLayoutHeightForTest as getRenderVirtualizationBlockLayoutHeight,
  recordLegacyRenderVirtualizationBlockHeightForTest as recordRenderVirtualizationBlockHeight,
  resetLegacyRenderVirtualizationBlockHeightCacheForTest as resetRenderVirtualizationBlockHeightCache,
} from '../state/blockHeightCacheRegistry'
import type { BlockHeightCacheSnapshot } from '../state/blockHeightCache'

export function getLegacyRootBlockRuntimeRegistryForTest(): RootBlockRuntimeRegistry {
  return getLegacyRootBlockRuntimeRegistry()
}

export function registerLegacyRootBlockRuntimeHandleForTest(
  handle: RootBlockRuntimeHandle
): () => void {
  return registerLegacyRootBlockRuntimeHandle(handle)
}

export function resetLegacyRootBlockRuntimeRegistryForTest(): void {
  resetLegacyRootBlockRuntimeRegistry()
}

export function publishLegacyRootBlockNodeViewMountedForTest(
  entry: RootBlockNodeViewLifecycleEntry
): void {
  publishLegacyRootBlockNodeViewMounted(entry)
}

export function publishLegacyRootBlockNodeViewUnmountedForTest(
  entry: RootBlockNodeViewLifecycleEntry
): void {
  publishLegacyRootBlockNodeViewUnmounted(entry)
}

export function getLegacyRootBlockNodeViewLifecycleEntryForTest(
  blockId: string
): RootBlockNodeViewLifecycleEntry | null {
  return getLegacyRootBlockNodeViewLifecycleEntry(blockId)
}

export function getLegacyRootBlockNodeViewLifecycleDebugSnapshotForTest(): {
  mountedCount: number
  hydratedCount: number
  placeholderCount: number
  pendingHydrationWaiterCount: number
} {
  return getLegacyRootBlockNodeViewLifecycleDebugSnapshot()
}

export function subscribeLegacyRootBlockNodeViewLifecycleForTest(
  listener: (event: RootBlockNodeViewLifecycleEvent) => void,
  options: { replayExisting?: boolean } = {}
): () => void {
  return subscribeLegacyRootBlockNodeViewLifecycle(listener, options)
}

export function awaitLegacyHydratedRootBlockNodeViewForTest(
  blockId: string,
  timeoutMs: number
): Promise<HTMLElement> {
  return awaitLegacyHydratedRootBlockNodeView(blockId, timeoutMs)
}

export function resetLegacyRootBlockNodeViewLifecycleRegistryForTest(): void {
  resetLegacyRootBlockNodeViewLifecycleRegistry()
}

export function recordLegacyRenderVirtualizationBlockHeightForTest(
  blockId: string,
  el: HTMLElement
): void {
  recordRenderVirtualizationBlockHeight(blockId, el)
}

export function getLegacyRenderVirtualizationBlockHeightForTest(blockId: string): number {
  return getRenderVirtualizationBlockHeight(blockId)
}

export function getLegacyRenderVirtualizationBlockLayoutHeightForTest(blockId: string): number {
  return getRenderVirtualizationBlockLayoutHeight(blockId)
}

export function getLegacyRenderVirtualizationBlockHeightCacheSnapshotForTest(): BlockHeightCacheSnapshot {
  return getRenderVirtualizationBlockHeightCacheSnapshot()
}

export function resetLegacyRenderVirtualizationBlockHeightCacheForTest(): void {
  resetRenderVirtualizationBlockHeightCache()
}
