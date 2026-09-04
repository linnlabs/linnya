import { describe, expect, it } from 'vitest'
import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import {
  canPersistMarkdownAnnotationOnRootBlock,
  mergeDocumentAnnotations,
  readAnnotationsFromDocument,
  replaceRootBlockAnnotations,
  synchronizeDocumentAnnotations,
} from './annotationDocumentState'
import { EditorState } from 'prosemirror-state'

const annotation = {
  id: 'annotation-1',
  content: '需要补充依据',
  author: 'User',
  state: 'confirmed' as const,
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  resolvedAt: null,
  replies: [],
  meta: { source: 'manual' as const },
}

function createState(): EditorState {
  return EditorState.create({
    schema: workspaceMarkdownSchemaLite,
    doc: workspaceMarkdownSchemaLite.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root-1', annotations: [annotation] },
          content: [
            {
              type: 'baseBlock',
              attrs: { id: 'block-1', blockType: 'base' },
              content: [{ type: 'text', text: '正文' }],
            },
          ],
        },
      ],
    }),
  })
}

describe('annotationDocumentState', () => {
  it('derives block ownership from rootBlock attrs', () => {
    expect(readAnnotationsFromDocument(createState().doc)).toEqual([
      { ...annotation, blockId: 'root-1' },
    ])
  })

  it('replaces annotations through one ProseMirror transaction', () => {
    const state = createState()
    const transaction = replaceRootBlockAnnotations(state, 'root-1', [])
    const nextState = state.apply(transaction)

    expect(readAnnotationsFromDocument(nextState.doc)).toEqual([])
    expect(nextState.doc.firstChild?.textContent).toBe('正文')
  })

  it('rejects persisted annotations on an empty base block', () => {
    const state = createState()
    const emptyBase = workspaceMarkdownSchemaLite.nodes.baseBlock.create({
      id: 'block-1',
      blockType: 'base',
    })
    const emptyRoot = workspaceMarkdownSchemaLite.nodes.rootBlock.create(
      { id: 'root-1', annotations: [] },
      emptyBase
    )
    const emptyState = EditorState.create({
      schema: workspaceMarkdownSchemaLite,
      doc: workspaceMarkdownSchemaLite.nodes.doc.create(null, emptyRoot),
    })

    expect(canPersistMarkdownAnnotationOnRootBlock(state, 'root-1')).toBe(true)
    expect(canPersistMarkdownAnnotationOnRootBlock(emptyState, 'root-1')).toBe(false)
    expect(() => replaceRootBlockAnnotations(emptyState, 'root-1', [annotation]))
      .toThrow('没有可序列化的 Markdown 锚点')
    expect(readAnnotationsFromDocument(state.doc)).toHaveLength(1)
  })

  it('merges annotations without replacing concurrent text changes', () => {
    const state = createState()
    const changed = state.apply(state.tr.insertText('更新：', 2))
    const incoming = {
      ...annotation,
      id: 'annotation-review',
      blockId: 'root-1',
      meta: { source: 'review' as const, reviewRunId: 'review-1' },
    }
    const plan = mergeDocumentAnnotations(changed, [incoming])
    if (!plan.transaction) throw new Error('测试前置：应生成 merge transaction')
    const merged = changed.apply(plan.transaction)

    expect(merged.doc.textContent).toContain('更新：')
    expect(readAnnotationsFromDocument(merged.doc).map(item => item.id)).toEqual([
      'annotation-1',
      'annotation-review',
    ])
    expect(plan.mergedCount).toBe(1)
    expect(plan.transaction.getMeta('internal')).toBe(true)
  })

  it('精确同步后端批注增删改，同时保留本地正文并标记 internal', () => {
    const state = createState()
    const changed = state.apply(state.tr.insertText('本地：', 2))
    const incomingDoc = workspaceMarkdownSchemaLite.nodeFromJSON({
      ...changed.doc.toJSON(),
      content: changed.doc.toJSON().content.map((
        node: { readonly attrs?: Readonly<Record<string, unknown>> },
        index: number
      ) => index === 0
        ? { ...node, attrs: { ...node.attrs, annotations: [] } }
        : node),
    })
    const plan = synchronizeDocumentAnnotations(changed, incomingDoc)
    if (!plan.transaction) throw new Error('测试前置：应生成 sync transaction')
    const synchronized = changed.apply(plan.transaction)

    expect(synchronized.doc.textContent).toContain('本地：')
    expect(readAnnotationsFromDocument(synchronized.doc)).toEqual([])
    expect(plan.transaction.getMeta('internal')).toBe(true)
  })
})
