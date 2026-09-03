/**
 * renderWindowDom.ts
 *
 * RootBlock 虚拟化窗口的 DOM 读取与滚动锚点工具。
 *
 * 中文说明：
 * - 本文件集中所有必须读 DOM 的逻辑，避免 Engine / Revision / Bridge 各自采样；
 * - 纯窗口计算仍在 renderWindowMath.ts，二者边界清晰；
 * - 这里不派发 transaction，只返回 DOM 事实和滚动补偿结果。
 */

import {
  collectSampledViewportRootBlocks,
  findRootBlockOuterById,
  readRootBlockIdFromElement,
} from '../../../ui/composables/rootBlockViewportSnapshot'
import { readRootBlockIdFromElement as readClosestRootBlockIdFromElement } from '../../../shared/rootBlockDom'
import { ROOT_BLOCK_PLACEHOLDER_SELECTOR } from '../../../shared/rootBlockDomContract'
import {
  getRenderVirtualizationBlockHeight,
  recordRenderVirtualizationBlockHeight,
} from '../state/blockHeightCacheRegistry'
import { DOM_WINDOW_SAMPLE_ROW_STEP_PX } from '../renderVirtualizationConstants'
import type { RenderVirtualizationOwner } from '../definitions/renderVirtualizationOwner'

export interface ViewportReadResult {
  scrollTop: number
  viewportTop: number
  viewportBottom: number
}

export interface ScrollAnchorSnapshot {
  blockId: string
  top: number
  scrollTop: number
}

export interface ScrollAnchorRestoreResult {
  restored: boolean
  delta: number
  scrollTop: number
}

export interface PlaceholderHeightSyncResult {
  checkedCount: number
  updatedCount: number
  durationMs: number
}

export function readViewportBounds(
  editorRoot: HTMLElement,
  scrollRoot: HTMLElement | null
): ViewportReadResult {
  if (!scrollRoot) {
    const rect = editorRoot.getBoundingClientRect()
    const viewportTop = Math.max(0, -rect.top)
    const viewportBottom = viewportTop + window.innerHeight
    return {
      scrollTop: viewportTop,
      viewportTop,
      viewportBottom,
    }
  }

  const editorRect = editorRoot.getBoundingClientRect()
  const scrollRect = scrollRoot.getBoundingClientRect()
  const scrollTop = scrollRoot.scrollTop
  const editorTopInScroll = scrollTop + editorRect.top - scrollRect.top
  const viewportTop = Math.max(0, scrollTop - editorTopInScroll)

  return {
    scrollTop,
    viewportTop,
    viewportBottom: viewportTop + scrollRoot.clientHeight,
  }
}

export function collectDomSampledViewportBlockIds(params: {
  editorRoot: HTMLElement
  scrollRoot: HTMLElement | null
  maxItems: number
}): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const el of collectSampledViewportRootBlocks({
    editorRoot: params.editorRoot,
    scrollRoot: params.scrollRoot,
    maxItems: params.maxItems,
    rowStepPx: DOM_WINDOW_SAMPLE_ROW_STEP_PX,
  })) {
    const blockId = readRootBlockIdFromElement(el)
    if (!blockId || seen.has(blockId)) continue
    seen.add(blockId)
    result.push(blockId)
  }

  return result
}

export function readViewportAnchorBlockId(params: {
  editorRoot: HTMLElement
  scrollRoot: HTMLElement | null
}): string | null {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') {
    return null
  }

  const rect = params.scrollRoot?.getBoundingClientRect() ?? {
    left: 0,
    right: window.innerWidth,
    top: 0,
    bottom: window.innerHeight,
  }
  const width = Math.max(1, rect.right - rect.left)
  const height = Math.max(1, rect.bottom - rect.top)
  const samplePoints = [
    { x: rect.left + width * 0.5, y: rect.top + height * 0.5 },
    { x: rect.left + width * 0.5, y: rect.top + height * 0.25 },
    { x: rect.left + width * 0.5, y: rect.top + height * 0.75 },
  ]

  for (const point of samplePoints) {
    const elements = document.elementsFromPoint(point.x, point.y)
    for (const element of elements) {
      if (!params.editorRoot.contains(element)) continue
      const blockId = readClosestRootBlockIdFromElement(element)
      if (blockId) return blockId
    }
  }

  return null
}

export function captureScrollAnchor(params: {
  editorRoot: HTMLElement
  scrollRoot: HTMLElement | null
  blockId: string | null
}): ScrollAnchorSnapshot | null {
  if (!params.scrollRoot || !params.blockId) return null

  const outer = findRootBlockOuterById(params.editorRoot, params.blockId)
  if (!outer) return null

  return {
    blockId: params.blockId,
    top: outer.getBoundingClientRect().top,
    scrollTop: params.scrollRoot.scrollTop,
  }
}

export function restoreScrollAnchor(params: {
  editorRoot: HTMLElement
  scrollRoot: HTMLElement | null
  anchor: ScrollAnchorSnapshot | null
}): ScrollAnchorRestoreResult | null {
  if (!params.scrollRoot || !params.anchor) return null

  const outer = findRootBlockOuterById(params.editorRoot, params.anchor.blockId)
  if (!outer) return null

  const nextTop = outer.getBoundingClientRect().top
  const delta = nextTop - params.anchor.top
  if (!Number.isFinite(delta) || Math.abs(delta) < 1) {
    return {
      restored: false,
      delta: 0,
      scrollTop: params.scrollRoot.scrollTop,
    }
  }

  // 中文说明：DOM 纠偏会让当前屏幕 placeholder 变成真实 NodeView。
  // 用采样锚点保持视觉 top 不变，避免用户正在看的块被上方真实高度推走。
  params.scrollRoot.scrollTop += delta

  return {
    restored: true,
    delta,
    scrollTop: params.scrollRoot.scrollTop,
  }
}

export function recordHydratedWindowHeights(params: {
  editorRoot: HTMLElement | null
  blockIds: Iterable<string>
  owner: RenderVirtualizationOwner
}): void {
  if (!params.editorRoot) return
  for (const blockId of params.blockIds) {
    const outer = findRootBlockOuterById(params.editorRoot, blockId)
    if (outer) recordRenderVirtualizationBlockHeight(blockId, outer, params.owner)
  }
}

export function syncExistingPlaceholderHeights(params: {
  editorRoot: HTMLElement | null
  owner: RenderVirtualizationOwner
}): PlaceholderHeightSyncResult {
  const startedAt = performance.now()
  if (!params.editorRoot) {
    return { checkedCount: 0, updatedCount: 0, durationMs: 0 }
  }

  let checkedCount = 0
  let updatedCount = 0
  const placeholders = params.editorRoot.querySelectorAll(ROOT_BLOCK_PLACEHOLDER_SELECTOR)
  placeholders.forEach(element => {
    if (!(element instanceof HTMLElement)) return
    const blockId = readRootBlockIdFromElement(element)
    if (!blockId) return

    checkedCount += 1
    const nextHeight = Math.max(
      1,
      Math.round(getRenderVirtualizationBlockHeight(blockId, params.owner))
    )
    if (element.style.minHeight === `${nextHeight}px`) return

    element.style.minHeight = `${nextHeight}px`
    updatedCount += 1
  })

  return {
    checkedCount,
    updatedCount,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  }
}
