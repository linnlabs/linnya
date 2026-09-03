/**
 * keyboardPreHydration.ts
 *
 * 键盘跨 rootBlock 移动前的轻量预水合。
 *
 * 中文说明：
 * - placeholder rootBlock 没有 contentDOM，浏览器/ProseMirror 原生方向键移动无法直接进入其内部；
 * - 本模块只在 keydown capture 阶段判断“下一步可能进入哪个 rootBlock”；
 * - 若目标块仍是 placeholder，则同步派发 hydrate meta，让 PM 后续 keydown 处理看到真实 DOM；
 * - 不做 pin，避免临时键盘保活误释放其他来源的 pinnedSet。
 */

import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { NodeSelection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import type { DirectEditorProps } from 'prosemirror-view'
import {
  getRenderVirtualizationState,
  isRootBlockHydratedByVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import { commitRenderVirtualizationMeta } from './renderWindowCommitter'
import type { RenderWindowCommitterEditor } from './renderWindowCommitter'
import { readRootBlockId } from '../functions/readRootBlockAttrs'

type VerticalTextblockDirection = 'up' | 'down'
type KeyboardDirection = 'previous' | 'next'
type BoundaryDirection = 'start' | 'end'

export interface KeyboardPreHydrationEditorView {
  state: EditorState
  dispatch: (tr: Transaction) => void
  updateState?: (state: EditorState) => void
  props?: DirectEditorProps
  update?: (props: DirectEditorProps) => void
  endOfTextblock?: (direction: VerticalTextblockDirection) => boolean
}

export interface KeyboardPreHydrationEditor extends RenderWindowCommitterEditor {
  view: KeyboardPreHydrationEditorView
}

interface RootBlockAtPosition {
  blockId: string
  pos: number
  node: ProseMirrorNode
}

function findContainingRootBlock(state: EditorState, pos: number): RootBlockAtPosition | null {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)))

  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name !== 'rootBlock') continue

    const blockId = readRootBlockId(node)
    if (!blockId) return null

    return {
      blockId,
      pos: depth === 0 ? 0 : $pos.before(depth),
      node,
    }
  }

  return null
}

function findCurrentRootBlock(state: EditorState): RootBlockAtPosition | null {
  const { selection } = state

  if (selection instanceof NodeSelection && selection.node.type.name === 'rootBlock') {
    const blockId = readRootBlockId(selection.node)
    if (!blockId) return null
    return {
      blockId,
      pos: selection.from,
      node: selection.node,
    }
  }

  return findContainingRootBlock(state, selection.from)
}

function findAdjacentRootBlock(
  state: EditorState,
  current: RootBlockAtPosition,
  direction: KeyboardDirection
): RootBlockAtPosition | null {
  if (direction === 'next') {
    const pos = current.pos + current.node.nodeSize
    const node = state.doc.nodeAt(pos)
    if (node?.type.name !== 'rootBlock') return null

    const blockId = readRootBlockId(node)
    return blockId ? { blockId, pos, node } : null
  }

  if (current.pos <= 0) return null
  const $pos = state.doc.resolve(current.pos)
  const node = $pos.nodeBefore
  if (node?.type.name !== 'rootBlock') return null

  const blockId = readRootBlockId(node)
  return blockId ? { blockId, pos: current.pos - node.nodeSize, node } : null
}

function findBoundaryRootBlock(
  state: EditorState,
  direction: BoundaryDirection
): RootBlockAtPosition | null {
  let boundaryBlock: RootBlockAtPosition | null = null

  state.doc.forEach((node, offset) => {
    if (node.type.name !== 'rootBlock') return

    const blockId = readRootBlockId(node)
    if (!blockId) return

    const candidate = { blockId, pos: offset, node }
    if (direction === 'start' && !boundaryBlock) {
      boundaryBlock = candidate
    }
    if (direction === 'end') {
      boundaryBlock = candidate
    }
  })

  return boundaryBlock
}

function isPlainKeyboardNavigationEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false
  if (event.altKey || event.ctrlKey || event.metaKey) return false
  return true
}

function isDocumentBoundaryKeyboardEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false
  if (event.altKey) return false
  if (event.ctrlKey && event.metaKey) return false
  return event.ctrlKey || event.metaKey
}

function resolveAdjacentKeyboardDirection(
  view: KeyboardPreHydrationEditorView,
  event: KeyboardEvent
): KeyboardDirection | null {
  if (!isPlainKeyboardNavigationEvent(event)) return null

  const { selection } = view.state
  if (selection instanceof NodeSelection && selection.node.type.name === 'rootBlock') {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') return 'next'
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') return 'previous'
    return null
  }

  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const cursor = selection.$cursor
  if (!cursor) return null

  if (event.key === 'ArrowRight' && cursor.parentOffset >= cursor.parent.content.size) {
    return 'next'
  }
  if (event.key === 'ArrowLeft' && cursor.parentOffset <= 0) {
    return 'previous'
  }
  if (event.key === 'ArrowDown' && view.endOfTextblock?.('down')) {
    return 'next'
  }
  if (event.key === 'ArrowUp' && view.endOfTextblock?.('up')) {
    return 'previous'
  }

  return null
}

function resolveDocumentBoundaryDirection(event: KeyboardEvent): BoundaryDirection | null {
  if (!isDocumentBoundaryKeyboardEvent(event)) return null

  // 中文说明：Windows/Linux 的文档边界键通常是 Ctrl+Home/End；
  // macOS 常见是 Cmd+ArrowUp/Down，也兼容外接键盘上的 Cmd+Home/End。
  if (event.ctrlKey && !event.metaKey) {
    if (event.key === 'Home') return 'start'
    if (event.key === 'End') return 'end'
    return null
  }

  if (event.metaKey && !event.ctrlKey) {
    if (event.key === 'Home' || event.key === 'ArrowUp') return 'start'
    if (event.key === 'End' || event.key === 'ArrowDown') return 'end'
  }

  return null
}

function hydrateRootBlockIfNeeded(
  editor: KeyboardPreHydrationEditor,
  targetRootBlock: RootBlockAtPosition | null
): boolean {
  if (!targetRootBlock) return false

  const { view } = editor
  if (isRootBlockHydratedByVirtualizationState(view.state, targetRootBlock.blockId)) {
    return false
  }

  return commitRenderVirtualizationMeta(editor, {
    hydrate: [targetRootBlock.blockId],
  }).didCommit
}

export function hydrateKeyboardTargetRootBlock(
  editor: KeyboardPreHydrationEditor,
  event: KeyboardEvent
): boolean {
  const { view } = editor
  const virtualizationState = getRenderVirtualizationState(view.state)
  if (!virtualizationState?.enabled) return false

  const boundaryDirection = resolveDocumentBoundaryDirection(event)
  if (boundaryDirection) {
    return hydrateRootBlockIfNeeded(editor, findBoundaryRootBlock(view.state, boundaryDirection))
  }

  const direction = resolveAdjacentKeyboardDirection(view, event)
  if (!direction) return false

  const currentRootBlock = findCurrentRootBlock(view.state)
  if (!currentRootBlock) return false

  const targetRootBlock = findAdjacentRootBlock(view.state, currentRootBlock, direction)
  return hydrateRootBlockIfNeeded(editor, targetRootBlock)
}
