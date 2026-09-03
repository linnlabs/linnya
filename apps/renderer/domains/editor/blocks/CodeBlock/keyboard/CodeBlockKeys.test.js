import { Schema } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, expect, it, vi } from 'vitest'
import {
  createRenderVirtualizationPlugin,
  findSelectionRootBlockId,
  prepareInitialRenderVirtualizationState,
} from '../../../features/RenderVirtualization/state/renderVirtualizationPlugin'
import { SCHEMA_ROOT_BLOCK_TYPE_NAME_KEY } from '../../../shared/constants/editorStorageKeys'
import { handleCodeBlockShiftEnter } from './CodeBlockKeys'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'codeBlock | baseBlock',
      toDOM: node => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    codeBlock: {
      group: 'block',
      content: 'text*',
      code: true,
      attrs: {
        id: { default: null },
        blockType: { default: 'code' },
      },
      toDOM: () => ['pre', ['code', 0]],
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    },
    baseBlock: {
      group: 'block',
      content: 'text*',
      attrs: {
        id: { default: null },
        blockType: { default: 'base' },
      },
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
  },
})

function createEditor() {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create(
      { id: 'code-root' },
      schema.nodes.codeBlock.create(
        { id: 'code-content', blockType: 'code' },
        schema.text('const a = 1')
      )
    ),
  ])
  let state = EditorState.create({
    schema,
    doc,
    plugins: [createRenderVirtualizationPlugin()],
  })
  state = prepareInitialRenderVirtualizationState(state, {
    enabled: true,
    initialHydratedBlockCount: 0,
  })
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)))

  const editor = {
    get state() {
      return state
    },
    get schema() {
      return schema
    },
    storage: {
      [SCHEMA_ROOT_BLOCK_TYPE_NAME_KEY]: 'rootBlock',
    },
    view: {
      get state() {
        return state
      },
      dispatch: vi.fn(tr => {
        state = state.apply(tr)
      }),
    },
  }

  return editor
}

describe('CodeBlockKeys', () => {
  it('moves selection to the inserted base block after Shift+Enter exits a code block', () => {
    const editor = createEditor()
    const event = {
      key: 'Enter',
      shiftKey: true,
      preventDefault: vi.fn(),
    }

    const handled = handleCodeBlockShiftEnter({
      event,
      editor,
      debugLog: vi.fn(),
    })

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(editor.view.dispatch).toHaveBeenCalledTimes(1)
    expect(editor.state.doc.childCount).toBe(2)

    const insertedRoot = editor.state.doc.child(1)
    const insertedRootId = insertedRoot.attrs.id

    expect(insertedRoot.type.name).toBe('rootBlock')
    expect(typeof insertedRootId).toBe('string')
    // 中文说明：命令只负责把选区放进新块；选区保活由虚拟化 Controller 统一管理。
    expect(findSelectionRootBlockId(editor.state)).toBe(insertedRootId)
  })
})
