import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import {
  MarkdownAnnotationsSchema,
  type MarkdownAnnotation,
} from '@app/schemas'

export interface DocumentOwnedAnnotation extends MarkdownAnnotation {
  readonly blockId: string
}

interface RootBlockLocation {
  readonly node: ProseMirrorNode
  readonly position: number
}

function findRootBlock(state: EditorState, blockId: string): RootBlockLocation | null {
  let location: RootBlockLocation | null = null
  state.doc.forEach((node, position) => {
    if (location || node.type.name !== 'rootBlock' || node.attrs.id !== blockId) return
    location = { node, position }
  })
  return location
}

/** 从 ProseMirror 文档派生 Annotation read model；不再访问旁路数据库。 */
export function readAnnotationsFromDocument(
  doc: ProseMirrorNode
): DocumentOwnedAnnotation[] {
  const annotations: DocumentOwnedAnnotation[] = []
  doc.forEach(node => {
    if (node.type.name !== 'rootBlock' || typeof node.attrs.id !== 'string') return
    const blockAnnotations = MarkdownAnnotationsSchema.parse(node.attrs.annotations ?? [])
    for (const annotation of blockAnnotations) {
      annotations.push({ ...annotation, blockId: node.attrs.id })
    }
  })
  return annotations
}

/**
 * 生成一次 rootBlock attrs transaction。
 *
 * Annotation 与正文属于同一个文档版本，因此写入必须与普通编辑走同一条
 * ProseMirror transaction/自动保存链路。
 */
export function replaceRootBlockAnnotations(
  state: EditorState,
  blockId: string,
  annotations: readonly MarkdownAnnotation[]
): Transaction {
  const location = findRootBlock(state, blockId)
  if (!location) {
    throw new Error(`[Annotation] 找不到 rootBlock: ${blockId}`)
  }

  const validated = MarkdownAnnotationsSchema.parse(annotations)
  if (
    validated.length > 0
    && location.node.firstChild?.type.name === 'baseBlock'
    && location.node.firstChild.content.size === 0
  ) {
    throw new Error('[Annotation] 空 baseBlock 没有可序列化的 Markdown 锚点')
  }
  return state.tr.setNodeMarkup(location.position, undefined, {
    ...location.node.attrs,
    annotations: validated,
  })
}
