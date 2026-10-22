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

import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { estimateRootBlockHeight } from '../functions/estimateRootBlockHeight'
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
  owner: RenderVirtualizationOwner,
  initialEstimate?: number
): number {
  return getHeightCache(owner).get(blockId, initialEstimate)
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
  estimatedDocs.delete(owner)
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

const estimatedDocs = new WeakMap<RenderVirtualizationOwner, ProseMirrorNode>()

/** 只在文档身份变化时收集提示；滚动刷新复用结果，不在热路径重扫规格。 */
export function syncRenderVirtualizationHeightEstimates(doc: ProseMirrorNode, owner: RenderVirtualizationOwner): void {
  if (estimatedDocs.get(owner) === doc) return
  const estimates = new Map<string, number>()
  doc.descendants(root => {
    if (root.type.name !== 'rootBlock') return true
    const id: unknown = root.attrs['id']
    const height = estimateRootBlockHeight(root)
    if (typeof id === 'string' && height !== undefined) estimates.set(id, height)
    return false
  })
  getHeightCache(owner).replaceEstimates(estimates)
  estimatedDocs.set(owner, doc)
}
