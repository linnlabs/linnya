// @vitest-environment jsdom

import { Schema } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireFocusedRootBlockSelection,
  findFocusedRootBlockId,
  findSelectedRootBlockId,
  type FocusedRootBlockSelectionEditor,
} from './focusedRootBlockSelection'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'paragraph | imageBlock',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    imageBlock: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { id: { default: null } },
      toDOM: (node) => ['img', { 'data-block-id': node.attrs.id }],
      parseDOM: [{ tag: 'img[data-block-id]' }],
    },
  },
})

function createDoc() {
  return schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create(
      { id: 'block-a' },
      schema.nodes.paragraph.create(null, schema.text('alpha'))
    ),
    schema.nodes.rootBlock.create(
      { id: 'block-b' },
      schema.nodes.paragraph.create(null, schema.text('bravo'))
    ),
  ])
}

function createImageDoc() {
  return schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create(
      { id: 'image-root' },
      schema.nodes.imageBlock.create({ id: 'image-content' })
    ),
  ])
}

function createState(): EditorState {
  return EditorState.create({ schema, doc: createDoc() })
}

function createImageState(): EditorState {
  return EditorState.create({ schema, doc: createImageDoc() })
}

function findTextPosForBlockId(state: EditorState, blockId: string): number {
  let found: number | null = null
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'rootBlock' || node.attrs.id !== blockId) return true
    found = pos + 2
    return false
  })
  if (found === null) throw new Error(`missing test rootBlock: ${blockId}`)
  return found
}

function createEditor(state: EditorState): FocusedRootBlockSelectionEditor & {
  emit: (eventName: 'update' | 'selectionUpdate') => void
  listenerCount: (eventName: 'update' | 'selectionUpdate') => number
} {
  const listeners: Record<'update' | 'selectionUpdate', Set<() => void>> = {
    update: new Set(),
    selectionUpdate: new Set(),
  }

  return {
    state,
    on(eventName, callback) {
      listeners[eventName].add(callback)
    },
    off(eventName, callback) {
      listeners[eventName].delete(callback)
    },
    emit(eventName) {
      listeners[eventName].forEach((callback) => callback())
    },
    listenerCount(eventName) {
      return listeners[eventName].size
    },
  }
}

afterEach(() => {
  window.__EDITOR_LISTENER_PERF__?.clear()
})

describe('findFocusedRootBlockId', () => {
  it('returns the rootBlock when a text selection stays inside one block', () => {
    const state = createState()
    const blockBTextPos = findTextPosForBlockId(state, 'block-b')
    const nextState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, blockBTextPos))
    )

    expect(findFocusedRootBlockId(nextState)).toBe('block-b')
  })

  it('returns null for a text selection spanning multiple rootBlocks', () => {
    const state = createState()
    const blockATextPos = findTextPosForBlockId(state, 'block-a')
    const blockBTextPos = findTextPosForBlockId(state, 'block-b')
    const nextState = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, blockATextPos, blockBTextPos))
    )

    expect(findFocusedRootBlockId(nextState)).toBeNull()
  })

  it('keeps inner atomic selections focused but excludes rootBlock NodeSelection', () => {
    let state = createImageState()
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 1)))
    expect(findFocusedRootBlockId(state)).toBe('image-root')

    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
    expect(findFocusedRootBlockId(state)).toBeNull()
  })
})

describe('findSelectedRootBlockId', () => {
  it('returns the selected rootBlock only for rootBlock NodeSelection', () => {
    let state = createImageState()

    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 1)))
    expect(findSelectedRootBlockId(state)).toBeNull()

    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
    expect(findSelectedRootBlockId(state)).toBe('image-root')
  })
})

describe('acquireFocusedRootBlockSelection', () => {
  it('shares one editor listener pair across multiple BlockChrome subscribers', () => {
    const state = createState()
    const editor = createEditor(state)

    const first = acquireFocusedRootBlockSelection(editor)
    const second = acquireFocusedRootBlockSelection(editor)

    expect(editor.listenerCount('update')).toBe(1)
    expect(editor.listenerCount('selectionUpdate')).toBe(1)
    expect(window.__EDITOR_LISTENER_PERF__?.getSnapshot()).toMatchObject({
      byEvent: {
        update: 1,
        selectionUpdate: 1,
      },
    })

    const blockBTextPos = findTextPosForBlockId(editor.state, 'block-b')
    editor.state = editor.state.apply(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, blockBTextPos))
    )
    editor.emit('selectionUpdate')

    expect(first.focusedRootBlockId.value).toBe('block-b')
    expect(second.focusedRootBlockId.value).toBe('block-b')
    expect(first.selectedRootBlockId.value).toBeNull()

    editor.state = editor.state.apply(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0))
    )
    editor.emit('selectionUpdate')

    expect(first.focusedRootBlockId.value).toBeNull()
    expect(first.selectedRootBlockId.value).toBe('block-a')
    expect(second.selectedRootBlockId.value).toBe('block-a')

    first.release()
    expect(editor.listenerCount('update')).toBe(1)

    second.release()
    expect(editor.listenerCount('update')).toBe(0)
    expect(editor.listenerCount('selectionUpdate')).toBe(0)
    expect(window.__EDITOR_LISTENER_PERF__?.getSnapshot()?.total).toBe(0)
  })
})
