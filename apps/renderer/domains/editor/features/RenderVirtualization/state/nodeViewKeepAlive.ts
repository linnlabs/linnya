import type { Editor } from '@tiptap/core'
import type { RenderVirtualizationKeepAliveReason } from './keepAliveRegistry'
import {
  applyRenderVirtualizationKeepAliveCommand,
  type RenderVirtualizationKeepAlivePort,
} from './keepAlivePort'

type NodeViewGetPos = () => number

export function findRootBlockIdForNodeView(
  editor: Pick<Editor, 'state'> | null | undefined,
  getPos: NodeViewGetPos | null | undefined
): string | null {
  if (!editor?.state?.doc || typeof getPos !== 'function') return null

  let pos: number
  try {
    pos = getPos()
  } catch {
    return null
  }

  if (!Number.isFinite(pos) || pos < 0 || pos > editor.state.doc.content.size) return null

  const $pos = editor.state.doc.resolve(pos)
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name !== 'rootBlock') continue

    const id = node.attrs?.id
    return typeof id === 'string' && id.length > 0 ? id : null
  }

  return null
}

export function dispatchNodeViewRenderVirtualizationKeepAlive(params: {
  target: EventTarget | null | undefined
  editor: Pick<Editor, 'state'> | null | undefined
  getPos: NodeViewGetPos | null | undefined
  reason: RenderVirtualizationKeepAliveReason
  active: boolean
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
}): void {
  const blockId = findRootBlockIdForNodeView(params.editor, params.getPos)
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
