/**
 * slashMenuVirtualizationKeepAlive.ts
 *
 * SlashMenu 与 RootBlock 渲染虚拟化之间的保活桥。
 *
 * 中文说明：
 * - SlashMenu 使用 tippy append 到 body，菜单 DOM 不在 rootBlock 子树内；
 * - 菜单打开期间目标块仍然承载当前 selection / trigger range，不能被 placeholder 回收；
 * - 这里仅通过 editor DOM 声明 interaction-open，具体 pin/unpin 由 RenderVirtualization bridge 统一处理。
 */

import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorState } from 'prosemirror-state'
import {
  applyRenderVirtualizationKeepAliveCommand,
  type RenderVirtualizationKeepAlivePort,
} from '../../RenderVirtualization'

export interface SlashMenuKeepAliveEditor {
  isDestroyed?: boolean
  state: EditorState
  view?: {
    dom?: EventTarget | null
  } | null
}

export interface SlashMenuRangeLike {
  from: number
}

export interface SlashMenuKeepAliveController {
  pinForRange: (range: SlashMenuRangeLike | null | undefined) => void
  release: () => void
}

export interface SlashMenuKeepAliveControllerOptions {
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
}

function readRootBlockId(node: ProseMirrorNode): string | null {
  const id = node.attrs?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function findRootBlockIdAtPosition(state: EditorState, pos: number): string | null {
  if (!Number.isFinite(pos)) return null

  const safePos = Math.max(0, Math.min(pos, state.doc.content.size))
  const $pos = state.doc.resolve(safePos)

  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name !== 'rootBlock') continue
    return readRootBlockId(node)
  }

  const nodeAfter = $pos.nodeAfter
  if (nodeAfter?.type.name === 'rootBlock') {
    return readRootBlockId(nodeAfter)
  }

  const nodeBefore = $pos.nodeBefore
  if (nodeBefore?.type.name === 'rootBlock') {
    return readRootBlockId(nodeBefore)
  }

  return null
}

export function createSlashMenuKeepAliveController(
  editor: SlashMenuKeepAliveEditor,
  options: SlashMenuKeepAliveControllerOptions = {}
): SlashMenuKeepAliveController {
  let pinnedBlockId: string | null = null
  let activeTarget: EventTarget | null = null

  function readTarget(): EventTarget | null {
    if (editor.isDestroyed) return null
    return editor.view?.dom ?? null
  }

  function dispatchKeepAlive(target: EventTarget | null, blockId: string, active: boolean): void {
    if (blockId.length === 0) return
    applyRenderVirtualizationKeepAliveCommand({
      port: options.keepAlivePort,
      legacyTarget: target,
      command: {
        blockId,
        reason: 'interaction-open',
      },
      active,
    })
  }

  function release(): void {
    if (!pinnedBlockId) return

    dispatchKeepAlive(activeTarget, pinnedBlockId, false)
    pinnedBlockId = null
    activeTarget = null
  }

  function pinForRange(range: SlashMenuRangeLike | null | undefined): void {
    const nextTarget = readTarget()
    const nextBlockId = range ? findRootBlockIdAtPosition(editor.state, range.from) : null

    if (pinnedBlockId && (pinnedBlockId !== nextBlockId || activeTarget !== nextTarget)) {
      release()
    }

    if (!nextTarget || !nextBlockId || pinnedBlockId === nextBlockId) return

    dispatchKeepAlive(nextTarget, nextBlockId, true)
    pinnedBlockId = nextBlockId
    activeTarget = nextTarget
  }

  return {
    pinForRange,
    release,
  }
}
