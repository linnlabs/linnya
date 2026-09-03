import { Schema } from 'prosemirror-model'
import { EditorState, type Plugin } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markRenderVirtualizationTransaction } from '../../core/transactions/editorTransactionMeta'
import { emitBlockOperation } from '../../shared/utils/blockEventUtils'
import { BlockLifecycleExtension } from './BlockLifecycleExtension'

vi.mock('../../shared/utils/blockEventUtils', () => ({
  BlockAction: {
    DELETE: 'delete',
    MOVE: 'move',
    COPY: 'copy',
    SPLIT: 'split',
    MERGE: 'merge',
  },
  emitBlockOperation: vi.fn(),
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

interface EditorStub {
  eventBus: {
    emit: ReturnType<typeof vi.fn>
  }
}

interface PluginViewStub {
  update(view: { state: EditorState }): void
}

function createDoc(blockIds: string[]) {
  return schema.nodes.doc.create(
    null,
    blockIds.map((id) =>
      schema.nodes.rootBlock.create(
        { id },
        schema.nodes.paragraph.create(null, schema.text(id))
      )
    )
  )
}

function createLifecyclePlugin(editor: EditorStub): Plugin {
  return BlockLifecycleExtension.config.addProseMirrorPlugins.call({ editor })[0]
}

function createState(blockIds: string[], plugin: Plugin): EditorState {
  return EditorState.create({
    schema,
    doc: createDoc(blockIds),
    plugins: [plugin],
  })
}

function deleteRootBlockById(state: EditorState, blockId: string) {
  let from: number | null = null
  let to: number | null = null

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'rootBlock' || node.attrs.id !== blockId) return true
    from = pos
    to = pos + node.nodeSize
    return false
  })

  if (from === null || to === null) {
    throw new Error(`测试文档中没有找到 rootBlock: ${blockId}`)
  }

  return state.tr.delete(from, to)
}

function createHarness(blockIds: string[]) {
  const editor: EditorStub = { eventBus: { emit: vi.fn() } }
  const plugin = createLifecyclePlugin(editor)
  let state = createState(blockIds, plugin)
  const pluginView = plugin.spec.view?.({ state }) as PluginViewStub

  function dispatch(tr: ReturnType<EditorState['tr']['delete']>): void {
    state = state.apply(tr)
    pluginView.update({ state })
  }

  return {
    dispatch,
    editor,
    getState: () => state,
  }
}

describe('BlockLifecycleExtension', () => {
  beforeEach(() => {
    vi.mocked(emitBlockOperation).mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits a delete block-operation for real user document deletes', () => {
    const harness = createHarness(['root-a', 'root-b', 'root-c'])

    harness.dispatch(deleteRootBlockById(harness.getState(), 'root-b'))

    expect(emitBlockOperation).toHaveBeenCalledTimes(1)
    expect(emitBlockOperation).toHaveBeenCalledWith(
      harness.editor,
      'delete',
      ['root-b'],
      { source: 'blockLifecyclePlugin' }
    )
  })

  it('does not emit delete block-operation for ephemeral render transactions', () => {
    const harness = createHarness(['root-a', 'root-b', 'root-c'])
    const tr = markRenderVirtualizationTransaction(
      deleteRootBlockById(harness.getState(), 'root-b')
    )

    harness.dispatch(tr)

    expect(emitBlockOperation).not.toHaveBeenCalled()
  })

  it('does not replay a suppressed ephemeral delete on the next normal transaction', () => {
    const harness = createHarness(['root-a', 'root-b', 'root-c'])
    const tr = markRenderVirtualizationTransaction(
      deleteRootBlockById(harness.getState(), 'root-b')
    )

    harness.dispatch(tr)
    harness.dispatch(harness.getState().tr.setMeta('test:selection-refresh', true))

    expect(emitBlockOperation).not.toHaveBeenCalled()
  })
})
