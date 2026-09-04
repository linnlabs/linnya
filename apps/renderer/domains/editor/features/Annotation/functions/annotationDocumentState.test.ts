import { describe, expect, it } from 'vitest'
import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import {
  readAnnotationsFromDocument,
  replaceRootBlockAnnotations,
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

    expect(() => replaceRootBlockAnnotations(emptyState, 'root-1', [annotation]))
      .toThrow('没有可序列化的 Markdown 锚点')
    expect(readAnnotationsFromDocument(state.doc)).toHaveLength(1)
  })
})
