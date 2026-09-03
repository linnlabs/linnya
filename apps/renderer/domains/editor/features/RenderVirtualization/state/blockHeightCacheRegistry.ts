/**
 * blockHeightCacheRegistry.ts
 *
 * 当前编辑器会话的 RootBlock 高度缓存门面。
 *
 * 中文说明：
 * - BlockHeightCache 本身是纯状态结构；
 * - 本文件提供编辑器运行期共享实例，让 RootBlock NodeView 和 UI bridge 通过稳定 API 协作；
 * - 文档切换时必须 reset，避免上一个文档的 blockId/height 污染下一个文档。
 */

import { BlockHeightCache, type BlockHeightCacheSnapshot } from './blockHeightCache'
import type { RenderVirtualizationOwner } from '../definitions/renderVirtualizationOwner'

const legacyDocumentHeightCache = new BlockHeightCache()
const heightCachesByOwner = new WeakMap<RenderVirtualizationOwner, BlockHeightCache>()

function getHeightCache(owner: RenderVirtualizationOwner): BlockHeightCache {
  const existing = heightCachesByOwner.get(owner)
  if (existing) return existing
  const cache = new BlockHeightCache()
  heightCachesByOwner.set(owner, cache)
  return cache
}

export function getRenderVirtualizationBlockHeight(
  blockId: string,
  owner: RenderVirtualizationOwner
): number {
  return getHeightCache(owner).get(blockId)
}

export function getRenderVirtualizationBlockLayoutHeight(
  blockId: string,
  owner: RenderVirtualizationOwner
): number {
  return getHeightCache(owner).getLayoutHeight(blockId)
}

export function estimateRenderVirtualizationTotalLayoutHeight(
  blockCount: number,
  owner: RenderVirtualizationOwner
): number {
  return getHeightCache(owner).estimateTotalLayoutHeight(blockCount)
}

export function recordRenderVirtualizationBlockHeight(
  blockId: string,
  el: HTMLElement,
  owner: RenderVirtualizationOwner
): void {
  if (!blockId) return
  const rect = el.getBoundingClientRect()
  const style = window.getComputedStyle(el)
  getHeightCache(owner).set(blockId, {
    elementHeight: rect.height,
    marginBefore: parseCssPixelValue(style.marginTop),
    marginAfter: parseCssPixelValue(style.marginBottom),
  })
}

export function resetRenderVirtualizationBlockHeightCache(
  owner: RenderVirtualizationOwner
): void {
  getHeightCache(owner).clear()
}

export function getRenderVirtualizationBlockHeightCacheSnapshot(
  owner: RenderVirtualizationOwner
): BlockHeightCacheSnapshot {
  return getHeightCache(owner).snapshot()
}

export function getLegacyRenderVirtualizationBlockHeightForTest(blockId: string): number {
  return legacyDocumentHeightCache.get(blockId)
}

export function getLegacyRenderVirtualizationBlockLayoutHeightForTest(blockId: string): number {
  return legacyDocumentHeightCache.getLayoutHeight(blockId)
}

export function estimateLegacyRenderVirtualizationTotalLayoutHeightForTest(blockCount: number): number {
  return legacyDocumentHeightCache.estimateTotalLayoutHeight(blockCount)
}

export function recordLegacyRenderVirtualizationBlockHeightForTest(
  blockId: string,
  el: HTMLElement
): void {
  if (!blockId) return
  const rect = el.getBoundingClientRect()
  const style = window.getComputedStyle(el)
  legacyDocumentHeightCache.set(blockId, {
    elementHeight: rect.height,
    marginBefore: parseCssPixelValue(style.marginTop),
    marginAfter: parseCssPixelValue(style.marginBottom),
  })
}

export function resetLegacyRenderVirtualizationBlockHeightCacheForTest(): void {
  legacyDocumentHeightCache.clear()
}

export function getLegacyRenderVirtualizationBlockHeightCacheSnapshotForTest(): BlockHeightCacheSnapshot {
  return legacyDocumentHeightCache.snapshot()
}

function parseCssPixelValue(value: string): number | undefined {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
