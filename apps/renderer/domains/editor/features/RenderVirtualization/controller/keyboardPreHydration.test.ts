// @vitest-environment jsdom

import { Schema } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { describe, expect, it, vi } from 'vitest'
import {
  createRenderVirtualizationPlugin,
  getRenderVirtualizationState,
  prepareInitialRenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import {
  hydrateKeyboardTargetRootBlock,
  type KeyboardPreHydrationEditor,
  type KeyboardPreHydrationEditorView,
} from './keyboardPreHydration'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'paragraph',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
  },
})

function createState(blockIds: string[], initialHydratedBlockCount: number): EditorState {
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(
      null,
      blockIds.map((id) =>
        schema.nodes.rootBlock.create(
          { id },
          schema.nodes.paragraph.create(null, schema.text(id))
        )
      )
    ),
    plugins: [createRenderVirtualizationPlugin()],
  })

  return prepareInitialRenderVirtualizationState(state, {
    enabled: true,
    initialHydratedBlockCount,
  })
}

function createView(state: EditorState): {
  editor: KeyboardPreHydrationEditor
  view: KeyboardPreHydrationEditorView
  getState: () => EditorState
  dispatchCount: () => number
} {
  let currentState = state
  let dispatched = 0
  const view: KeyboardPreHydrationEditorView = {
    get state() {
      return currentState
    },
    dispatch(tr) {
      dispatched += 1
      currentState = currentState.apply(tr)
    },
    updateState(nextState) {
      dispatched += 1
      currentState = nextState
    },
    endOfTextblock: vi.fn(() => true),
  }
  const editor: KeyboardPreHydrationEditor = {
    get state() {
      return currentState
    },
    view,
  }

  return {
    editor,
    view,
    getState: () => currentState,
    dispatchCount: () => dispatched,
  }
}

function createKeyboardEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
}

function findRootBlockPos(state: EditorState, blockId: string): number {
  let foundPos = -1
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'rootBlock') return true
    if (node.attrs.id === blockId) {
      foundPos = pos
      return false
    }
    return false
  })
  return foundPos
}

describe('hydrateKeyboardTargetRootBlock', () => {
  it('hydrates the next placeholder rootBlock before ArrowDown leaves the current textblock', () => {
    const { editor, view, getState, dispatchCount } = createView(createState(['block-a', 'block-b'], 1))
    const state = view.state
    const cursorAtEnd = TextSelection.create(state.doc, 8)
    view.dispatch(state.tr.setSelection(cursorAtEnd))

    const hydrated = hydrateKeyboardTargetRootBlock(editor, createKeyboardEvent('ArrowDown'))

    expect(hydrated).toBe(true)
    expect(dispatchCount()).toBe(2)
    expect(getRenderVirtualizationState(getState())?.hydratedSet.has('block-b')).toBe(true)
  })

  it('hydrates the previous placeholder rootBlock before ArrowLeft leaves the current textblock', () => {
    const { editor, view, getState } = createView(createState(['block-a', 'block-b'], 0))
    const state = view.state
    const blockBStartTextPos = 13
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, blockBStartTextPos)))

    const hydrated = hydrateKeyboardTargetRootBlock(editor, createKeyboardEvent('ArrowLeft'))

    expect(hydrated).toBe(true)
    expect(getRenderVirtualizationState(getState())?.hydratedSet.has('block-a')).toBe(true)
  })

  it('hydrates the adjacent rootBlock from a rootBlock NodeSelection', () => {
    const { editor, view, getState } = createView(createState(['block-a', 'block-b'], 1))
    const state = view.state
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, 0)))

    const hydrated = hydrateKeyboardTargetRootBlock(editor, createKeyboardEvent('ArrowDown'))

    expect(hydrated).toBe(true)
    expect(getRenderVirtualizationState(getState())?.hydratedSet.has('block-b')).toBe(true)
  })

  it('ignores modified key events so block move shortcuts can handle them', () => {
    const { editor, view, dispatchCount } = createView(createState(['block-a', 'block-b'], 1))
    const state = view.state
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 8)))

    const hydrated = hydrateKeyboardTargetRootBlock(
      editor,
      createKeyboardEvent('ArrowDown', { altKey: true })
    )

    expect(hydrated).toBe(false)
    expect(dispatchCount()).toBe(1)
  })

  it('does nothing when the adjacent rootBlock is already hydrated', () => {
    const { editor, view, dispatchCount } = createView(createState(['block-a', 'block-b'], 2))
    const state = view.state
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 8)))

    const hydrated = hydrateKeyboardTargetRootBlock(editor, createKeyboardEvent('ArrowDown'))

    expect(hydrated).toBe(false)
    expect(dispatchCount()).toBe(1)
  })

  it('hydrates the last placeholder rootBlock before Ctrl+End jumps to document end', () => {
    const { editor, view, getState, dispatchCount } = createView(
      createState(['block-a', 'block-b', 'block-c'], 1)
    )

    const hydrated = hydrateKeyboardTargetRootBlock(
      editor,
      createKeyboardEvent('End', { ctrlKey: true })
    )

    expect(hydrated).toBe(true)
    expect(dispatchCount()).toBe(1)
    expect(getRenderVirtualizationState(getState())?.hydratedSet.has('block-c')).toBe(true)
  })

  it('hydrates the first placeholder rootBlock before Meta+ArrowUp jumps to document start', () => {
    const { editor, view, getState, dispatchCount } = createView(
      createState(['block-a', 'block-b', 'block-c'], 0)
    )
    const blockCPos = findRootBlockPos(view.state, 'block-c')
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, blockCPos)))

    const hydrated = hydrateKeyboardTargetRootBlock(
      editor,
      createKeyboardEvent('ArrowUp', { metaKey: true })
    )

    expect(hydrated).toBe(true)
    expect(dispatchCount()).toBe(2)
    expect(getRenderVirtualizationState(getState())?.hydratedSet.has('block-a')).toBe(true)
  })

  it('does not treat Ctrl+ArrowDown as a document boundary jump', () => {
    const { editor, view, dispatchCount } = createView(createState(['block-a', 'block-b', 'block-c'], 1))

    const hydrated = hydrateKeyboardTargetRootBlock(
      editor,
      createKeyboardEvent('ArrowDown', { ctrlKey: true })
    )

    expect(hydrated).toBe(false)
    expect(dispatchCount()).toBe(0)
  })
})
