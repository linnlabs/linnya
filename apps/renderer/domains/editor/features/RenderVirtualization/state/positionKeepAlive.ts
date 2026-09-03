import type { Editor } from '@tiptap/core'
import type { RenderVirtualizationKeepAliveReason } from './keepAliveRegistry'
import {
  applyRenderVirtualizationKeepAliveCommand,
  type RenderVirtualizationKeepAlivePort,
} from './keepAlivePort'
import { readRootBlockId } from '../functions/readRootBlockAttrs'

type EditorWithState = Pick<Editor, 'state'>

function findRootBlockIdAtResolvedPosition(
  editor: EditorWithState,
  pos: number
): string | null {
  const $pos = editor.state.doc.resolve(pos)

  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const blockId = readRootBlockId($pos.node(depth))
    if (blockId) return blockId
  }

  return null
}

/**
 * 根据任意 ProseMirror 文档位置找到外层 rootBlockId。
 *
 * 中文说明：
 * - TableBlock 常拿到的是 tablePos / cellPos，而不是 rootBlockId；
 * - pos 可能刚好落在节点边界，所以同时检查 nodeAt(pos) 与 resolve(pos - 1)；
 * - 这里只解析 doc 结构，不读取 DOM，也不依赖具体业务模块。
 */
export function findRootBlockIdAtDocumentPosition(
  editor: EditorWithState | null | undefined,
  pos: number | null | undefined
): string | null {
  if (!editor?.state?.doc || typeof pos !== 'number' || !Number.isFinite(pos)) return null

  const doc = editor.state.doc
  if (pos < 0 || pos > doc.content.size) return null

  const nodeAtPosition = pos < doc.content.size ? doc.nodeAt(pos) : null
  if (nodeAtPosition) {
    const blockId = readRootBlockId(nodeAtPosition)
    if (blockId) return blockId
  }

  const candidatePositions = pos > 0 ? [pos, pos - 1] : [pos]
  for (const candidatePos of candidatePositions) {
    const blockId = findRootBlockIdAtResolvedPosition(editor, candidatePos)
    if (blockId) return blockId
  }

  return null
}

export function dispatchPositionRenderVirtualizationKeepAlive(params: {
  target: EventTarget | null | undefined
  editor: EditorWithState | null | undefined
  pos: number | null | undefined
  reason: RenderVirtualizationKeepAliveReason
  active: boolean
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
}): void {
  const blockId = findRootBlockIdAtDocumentPosition(params.editor, params.pos)
  if (!blockId) return

  applyRenderVirtualizationKeepAliveCommand({
    port: params.keepAlivePort,
    legacyTarget: params.target ?? null,
    command: {
      blockId,
      reason: params.reason,
    },
    active: params.active,
  })
}
