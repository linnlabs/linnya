// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Schema } from '@tiptap/pm/model'
import { EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import type { DirectEditorProps } from '@tiptap/pm/view'
import { Editor as VueTiptapEditor } from '@tiptap/vue-3'

import {
  getCurrentOpenPerfSnapshot,
  resetOpenPerf,
} from '../ui/services/editorOpenPerf'
import {
  type EditorForDocumentStateLoad,
  loadDocumentJsonAtomically,
  loadDocumentJsonViaDirectState,
} from './editorDocumentStateLoader'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
})

function asDocumentStateLoadEditor(editor: VueTiptapEditor): EditorForDocumentStateLoad {
  // 中文说明：真实 EditorView 带有 TypeScript private 字段，结构类型无法直接赋给测试用最小接口。
  // 这里走 unknown 桥接，仍然保留运行时真实 editor 对象，才能覆盖 @tiptap/vue-3 reactiveState 同步。
  return editor as unknown as EditorForDocumentStateLoad
}

describe('loadDocumentJsonViaDirectState', () => {
  it('rejects an unknown mark before changing the current EditorState', () => {
    const initialDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('old')),
    ])
    const initialState = EditorState.create({ doc: initialDoc, plugins: [] })
    let latestState = initialState
    let updateCount = 0

    const editor: EditorForDocumentStateLoad = {
      schema,
      state: initialState,
      view: {
        state: initialState,
        updateState(nextState: EditorState): void {
          updateCount += 1
          latestState = nextState
        },
      },
    }

    expect(() =>
      loadDocumentJsonAtomically(editor, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'invalid',
                marks: [{ type: 'unknownMark' }],
              },
            ],
          },
        ],
      })
    ).toThrow('unknownMark')

    expect(updateCount).toBe(0)
    expect(latestState).toBe(initialState)
    expect(latestState.doc.textContent).toBe('old')
  })

  it('rolls view state back when the atomic view update throws', () => {
    const initialDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('old')),
    ])
    const initialState = EditorState.create({ doc: initialDoc, plugins: [] })
    let latestState = initialState

    const editor: EditorForDocumentStateLoad = {
      schema,
      state: initialState,
      view: {
        state: initialState,
        props: { state: initialState },
        update(props: DirectEditorProps): void {
          latestState = props.state
          if (props.state.doc.textContent === 'new') {
            throw new Error('NodeView update failed')
          }
        },
        updateState(nextState: EditorState): void {
          latestState = nextState
        },
      },
    }

    expect(() =>
      loadDocumentJsonAtomically(editor, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'new' }],
          },
        ],
      })
    ).toThrow('NodeView update failed')

    expect(latestState).toBe(initialState)
    expect(latestState.doc.textContent).toBe('old')
  })

  it('rebuilds EditorState from JSON without creating a replace transaction', () => {
    resetOpenPerf()

    const initialDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('old')),
    ])
    const initialState = EditorState.create({ doc: initialDoc, plugins: [] })
    let latestState = initialState

    const editor: EditorForDocumentStateLoad = {
      schema,
      state: initialState,
      view: {
        updateState(nextState: EditorState): void {
          latestState = nextState
        },
      },
    }

    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'new document' }],
        },
      ],
    }

    const result = loadDocumentJsonViaDirectState(editor, content)
    const snapshot = getCurrentOpenPerfSnapshot()

    expect(result.state.doc.textContent).toBe('new document')
    expect(latestState.doc.textContent).toBe('new document')
    expect(snapshot.setContentStats.method).toBe('direct-state')
    expect(snapshot.setContentStats.viewUpdateCount).toBe(1)
    expect(snapshot.timings.setContentNodeFromJsonMs).not.toBeNull()
    expect(snapshot.timings.setContentStateCreateMs).not.toBeNull()
  })

  it('uses the atomic view update path when view props are available', () => {
    const initialDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('old')),
    ])
    const initialState = EditorState.create({ doc: initialDoc, plugins: [] })
    let latestState = initialState
    let updateStateCalled = false

    const editor: EditorForDocumentStateLoad = {
      schema,
      state: initialState,
      view: {
        update(props: DirectEditorProps): void {
          latestState = props.state
        },
        updateState(): void {
          updateStateCalled = true
        },
        props: {
          state: initialState,
          editable: () => true,
        },
      },
    }

    loadDocumentJsonViaDirectState(editor, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'new via update' }],
        },
      ],
    })

    expect(latestState.doc.textContent).toBe('new via update')
    expect(updateStateCalled).toBe(false)
  })

  it('syncs Tiptap Vue reactive state before creating NodeViews during direct-state load', () => {
    const initialDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('old')),
    ])
    const initialState = EditorState.create({ doc: initialDoc, plugins: [] })
    const reactiveState = { value: initialState }
    let latestState = initialState
    let stateSeenDuringViewUpdate = initialState

    const editor = {
      schema,
      state: initialState,
      reactiveState,
      view: {
        state: initialState,
        update(props: DirectEditorProps): void {
          // 中文说明：真实 Vue NodeView 会在 view.update 期间创建，并通过 editor.state
          // 读取 Tiptap 的 reactiveState。这里直接采样 reactiveState，保护 direct-state
          // 路径与 Tiptap beforeTransaction 的同步顺序一致。
          stateSeenDuringViewUpdate = reactiveState.value
          latestState = props.state
        },
        updateState(nextState: EditorState): void {
          stateSeenDuringViewUpdate = reactiveState.value
          latestState = nextState
        },
        props: {
          state: initialState,
        },
      },
    }

    loadDocumentJsonViaDirectState(editor, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'new reactive state' }],
        },
      ],
    })

    expect(latestState.doc.textContent).toBe('new reactive state')
    expect(stateSeenDuringViewUpdate.doc.textContent).toBe('new reactive state')
    expect(reactiveState.value.doc.textContent).toBe('new reactive state')
  })

  it('keeps the previous plugins array reference for direct-state document switches', () => {
    const initialDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('old')),
    ])
    const plugin = new Plugin({})
    const initialState = EditorState.create({ doc: initialDoc, plugins: [plugin] })
    let latestState = initialState

    const editor: EditorForDocumentStateLoad = {
      schema,
      state: initialState,
      view: {
        state: initialState,
        update(props: DirectEditorProps): void {
          latestState = props.state
        },
        updateState(nextState: EditorState): void {
          latestState = nextState
        },
        props: {
          state: initialState,
        },
      },
    }

    loadDocumentJsonViaDirectState(editor, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'new stable plugins' }],
        },
      ],
    })

    expect(latestState.doc.textContent).toBe('new stable plugins')
    expect(latestState.plugins).toBe(initialState.plugins)
  })

  it('applies state preparation before the atomic view update', () => {
    const preparePluginKey = new PluginKey<boolean>('directStatePrepareTest')
    const preparePlugin = new Plugin<boolean>({
      key: preparePluginKey,
      state: {
        init: () => false,
        apply(tr, value) {
          return tr.getMeta(preparePluginKey) === true ? true : value
        },
      },
    })
    const initialDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('old')),
    ])
    const initialState = EditorState.create({ doc: initialDoc, plugins: [preparePlugin] })
    let latestState = initialState

    const editor: EditorForDocumentStateLoad = {
      schema,
      state: initialState,
      view: {
        state: initialState,
        update(props: DirectEditorProps): void {
          latestState = props.state
        },
        updateState(nextState: EditorState): void {
          latestState = nextState
        },
        props: {
          state: initialState,
        },
      },
    }

    loadDocumentJsonViaDirectState(
      editor,
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'prepared document' }],
          },
        ],
      },
      {
        prepareState(state) {
          return state.apply(state.tr.setMeta(preparePluginKey, true))
        },
      }
    )

    expect(latestState.doc.textContent).toBe('prepared document')
    expect(preparePluginKey.getState(latestState)).toBe(true)
  })

  it('在唯一一次 view update 前完成领域文档装载投影', () => {
    const projectionMeta = 'testDocumentLoadProjectionApplied'
    let projectionCallCount = 0
    let sawProjectionTransaction = false
    const projectionPlugin = new Plugin({
      appendTransaction(transactions, _oldState, newState) {
        projectionCallCount += 1
        const shouldProject = transactions.some(
          transaction => transaction.getMeta('documentLoadProjection') === true
        )
        sawProjectionTransaction ||= shouldProject
        if (!shouldProject || transactions.some(transaction => transaction.getMeta(projectionMeta))) {
          return null
        }
        return newState.tr
          .insert(
            newState.doc.content.size,
            newState.schema.node('paragraph', null, newState.schema.text('projected'))
          )
          .setMeta(projectionMeta, true)
      },
    })
    const initialDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('old')),
    ])
    const initialState = EditorState.create({ doc: initialDoc, plugins: [projectionPlugin] })
    let latestState = initialState
    let updateCount = 0
    const editor: EditorForDocumentStateLoad = {
      schema,
      state: initialState,
      view: {
        state: initialState,
        updateState(nextState): void {
          updateCount += 1
          latestState = nextState
        },
      },
    }

    const result = loadDocumentJsonViaDirectState(editor, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new' }] }],
    })

    expect(projectionCallCount).toBeGreaterThan(0)
    expect(sawProjectionTransaction).toBe(true)
    expect(result.doc.textContent).toBe('newprojected')
    expect(latestState).toBe(result.state)
    expect(updateCount).toBe(1)
  })

  it('can run the direct-state view update while the editor DOM is detached', () => {
    resetOpenPerf()

    const container = document.createElement('div')
    const editorDom = document.createElement('div')
    container.appendChild(editorDom)
    document.body.appendChild(container)

    const initialDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('old')),
    ])
    const initialState = EditorState.create({ doc: initialDoc, plugins: [] })
    let latestState = initialState
    let wasDetachedDuringUpdate = false

    const editor: EditorForDocumentStateLoad = {
      schema,
      state: initialState,
      view: {
        state: initialState,
        dom: editorDom,
        update(props: DirectEditorProps): void {
          wasDetachedDuringUpdate = editorDom.parentNode === null
          latestState = props.state
        },
        updateState(nextState: EditorState): void {
          latestState = nextState
        },
        props: {
          state: initialState,
        },
      },
    }

    try {
      loadDocumentJsonViaDirectState(editor, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'new detached update' }],
          },
        ],
      })

      const snapshot = getCurrentOpenPerfSnapshot()

      expect(latestState.doc.textContent).toBe('new detached update')
      expect(wasDetachedDuringUpdate).toBe(true)
      expect(editorDom.parentNode).toBe(container)
      expect(snapshot.setContentStats.directStateDomDetached).toBe(true)
      expect(snapshot.setContentStats.directStateDomDetachMs).not.toBeNull()
      expect(snapshot.setContentStats.directStateDomReattachMs).not.toBeNull()
    } finally {
      container.remove()
    }
  })

  it('clears stale DOMObserver work around direct state replacement', () => {
    const initialDoc = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('old')),
    ])
    const initialState = EditorState.create({ doc: initialDoc, plugins: [] })
    let latestState = initialState
    let clearedSelection = false
    let setCurSelectionCount = 0
    let suppressSelectionUpdatesCount = 0

    const queuedRecord = { type: 'childList' } as MutationRecord
    const pendingRecord = { type: 'attributes' } as MutationRecord

    const editor: EditorForDocumentStateLoad = {
      schema,
      state: initialState,
      view: {
        update(props: DirectEditorProps): void {
          latestState = props.state
          props.state.doc.textContent
        },
        updateState(nextState: EditorState): void {
          latestState = nextState
        },
        props: {
          state: initialState,
        },
        domObserver: {
          queue: [queuedRecord],
          flushingSoon: 1,
          observer: {
            takeRecords: () => [pendingRecord],
          },
          currentSelection: {
            clear: () => {
              clearedSelection = true
            },
          },
          setCurSelection: () => {
            setCurSelectionCount += 1
          },
          suppressSelectionUpdates: () => {
            suppressSelectionUpdatesCount += 1
          },
        },
      },
    }

    loadDocumentJsonViaDirectState(editor, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'new document' }],
        },
      ],
    })

    expect(latestState.doc.textContent).toBe('new document')
    expect(editor.view.domObserver?.queue).toEqual([])
    expect(editor.view.domObserver?.flushingSoon).toBe(-1)
    expect(clearedSelection).toBe(true)
    expect(setCurSelectionCount).toBe(1)
    expect(suppressSelectionUpdatesCount).toBe(1)
  })

  it('keeps @tiptap/vue-3 reactive state aligned with the ProseMirror view state', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)

    const editor = new VueTiptapEditor({
      element,
      extensions: [Document, Paragraph, Text],
      content: '<p>old</p>',
    })

    try {
      const result = loadDocumentJsonViaDirectState(asDocumentStateLoadEditor(editor), {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'new vue document' }],
          },
        ],
      })

      expect(result.state.doc.textContent).toBe('new vue document')
      expect(editor.view.state.doc.textContent).toBe('new vue document')
      expect(editor.state.doc.textContent).toBe('new vue document')

      // 回归保护：如果 reactiveState 没同步，这个由 view.state 创建的 transaction
      // 进入 Tiptap dispatchTransaction 后会拿旧 editor.state apply，直接抛 mismatched。
      expect(() => {
        editor.view.dispatch(editor.view.state.tr.setMeta('directStateProbe', true))
      }).not.toThrow()
      expect(editor.state.doc.textContent).toBe('new vue document')
      expect(editor.view.state.doc.textContent).toBe('new vue document')
    } finally {
      editor.destroy()
      element.remove()
    }
  })
})
