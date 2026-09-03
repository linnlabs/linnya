import { Schema } from 'prosemirror-model'
import { EditorState, type Transaction } from 'prosemirror-state'
import { describe, expect, it, vi } from 'vitest'
import {
  createRenderVirtualizationPlugin,
  getRenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import {
  commitRenderVirtualizationMetaForTest,
  commitRenderVirtualizationMeta,
  type RenderWindowCommitterEditor,
  type RenderWindowCommitterView,
} from './renderWindowCommitter'

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

function createState(): EditorState {
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [
      schema.nodes.rootBlock.create(
        { id: 'block-a' },
        schema.nodes.paragraph.create(null, schema.text('block-a'))
      ),
      schema.nodes.rootBlock.create(
        { id: 'block-b' },
        schema.nodes.paragraph.create(null, schema.text('block-b'))
      ),
    ]),
    plugins: [createRenderVirtualizationPlugin()],
  })
}

describe('renderWindowCommitter', () => {
  it('atomically updates view.state and Tiptap Vue reactiveState for render-only transactions', () => {
    let viewState = createState()
    let viewProps: object = {
      state: viewState,
    }
    const dispatch = vi.fn<(tr: Transaction) => void>()
    const reactiveState = {
      value: viewState,
    }
    const view: RenderWindowCommitterView = {
      get state() {
        return viewState
      },
      dispatch,
      get props() {
        return viewProps
      },
      update(nextProps) {
        viewProps = nextProps
        const maybeState = (nextProps as { state?: unknown }).state
        if (maybeState instanceof EditorState) {
          viewState = maybeState
        }
      },
      updateState(nextState) {
        viewState = nextState
      },
    }
    const editor: RenderWindowCommitterEditor & { reactiveState: { value: EditorState } } = {
      get state() {
        return reactiveState.value
      },
      view,
      reactiveState,
    }

    const commitResult = commitRenderVirtualizationMeta(editor, {
      setEnabled: true,
      hydrate: ['block-b'],
    })

    expect(commitResult.didCommit).toBe(true)
    expect(commitResult.mode).toBe('atomic-update-state')
    expect(commitResult.viewStateUpdated).toBe(true)
    expect(commitResult.reactiveStateSynced).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
    expect(getRenderVirtualizationState(view.state)?.hydratedSet.has('block-b')).toBe(true)
    expect(getRenderVirtualizationState(editor.state)?.hydratedSet.has('block-b')).toBe(true)
    expect(editor.state).toBe(view.state)
  })

  it('keeps view-only dispatch isolated in the test-only adapter', () => {
    let viewState = createState()
    const view: RenderWindowCommitterView = {
      get state() {
        return viewState
      },
      dispatch(tr) {
        viewState = viewState.apply(tr)
      },
      updateState(nextState) {
        viewState = nextState
      },
    }

    const commitResult = commitRenderVirtualizationMetaForTest(view, {
      setEnabled: true,
      hydrate: ['block-a'],
    })

    expect(commitResult.didCommit).toBe(true)
    expect(commitResult.mode).toBe(null)
    expect(getRenderVirtualizationState(view.state)?.hydratedSet.has('block-a')).toBe(true)
  })

  it('does not dispatch empty render virtualization meta', () => {
    let viewState = createState()
    const dispatch = vi.fn<(tr: Transaction) => void>((tr) => {
      viewState = viewState.apply(tr)
    })
    const view: RenderWindowCommitterView = {
      get state() {
        return viewState
      },
      dispatch,
    }

    const editor: RenderWindowCommitterEditor = {
      get state() {
        return viewState
      },
      view,
    }
    const commitResult = commitRenderVirtualizationMeta(editor, {})

    expect(commitResult).toEqual({
      didCommit: false,
      mode: null,
      viewStateUpdated: null,
      reactiveStateSynced: false,
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('fails fast when a production editor view cannot atomically update state', () => {
    const viewState = createState()
    const view: RenderWindowCommitterView = {
      state: viewState,
      dispatch: vi.fn<(tr: Transaction) => void>(),
    }
    const editor: RenderWindowCommitterEditor = {
      state: viewState,
      view,
    }

    expect(() => commitRenderVirtualizationMeta(editor, {
      setEnabled: true,
    })).toThrow('[RenderVirtualization] commit requires a view.updateState or view.update contract')
  })
})
