import type { EditorState } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { readRootBlockId } from './readRootBlockAttrs'

const rootBlockIdsByDoc = new WeakMap<ProseMirrorNode, readonly string[]>()

export function collectRootBlockIdsFromDoc(
  doc: ProseMirrorNode,
  options: { limit?: number } = {}
): readonly string[] {
  const cached = rootBlockIdsByDoc.get(doc)
  if (cached) {
    return options.limit === undefined ? cached : cached.slice(0, options.limit)
  }

  const result: string[] = []
  const limit = options.limit ?? Number.POSITIVE_INFINITY

  doc.descendants((node) => {
    if (node.type.name !== 'rootBlock') return true

    if (result.length < limit) {
      const blockId = readRootBlockId(node)
      if (blockId) result.push(blockId)
    }

    return false
  })

  if (options.limit === undefined) {
    rootBlockIdsByDoc.set(doc, result)
  }

  return result
}

export function collectRootBlockIdsFromState(state: EditorState): readonly string[] {
  return collectRootBlockIdsFromDoc(state.doc)
}
