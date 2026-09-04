import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import { reactive } from 'vue'

import {
  confirmCreatingAnnotation,
  startCreatingAnnotation,
} from './commands/AnnoCreateCommands'
import { readAnnotationsFromDocument } from './functions/annotationDocumentState'
import { useAnnotationStore } from './useAnnotationStore'

function createEditor() {
  let state = EditorState.create({
    schema: workspaceMarkdownSchemaLite,
    doc: workspaceMarkdownSchemaLite.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root-1', annotations: [] },
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
  const listeners = new Set()
  const editor = {
    isDestroyed: false,
    schema: workspaceMarkdownSchemaLite,
    get state() {
      return state
    },
    view: {
      dispatch(transaction) {
        state = state.apply(transaction)
        for (const listener of listeners) listener({ transaction })
      },
    },
    on(event, listener) {
      if (event === 'transaction') listeners.add(listener)
    },
    off(event, listener) {
      if (event === 'transaction') listeners.delete(listener)
    },
  }
  return editor
}

describe('useAnnotationStore document ownership', () => {
  it('manual create flow leaves exactly one confirmed panel and one document annotation', async () => {
    const editor = createEditor()
    const store = reactive(useAnnotationStore({ editor }))
    const panelPositionManager = {
      calculateInitialPositionCSS: () => ({ top: '12px', left: '34px' }),
      handleOverlapsOnly: async () => false,
      invalidateLayoutCacheForAnnotation: () => undefined,
      recalculateAllPositions: async () => false,
    }
    store.initialize()

    const annotationId = await startCreatingAnnotation({
      blockId: 'root-1',
      annotationStore: store,
      panelPositionManager,
    })
    expect(store.annotations).toHaveLength(1)
    expect(store.annotations[0]).toMatchObject({ id: annotationId, state: 'creating' })

    const confirmedId = await confirmCreatingAnnotation({
      blockId: 'root-1',
      content: '手动批注',
      annotationStore: store,
      panelPositionManager,
    })

    expect(confirmedId).toBe(annotationId)
    expect(store.annotations).toHaveLength(1)
    expect(store.annotations[0]).toMatchObject({
      id: annotationId,
      content: '手动批注',
      state: 'confirmed',
    })
    expect(readAnnotationsFromDocument(editor.state.doc)).toHaveLength(1)

    store.cleanup()
  })

  it('keeps transient states local and persists confirmed changes in rootBlock attrs', () => {
    const editor = createEditor()
    const store = useAnnotationStore({ editor })
    store.initialize()

    const creating = store.addAnnotation({
      blockId: 'root-1',
      content: '',
      state: 'creating',
      author: 'User',
    })
    expect(readAnnotationsFromDocument(editor.state.doc)).toEqual([])

    expect(store.updateAnnotation(creating.id, {
      content: '初稿',
      state: 'confirmed',
    })).toBe(true)
    expect(readAnnotationsFromDocument(editor.state.doc)[0]).toMatchObject({
      id: creating.id,
      blockId: 'root-1',
      content: '初稿',
      state: 'confirmed',
    })

    expect(store.updateAnnotation(creating.id, { state: 'editing' })).toBe(true)
    expect(readAnnotationsFromDocument(editor.state.doc)[0].state).toBe('confirmed')
    expect(store.updateAnnotation(creating.id, {
      content: '定稿',
      state: 'confirmed',
    })).toBe(true)
    expect(readAnnotationsFromDocument(editor.state.doc)[0].content).toBe('定稿')

    expect(store.updateAnnotation(creating.id, { state: 'resolved' })).toBe(true)
    expect(readAnnotationsFromDocument(editor.state.doc)[0]).toMatchObject({
      state: 'resolved',
      resolvedAt: expect.any(String),
    })
    expect(store.removeAnnotation(creating.id)).toBe(true)
    expect(readAnnotationsFromDocument(editor.state.doc)).toEqual([])

    store.cleanup()
  })

  it('merges backend annotations without replacing local text', () => {
    const editor = createEditor()
    const store = useAnnotationStore({ editor })
    store.initialize()
    editor.view.dispatch(editor.state.tr.insertText('本地', 2))

    const content = structuredClone(editor.state.doc.toJSON())
    content.content[0].attrs.annotations = [{
      id: 'annotation-review',
      content: '审阅意见',
      author: 'Reviewer',
      state: 'confirmed',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      resolvedAt: null,
      replies: [],
      meta: { source: 'review', reviewRunId: 'review-1' },
    }]

    expect(store.mergeAnnotationsFromDocumentJson(content)).toBe(1)
    expect(editor.state.doc.textContent).toContain('本地')
    expect(readAnnotationsFromDocument(editor.state.doc)[0].id).toBe('annotation-review')
  })
})
