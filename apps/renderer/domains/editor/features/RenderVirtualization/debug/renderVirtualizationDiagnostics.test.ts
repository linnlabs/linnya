// @vitest-environment jsdom

import { Schema } from 'prosemirror-model'
import { EditorState, NodeSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  hydrateKeyboardTargetRootBlock,
  type KeyboardPreHydrationEditor,
} from '../controller/keyboardPreHydration'
import {
  createRenderVirtualizationPlugin,
  getRenderVirtualizationState,
  prepareInitialRenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import {
  collectRenderVirtualizationDiagnostics,
  dispatchRenderVirtualizationKeyProbe,
  type RenderVirtualizationDiagnosticsEditor,
} from './renderVirtualizationDiagnostics'

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

function appendRootBlockDom(parent: HTMLElement, blockId: string, mode: 'hydrated' | 'placeholder'): void {
  const block = document.createElement('div')
  block.className = mode === 'placeholder'
    ? 'root-block-outer root-block-virtual-placeholder'
    : 'root-block-outer'
  block.dataset.id = blockId
  block.setAttribute('data-root-block-render-mode', mode)
  if (mode === 'placeholder') {
    block.dataset.placeholder = 'true'
  }
  parent.appendChild(block)
}

function createEditor(blockIds: string[], initialHydratedBlockCount: number): {
  editor: RenderVirtualizationDiagnosticsEditor
  getState: () => EditorState
} {
  let state = createState(blockIds, initialHydratedBlockCount)
  const dom = document.createElement('div')
  blockIds.forEach((blockId, index) => {
    appendRootBlockDom(dom, blockId, index < initialHydratedBlockCount ? 'hydrated' : 'placeholder')
  })

  const editor: RenderVirtualizationDiagnosticsEditor = {
    get state() {
      return state
    },
    view: {
      get state() {
        return state
      },
      dom,
    },
  }

  editor.view.dom.addEventListener(
    'keydown',
    (event) => {
      const keyboardEditor: KeyboardPreHydrationEditor = {
        get state() {
          return state
        },
        view: {
          get state() {
            return state
          },
          dispatch(tr) {
            state = state.apply(tr)
          },
          updateState(nextState) {
            state = nextState
          },
          endOfTextblock: () => true,
        },
      }
      const hydrated = hydrateKeyboardTargetRootBlock(
        keyboardEditor,
        event
      )

      if (!hydrated) return

      const virtualizationState = getRenderVirtualizationState(state)
      blockIds.forEach((blockId) => {
        const element = dom.querySelector(`[data-id="${blockId}"]`)
        if (!(element instanceof HTMLElement)) return
        if (!virtualizationState?.hydratedSet.has(blockId)) return
        element.dataset.placeholder = 'false'
        element.classList.remove('root-block-virtual-placeholder')
        element.setAttribute('data-root-block-render-mode', 'hydrated')
      })
    },
    { capture: true }
  )

  return {
    editor,
    getState: () => state,
  }
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

describe('renderVirtualizationDiagnostics', () => {
  it('collects doc, DOM and virtualization state without touching business stores', () => {
    const { editor } = createEditor(['block-a', 'block-b', 'block-c'], 1)

    const snapshot = collectRenderVirtualizationDiagnostics(editor)

    expect(snapshot.ok).toBe(true)
    expect(snapshot.virtualizationEnabled).toBe(true)
    expect(snapshot.docRootBlockCount).toBe(3)
    expect(snapshot.dom).toEqual({
      rootBlockDomCount: 3,
      placeholderDomCount: 2,
      hydratedDomCount: 1,
    })
    expect(snapshot.firstRootBlock?.blockId).toBe('block-a')
    expect(snapshot.firstRootBlock?.hydratedByVirtualization).toBe(true)
    expect(snapshot.lastRootBlock?.blockId).toBe('block-c')
    expect(snapshot.lastRootBlock?.placeholderDom).toBe(true)
  })

  it('probes document boundary keyboard hydration in a real DOM event path', () => {
    const { editor, getState } = createEditor(['block-a', 'block-b', 'block-c'], 0)
    const blockAPos = findRootBlockPos(editor.state, 'block-a')
    let state = getState().apply(getState().tr.setSelection(NodeSelection.create(getState().doc, blockAPos)))

    const probingEditor: RenderVirtualizationDiagnosticsEditor = {
      get state() {
        return state
      },
      view: {
        get state() {
          return state
        },
        dom: editor.view.dom,
      },
    }

    probingEditor.view.dom.addEventListener(
      'keydown',
      (event) => {
        const keyboardEditor: KeyboardPreHydrationEditor = {
          get state() {
            return state
          },
          view: {
            get state() {
              return state
            },
            dispatch(tr) {
              state = state.apply(tr)
            },
            updateState(nextState) {
              state = nextState
            },
          },
        }
        hydrateKeyboardTargetRootBlock(
          keyboardEditor,
          event
        )
      },
      { capture: true }
    )

    const result = dispatchRenderVirtualizationKeyProbe('End', { ctrlKey: true }, probingEditor)

    expect(result.ok).toBe(true)
    expect(result.expectedBoundaryTargetBlockId).toBe('block-c')
    expect(result.before.lastRootBlock?.hydratedByVirtualization).toBe(false)
    expect(result.after.lastRootBlock?.hydratedByVirtualization).toBe(true)
  })
})
