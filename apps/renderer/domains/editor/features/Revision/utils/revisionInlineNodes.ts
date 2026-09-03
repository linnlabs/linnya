import type { Mark, MarkType, Node as ProseMirrorNode } from 'prosemirror-model'

export function isTrackableInlineRevisionNode(node: ProseMirrorNode): boolean {
  if (!node.isInline) {
    return false
  }

  if (node.isText) {
    return typeof node.text === 'string' && node.text.length > 0
  }

  return true
}

export function getInlineRevisionUnitCount(node: ProseMirrorNode): number {
  if (!isTrackableInlineRevisionNode(node)) {
    return 0
  }

  return node.isText ? (node.text?.length ?? 0) : 1
}

export function findRevisionMarkOnNode(
  node: ProseMirrorNode,
  revisionMarkType: MarkType,
  revisionId?: string | null
): Mark | undefined {
  if (!isTrackableInlineRevisionNode(node) || node.marks.length === 0) {
    return undefined
  }

  return node.marks.find((mark) => {
    if (mark.type !== revisionMarkType) {
      return false
    }
    if (!revisionId) {
      return true
    }
    return mark.attrs.revisionId === revisionId
  })
}

export function hasUnmarkedMeaningfulInlineContent(
  node: ProseMirrorNode,
  revisionMarkType: MarkType,
  revisionId: string
): boolean {
  if (!isTrackableInlineRevisionNode(node)) {
    return false
  }

  if (findRevisionMarkOnNode(node, revisionMarkType, revisionId)) {
    return false
  }

  if (node.isText) {
    return (node.text?.trim().length ?? 0) > 0
  }

  return true
}

export function cloneNodeWithRevisionMark(
  node: ProseMirrorNode,
  revisionMark: Mark
): ProseMirrorNode {
  if (isTrackableInlineRevisionNode(node)) {
    return node.mark([...node.marks, revisionMark])
  }

  if (node.content && node.content.size > 0) {
    const children: ProseMirrorNode[] = []
    node.content.forEach((child) => {
      children.push(cloneNodeWithRevisionMark(child, revisionMark))
    })
    return node.type.create(node.attrs, children, node.marks)
  }

  return node
}
