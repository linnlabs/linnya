import { Schema } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  createRenderVirtualizationPlugin,
  findSelectionRootBlockId,
  prepareInitialRenderVirtualizationState,
} from '../../../features/RenderVirtualization/state/renderVirtualizationPlugin'
import { createRootBlock } from './InsertCommands'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock*' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'baseBlock | codeBlock | imageBlock',
      toDOM: node => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    baseBlock: {
      group: 'block',
      content: 'text*',
      attrs: { id: { default: null } },
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    codeBlock: {
      group: 'block',
      content: 'text*',
      code: true,
      attrs: { id: { default: null } },
      toDOM: () => ['pre', ['code', 0]],
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    },
    imageBlock: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { id: { default: null }, src: { default: '' } },
      toDOM: node => ['img', { 'data-block-id': node.attrs.id, src: node.attrs.src }],
      parseDOM: [{ tag: 'img[data-block-id]' }],
    },
  },
})

function createEmptyState() {
  const state = EditorState.create({
    schema,
    plugins: [createRenderVirtualizationPlugin()],
  })
  return prepareInitialRenderVirtualizationState(state, {
    enabled: true,
    initialHydratedBlockCount: 0,
  })
}

function runCreateRootBlock(options) {
  let state = createEmptyState()
  const editor = { schema }
  const command = createRootBlock(options)

  const ok = command({
    state,
    editor,
    dispatch: tr => {
      state = state.apply(tr)
    },
  })

  return { ok, state }
}

describe('InsertCommands createRootBlock', () => {
  it('uses TextSelection for inserted codeBlock content', () => {
    const { ok, state } = runCreateRootBlock({
      position: 'end',
      rootAttrs: { id: 'code-root' },
      blockAttrs: { id: 'code-content' },
      contentType: 'codeBlock',
    })

    expect(ok).toBe(true)
    expect(state.selection).toBeInstanceOf(TextSelection)
    expect(state.selection.from).toBe(2)
    expect(findSelectionRootBlockId(state)).toBe('code-root')
  })

  it('uses NodeSelection for inserted imageBlock content', () => {
    const { ok, state } = runCreateRootBlock({
      position: 'end',
      rootAttrs: { id: 'image-root' },
      blockAttrs: { id: 'image-content', src: 'image.png' },
      contentType: 'imageBlock',
    })

    expect(ok).toBe(true)
    expect(state.selection).toBeInstanceOf(NodeSelection)
    expect(state.selection.from).toBe(1)
    expect(findSelectionRootBlockId(state)).toBe('image-root')
  })
})
