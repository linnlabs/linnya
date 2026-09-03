import {
  DEFAULT_NEAR_VIEWPORT_MARGIN_PX,
  ROOT_BLOCK_OUTER_SELECTOR,
  findRootBlockOuterById,
  readRootBlockIdFromElement,
} from '../../../../ui/composables/rootBlockViewportSnapshot'
import { ROOT_BLOCK_RENDER_MODE_DATA_ATTR } from '../../../RenderVirtualization/view/rootBlockRenderMode'
import type { RevisionOverlayRootBlockSnapshot } from './revisionOverlayTypes'

interface RootBlockViewportRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

interface RevisionOverlayBlockCandidate {
  blockId: string
  outer: HTMLElement
  rootBlock: HTMLElement
  rootBlockRect: RootBlockViewportRect
}

export interface CollectRevisionOverlayRootBlocksParams {
  editorRoot: HTMLElement | null
  overlayRoot: HTMLElement | null
  scrollRoot: HTMLElement | null
  marginPx?: number
  maxItems?: number
  includeBlockIds?: readonly string[]
}

function isVisibleAroundViewport(
  rect: Pick<DOMRect, 'height' | 'width' | 'top' | 'bottom'>,
  scrollRoot: HTMLElement | null,
  marginPx: number
): boolean {
  if (rect.height === 0 && rect.width === 0) return false

  const rootRect = scrollRoot?.getBoundingClientRect()
  const viewportTop = rootRect?.top ?? 0
  const viewportBottom = rootRect?.bottom ?? window.innerHeight

  return rect.top < viewportBottom + marginPx && rect.bottom > viewportTop - marginPx
}

function isPlaceholderElement(el: HTMLElement): boolean {
  return (
    el.dataset.placeholder === 'true' ||
    el.classList.contains('root-block-virtual-placeholder') ||
    el.getAttribute(ROOT_BLOCK_RENDER_MODE_DATA_ATTR) === 'placeholder'
  )
}

function readRect(el: HTMLElement): RootBlockViewportRect {
  const rect = el.getBoundingClientRect()
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

function findDirectRootBlockElement(outer: HTMLElement): HTMLElement {
  for (const child of Array.from(outer.children)) {
    if (child instanceof HTMLElement && child.classList.contains('root-block')) {
      return child
    }
  }
  return outer
}

function createRevisionOverlayBlockCandidate(
  outer: HTMLElement
): RevisionOverlayBlockCandidate | null {
  const blockId = readRootBlockIdFromElement(outer)
  if (!blockId) return null

  const rootBlock = findDirectRootBlockElement(outer)
  return {
    blockId,
    outer,
    rootBlock,
    rootBlockRect: readRect(rootBlock),
  }
}

function collectForcedViewportBlocks(
  editorRoot: HTMLElement,
  blockIds: readonly string[],
  seen: Set<string>
): RevisionOverlayBlockCandidate[] {
  const blocks: RevisionOverlayBlockCandidate[] = []
  for (const blockId of blockIds) {
    if (!blockId || seen.has(blockId)) continue
    const outer = findRootBlockOuterById(editorRoot, blockId)
    if (!outer) continue
    const block = createRevisionOverlayBlockCandidate(outer)
    if (!block) continue
    seen.add(block.blockId)
    blocks.push(block)
  }
  return blocks
}

/**
 * 读取当前视口附近的 rootBlock 几何信息。
 *
 * 中文说明：
 * - 这里只服务 hover / selection 浮动工具栏，不承载 pending header；
 * - 候选 DOM 只来自 includeBlockIds，通常是 hover、toolbar hover、selection 这 1-3 个块；
 * - 禁止在这里全量扫描或 point sampling 视口，避免重新制造第二套滚动事实源。
 */
export function collectRevisionOverlayRootBlocks(
  params: CollectRevisionOverlayRootBlocksParams
): RevisionOverlayRootBlockSnapshot[] {
  const {
    editorRoot,
    overlayRoot,
    scrollRoot,
    marginPx = DEFAULT_NEAR_VIEWPORT_MARGIN_PX,
    maxItems = 120,
    includeBlockIds = [],
  } = params
  if (!editorRoot || !overlayRoot) return []

  const overlayRect = overlayRoot.getBoundingClientRect()
  const snapshots: RevisionOverlayRootBlockSnapshot[] = []
  const seen = new Set<string>()

  for (const block of collectForcedViewportBlocks(editorRoot, includeBlockIds, seen)) {
    if (snapshots.length >= maxItems) break
    const { blockId, outer, rootBlockRect } = block
    if (!isVisibleAroundViewport(rootBlockRect, scrollRoot, marginPx)) continue
    snapshots.push({
      blockId,
      top: rootBlockRect.top - overlayRect.top,
      left: rootBlockRect.left - overlayRect.left,
      width: rootBlockRect.width,
      height: rootBlockRect.height,
      bottom: rootBlockRect.bottom - overlayRect.top,
      isPlaceholder: isPlaceholderElement(outer),
      renderMode: outer.getAttribute(ROOT_BLOCK_RENDER_MODE_DATA_ATTR),
    })
  }

  snapshots.sort((left, right) => left.top - right.top)
  return snapshots
}

export function readRootBlockIdFromEventTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null

  const blockEl = target.closest(ROOT_BLOCK_OUTER_SELECTOR)
  if (!(blockEl instanceof HTMLElement)) return null

  return readRootBlockIdFromElement(blockEl)
}
