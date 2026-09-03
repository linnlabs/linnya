import { Schema } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { describe, expect, it, vi } from 'vitest'
import {
  createSlashMenuKeepAliveController,
  findRootBlockIdAtPosition,
  type SlashMenuKeepAliveEditor,
} from './slashMenuVirtualizationKeepAlive'

const keepAliveEvents = vi.hoisted(() => vi.fn())

vi.mock('../../RenderVirtualization', () => ({
  applyRenderVirtualizationKeepAliveCommand: vi.fn((input: {
    legacyTarget: EventTarget | null
    command: { blockId: string; reason: string }
    active: boolean
  }) => {
    keepAliveEvents(input.legacyTarget, {
      ...input.command,
      active: input.active,
    })
    return true
  }),
}))

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
        schema.nodes.paragraph.create(null, schema.text('alpha'))
      ),
      schema.nodes.rootBlock.create(
        { id: 'block-b' },
        schema.nodes.paragraph.create(null, schema.text('beta'))
      ),
    ]),
  })
}

function createEditor(target: EventTarget, state = createState()): SlashMenuKeepAliveEditor {
  return {
    state,
    view: {
      dom: target,
    },
  }
}

describe('slashMenuVirtualizationKeepAlive', () => {
  it('finds the rootBlock id that contains the slash trigger position', () => {
    const state = createState()

    expect(findRootBlockIdAtPosition(state, 3)).toBe('block-a')
    expect(findRootBlockIdAtPosition(state, 12)).toBe('block-b')
  })

  it('pins the trigger block and releases it when the menu exits', () => {
    keepAliveEvents.mockClear()
    const editorDom = new EventTarget()
    const controller = createSlashMenuKeepAliveController(createEditor(editorDom))

    controller.pinForRange({ from: 3 })
    controller.release()

    expect(keepAliveEvents.mock.calls).toEqual([
      [editorDom, { blockId: 'block-a', reason: 'interaction-open', active: true }],
      [editorDom, { blockId: 'block-a', reason: 'interaction-open', active: false }],
    ])
  })

  it('moves the keep-alive lease when the menu retargets another block', () => {
    keepAliveEvents.mockClear()
    const editorDom = new EventTarget()
    const controller = createSlashMenuKeepAliveController(createEditor(editorDom))

    controller.pinForRange({ from: 3 })
    controller.pinForRange({ from: 12 })

    expect(keepAliveEvents.mock.calls).toEqual([
      [editorDom, { blockId: 'block-a', reason: 'interaction-open', active: true }],
      [editorDom, { blockId: 'block-a', reason: 'interaction-open', active: false }],
      [editorDom, { blockId: 'block-b', reason: 'interaction-open', active: true }],
    ])
  })
})
