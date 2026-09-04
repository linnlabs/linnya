import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'

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
})
