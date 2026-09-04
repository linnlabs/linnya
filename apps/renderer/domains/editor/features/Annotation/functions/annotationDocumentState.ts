import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import {
  MarkdownAnnotationSchema,
  MarkdownAnnotationsSchema,
  type MarkdownAnnotation,
} from '@app/schemas'

export interface DocumentOwnedAnnotation extends MarkdownAnnotation {
  readonly blockId: string
}

export interface AnnotationMergePlan {
  readonly transaction: Transaction | null
  readonly mergedCount: number
  readonly missingBlockIds: readonly string[]
}

interface RootBlockLocation {
  readonly node: ProseMirrorNode
  readonly position: number
}

function markAsInternal(transaction: Transaction | null): Transaction | null {
  return transaction ? transaction.setMeta('internal', true) : null
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

/** 把后端新文档版本中的 Annotation 合并进当前编辑器，不覆盖并发正文编辑。 */
export function mergeDocumentAnnotations(
  state: EditorState,
  incoming: readonly DocumentOwnedAnnotation[]
): AnnotationMergePlan {
  const incomingByBlockId = new Map<string, MarkdownAnnotation[]>()
  for (const item of incoming) {
    const annotation = MarkdownAnnotationSchema.parse({
      id: item.id,
      content: item.content,
      author: item.author,
      state: item.state,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      resolvedAt: item.resolvedAt,
      replies: item.replies,
      meta: item.meta,
    })
    const bucket = incomingByBlockId.get(item.blockId)
    if (bucket) bucket.push(annotation)
    else incomingByBlockId.set(item.blockId, [annotation])
  }

  let transaction: Transaction | null = null
  let mergedCount = 0
  const found = new Set<string>()
  state.doc.forEach((node, position) => {
    if (node.type.name !== 'rootBlock' || typeof node.attrs.id !== 'string') return
    const additions = incomingByBlockId.get(node.attrs.id)
    if (!additions) return
    found.add(node.attrs.id)

    const existing = MarkdownAnnotationsSchema.parse(node.attrs.annotations ?? [])
    const existingIds = new Set(existing.map(annotation => annotation.id))
    const missing = additions.filter(annotation => !existingIds.has(annotation.id))
    if (missing.length === 0) return

    transaction = (transaction ?? state.tr).setNodeMarkup(position, undefined, {
      ...node.attrs,
      annotations: [...existing, ...missing],
    })
    mergedCount += missing.length
  })

  return {
    // 后端 Review 已经持久化了对应文档版本；回流只同步本地投影，禁止再次触发 autosave。
    transaction: markAsInternal(transaction),
    mergedCount,
    missingBlockIds: [...incomingByBlockId.keys()].filter(blockId => !found.has(blockId)),
  }
}
