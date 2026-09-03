import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'

export type GenerateCitationInstanceId = () => string

function remapNode(
  node: ProseMirrorNode,
  generateCitationId: GenerateCitationInstanceId
): ProseMirrorNode {
  if (node.type.name === 'citationNode') {
    return node.type.create({ ...node.attrs, citationId: generateCitationId() }, null, node.marks)
  }
  if (node.isLeaf) return node
  return node.copy(
    Fragment.fromArray(node.content.content.map(child => remapNode(child, generateCitationId)))
  )
}

/**
 * CitationNode 的 citationId 表示当前文档中的引用实例，而不是来源身份。
 * 粘贴会复制 HTML attrs，因此必须只重建实例 ID；ref/sourceId/blockId 与来源快照保持原样。
 */
export function remapPastedCitationIdentities(
  slice: Slice,
  generateCitationId: GenerateCitationInstanceId = () => crypto.randomUUID()
): Slice {
  const content = Fragment.fromArray(
    slice.content.content.map(node => remapNode(node, generateCitationId))
  )
  return new Slice(content, slice.openStart, slice.openEnd)
}
