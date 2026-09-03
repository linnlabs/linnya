// @vitest-environment jsdom

import { NodeSelection, type Transaction } from 'prosemirror-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import { dispatchRenderVirtualizationKeepAlive } from '../state/keepAliveEvents'
import {
  createRenderVirtualizationEngine,
  type RenderVirtualizationEngineEditor,
} from '../controller/renderVirtualizationEngine'
import {
  createState,
  disableVirtualRootBlockRendering,
  enableVirtualRootBlockRendering,
  setRect,
} from '../controller/renderVirtualizationEngine.testUtils'
import { setVirtualRootBlockRenderingActiveForOwner } from '../../../ui/services/editorFeatureFlags'

function findRootBlockPos(state: ReturnType<typeof createState>, blockId: string): number {
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

describe('RenderVirtualization selection keep-alive design gate', () => {
  afterEach(() => {
    disableVirtualRootBlockRendering()
  })

  it('syncs a selection transaction through the engine as a selection lease', () => {
    enableVirtualRootBlockRendering()
    let state = createState(['block-a', 'block-b', 'block-c'])
    const editorRoot = document.createElement('div')
    const scrollRoot = document.createElement('div')
    Object.defineProperty(scrollRoot, 'scrollTop', {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    setRect(scrollRoot, { top: 0, bottom: 240, height: 240 })
    setRect(editorRoot, { top: 0, bottom: 360, height: 360 })
    const selectionUpdateListeners = new Set<() => void>()

    const editor: RenderVirtualizationEngineEditor = {
      isDestroyed: false,
      state,
      view: {
        dom: editorRoot,
        get state() {
          return state
        },
        dispatch(tr: Transaction) {
          state = state.apply(tr)
          editor.state = state
        },
        updateState(nextState) {
          state = nextState
          editor.state = nextState
        },
      },
      on(eventName, listener) {
        if (eventName === 'selectionUpdate') selectionUpdateListeners.add(listener)
      },
      off(eventName, listener) {
        if (eventName === 'selectionUpdate') selectionUpdateListeners.delete(listener)
      },
    }
    setVirtualRootBlockRenderingActiveForOwner(editor, true)
    const frames: Array<() => void> = []
    const engine = createRenderVirtualizationEngine({
      getEditor: () => editor,
      getScrollRoot: () => scrollRoot,
      overscanPx: 0,
      maxWindowBlockCount: 1,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })
    frames.shift()?.()

    try {
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          NodeSelection.create(editor.view.state.doc, findRootBlockPos(editor.view.state, 'block-b'))
        )
      )
      selectionUpdateListeners.forEach((listener) => listener())

      const virtualizationState = getRenderVirtualizationState(editor.view.state)

      // selection transaction 经过 Engine 后，选区块应该通过 selection 租约进入 pinnedSet；
      // plugin state 不再提供第二份 selection 事实源。
      expect(virtualizationState?.pinnedSet.has('block-b')).toBe(true)
    } finally {
      engine.cleanup()
    }
  })

  it('moves the selection lease without releasing another keep-alive reason on the previous block', () => {
    enableVirtualRootBlockRendering()
    let state = createState(['block-a', 'block-b', 'block-c'])
    const editorRoot = document.createElement('div')
    const blockOuter = document.createElement('div')
    blockOuter.className = 'root-block-outer'
    blockOuter.dataset.id = 'block-a'
    editorRoot.appendChild(blockOuter)
    const scrollRoot = document.createElement('div')
    Object.defineProperty(scrollRoot, 'scrollTop', {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    setRect(scrollRoot, { top: 0, bottom: 240, height: 240 })
    setRect(editorRoot, { top: 0, bottom: 360, height: 360 })

    const editor: RenderVirtualizationEngineEditor = {
      isDestroyed: false,
      state,
      view: {
        dom: editorRoot,
        get state() {
          return state
        },
        dispatch(tr: Transaction) {
          state = state.apply(tr)
          editor.state = state
        },
        updateState(nextState) {
          state = nextState
          editor.state = nextState
        },
      },
    }
    setVirtualRootBlockRenderingActiveForOwner(editor, true)
    const frames: Array<() => void> = []
    const engine = createRenderVirtualizationEngine({
      getEditor: () => editor,
      getScrollRoot: () => scrollRoot,
      overscanPx: 0,
      maxWindowBlockCount: 1,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })
    frames.shift()?.()

    try {
      dispatchRenderVirtualizationKeepAlive(blockOuter, {
        blockId: 'block-a',
        reason: 'revision-toolbar',
        active: true,
      })
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          NodeSelection.create(editor.view.state.doc, findRootBlockPos(editor.view.state, 'block-b'))
        )
      )
      engine.refreshNow({ type: 'after-dispatch' })

      const virtualizationState = getRenderVirtualizationState(editor.view.state)

      // 中文说明：移动选区只能释放旧块的 selection reason，不能误释放旧块上由
      // revision-toolbar / history-panel / annotation 等入口持有的其他租约。
      expect(virtualizationState?.pinnedSet.has('block-a')).toBe(true)
      expect(virtualizationState?.pinnedSet.has('block-b')).toBe(true)
    } finally {
      engine.cleanup()
    }
  })
})
