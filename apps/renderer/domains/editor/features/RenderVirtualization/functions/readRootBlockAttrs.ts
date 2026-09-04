import type { Node as ProseMirrorNode } from 'prosemirror-model'

export interface RootBlockAttrs {
  id?: unknown
  annotations?: unknown
  position?: unknown
  isDragging?: unknown
  backgroundColor?: unknown
  textColor?: unknown
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function readRootBlockAttrs(node: ProseMirrorNode): RootBlockAttrs {
  return isObjectRecord(node.attrs) ? node.attrs : {}
}

export function readRootBlockId(node: ProseMirrorNode | null | undefined): string | null {
  if (!node) return null

  const id = readRootBlockAttrs(node).id
  return typeof id === 'string' && id.length > 0 ? id : null
}
