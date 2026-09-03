import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  createRenderVirtualizationPlugin,
  renderVirtualizationPluginKey,
  type RenderVirtualizationMeta,
} from '../state/renderVirtualizationPlugin'
import { ROOT_BLOCK_RENDER_MODE_SPEC_KEY } from './rootBlockRenderMode'
import { resolveRootBlockRenderMode } from './resolveRootBlockRenderMode'

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

function createState(blockIds = ['block-a']): EditorState {
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(
      null,
      blockIds.map((blockId) =>
        schema.nodes.rootBlock.create(
          { id: blockId },
          schema.nodes.paragraph.create(null, schema.text(blockId))
        )
      )
    ),
    plugins: [createRenderVirtualizationPlugin()],
  })
}

function applyMeta(state: EditorState, meta: RenderVirtualizationMeta): EditorState {
  return state.apply(state.tr.setMeta(renderVirtualizationPluginKey, meta))
}

describe('resolveRootBlockRenderMode', () => {
  it('uses explicit decoration mode before plugin state', () => {
    const state = applyMeta(createState(), {
      setEnabled: true,
    })

    expect(
      resolveRootBlockRenderMode({
        blockId: 'block-a',
        editorState: state,
        decorations: [{ spec: { [ROOT_BLOCK_RENDER_MODE_SPEC_KEY]: 'hydrated' } }],
      })
    ).toBe('hydrated')
  })

  it('falls back to plugin state when decoration has no explicit mode', () => {
    let state = applyMeta(createState(['block-a', 'block-b']), {
      setEnabled: true,
    })

    expect(
      resolveRootBlockRenderMode({
        blockId: 'block-b',
        editorState: state,
      })
    ).toBe('placeholder')

    state = applyMeta(state, {
      hydrate: ['block-b'],
    })

    expect(
      resolveRootBlockRenderMode({
        blockId: 'block-b',
        editorState: state,
      })
    ).toBe('hydrated')
  })

  it('treats an empty decoration list as placeholder during NodeView update', () => {
    const state = applyMeta(createState(['block-a']), {
      setEnabled: true,
      hydrate: ['block-a'],
    })

    expect(
      resolveRootBlockRenderMode({
        blockId: 'block-a',
        editorState: state,
        decorations: [],
        virtualizationEnabled: true,
      })
    ).toBe('placeholder')
  })

  it('keeps blocks hydrated when the plugin state is not ready yet', () => {
    expect(
      resolveRootBlockRenderMode({
        blockId: 'block-a',
        editorState: null,
        virtualizationEnabled: true,
      })
    ).toBe('hydrated')
  })

  it('lets the runtime inactive flag override stale enabled plugin state', () => {
    const state = applyMeta(createState(), {
      setEnabled: true,
    })

    expect(
      resolveRootBlockRenderMode({
        blockId: 'block-a',
        editorState: state,
        virtualizationEnabled: false,
      })
    ).toBe('hydrated')
  })
})
