// @vitest-environment jsdom

import { NodeSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRenderVirtualizationState,
  renderVirtualizationPluginKey,
} from '../state/renderVirtualizationPlugin'
import { dispatchRenderVirtualizationKeepAlive } from '../state/keepAliveEvents'
import {
  createRenderVirtualizationEngine,
  type RenderVirtualizationEngineEditor,
} from './renderVirtualizationEngine'
import { SCROLL_SETTLE_CORRECTION_MS } from '../renderVirtualizationConstants'
import { setVirtualRootBlockRenderingActiveForOwner } from '../../../ui/services/editorFeatureFlags'
import {
  createMutableScrollTopElement,
  createPluginDisabledState,
  createState,
  disableVirtualRootBlockRendering,
  enableVirtualRootBlockRendering,
  setRect,
} from './renderVirtualizationEngine.testUtils'

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

describe('createRenderVirtualizationEngine', () => {
  afterEach(() => {
    disableVirtualRootBlockRendering()
  })

  it('computes the render window from scrollTop and hydrates only that window', () => {
    enableVirtualRootBlockRendering()
    let state = createState(['block-a', 'block-b', 'block-c', 'block-d', 'block-e'])
    const editorRoot = document.createElement('div')
    const scrollRoot = document.createElement('div')
    Object.defineProperty(scrollRoot, 'scrollTop', {
      configurable: true,
      value: 375,
    })
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    setRect(scrollRoot, { top: 0, bottom: 240, height: 240 })
    setRect(editorRoot, { top: -375, bottom: 240, height: 600 })

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
        updateState(nextState: EditorState) {
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
      maxWindowBlockCount: 2,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()
    expect(frames).toHaveLength(0)

    const snapshot = engine.getSnapshot()
    expect(snapshot.visibleBlockIds).toEqual(['block-d', 'block-e'])
    expect(snapshot.hydratedBlockIds).toEqual(['block-d', 'block-e'])
    expect(getRenderVirtualizationState(state)?.hydratedSet.has('block-d')).toBe(true)
    expect(getRenderVirtualizationState(state)?.hydratedSet.has('block-e')).toBe(true)

    engine.cleanup()
  })

  it('uses a cheap preview refresh while the scrollbar is jumping', () => {
    enableVirtualRootBlockRendering()
    const blockIds = Array.from({ length: 20 }, (_, index) => `block-${String.fromCharCode(97 + index)}`)
    let state = createState(blockIds)
    const editorRoot = document.createElement('div')
    const { scrollRoot, setScrollTop } = createMutableScrollTopElement(0)
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    setRect(scrollRoot, { top: 0, bottom: 240, height: 240 })
    Object.defineProperty(editorRoot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: -scrollRoot.scrollTop,
        bottom: 240,
        left: 0,
        right: 800,
        width: 800,
        height: 2400,
      }),
    })

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
        updateState(nextState: EditorState) {
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
      maxWindowBlockCount: 2,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()
    setScrollTop(1500)
    scrollRoot.dispatchEvent(new Event('scroll'))

    expect(frames).toHaveLength(1)
    frames.shift()?.()
    expect(engine.getSnapshot().reason).toBe('scroll')
    expect(engine.getSnapshot().visibleBlockIds).toEqual(['block-m', 'block-n'])
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-m', 'block-n'])

    engine.cleanup()
  })

  it('reuses the previous snapshot window during ordinary native scroll', () => {
    enableVirtualRootBlockRendering()
    const originalElementsFromPoint = document.elementsFromPoint
    const blockIds = Array.from({ length: 100 }, (_, index) => `block-${index}`)
    let state = createState(blockIds)
    const editorRoot = document.createElement('div')
    const anchoredOuter = document.createElement('div')
    anchoredOuter.className = 'root-block-outer'
    anchoredOuter.dataset.id = 'block-50'
    editorRoot.appendChild(anchoredOuter)
    const { scrollRoot, setScrollTop } = createMutableScrollTopElement(0)
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    setRect(scrollRoot, { top: 0, bottom: 240, height: 240 })
    Object.defineProperty(editorRoot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: -scrollRoot.scrollTop,
        bottom: 240,
        left: 0,
        right: 800,
        width: 800,
        height: 12000,
      }),
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [anchoredOuter],
    })

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
        updateState(nextState: EditorState) {
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
      maxWindowBlockCount: 20,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()
    const initialWindow = engine.getSnapshot().visibleBlockIds
    expect(initialWindow).toEqual(blockIds.slice(41, 61))
    expect(window.__RENDER_VIRT_ENGINE_PERF__?.getLast()?.windowSelectionSource).toBe('dom-anchor')

    setScrollTop(40)
    scrollRoot.dispatchEvent(new Event('scroll'))
    frames.shift()?.()

    expect(engine.getSnapshot().reason).toBe('scroll')
    expect(engine.getSnapshot().visibleBlockIds).toEqual(initialWindow)
    expect(window.__RENDER_VIRT_ENGINE_PERF__?.getLast()?.windowSelectionSource).toBe('dom-anchor-reuse')
    expect(window.__RENDER_VIRT_ENGINE_PERF__?.getLast()?.requestedHydrate).toBe(0)
    expect(window.__RENDER_VIRT_ENGINE_PERF__?.getLast()?.requestedDehydrate).toBe(0)

    engine.cleanup()
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    })
  })

  it('falls back to height-cache when an ordinary scroll anchor misses root blocks', () => {
    enableVirtualRootBlockRendering()
    const originalElementsFromPoint = document.elementsFromPoint
    const elementsFromPoint = vi.fn((): Element[] => [])
    const blockIds = Array.from({ length: 12 }, (_, index) => `block-${index}`)
    let state = createState(blockIds)
    const editorRoot = document.createElement('div')
    const { scrollRoot, setScrollTop } = createMutableScrollTopElement(0)
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    setRect(scrollRoot, { top: 0, bottom: 240, height: 240 })
    Object.defineProperty(editorRoot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: -scrollRoot.scrollTop,
        bottom: 240,
        left: 0,
        right: 800,
        width: 800,
        height: 1440,
      }),
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    })

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
        updateState(nextState: EditorState) {
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
      maxWindowBlockCount: 3,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()
    setScrollTop(120)
    scrollRoot.dispatchEvent(new Event('scroll'))
    frames.shift()?.()

    expect(engine.getSnapshot().reason).toBe('scroll')
    expect(engine.getSnapshot().visibleBlockIds.length).toBeGreaterThan(0)
    expect(elementsFromPoint).toHaveBeenCalled()
    expect(window.__RENDER_VIRT_ENGINE_PERF__?.getLast()?.windowSelectionSource).toBe('height-cache')

    engine.cleanup()
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    })
  })

  it('runs a settled correction after scrollbar dragging stops on an ordinary scroll delta', () => {
    vi.useFakeTimers()
    enableVirtualRootBlockRendering()
    const originalElementsFromPoint = document.elementsFromPoint
    const blockIds = Array.from({ length: 20 }, (_, index) => `block-${String.fromCharCode(97 + index)}`)
    let state = createState(blockIds)
    const editorRoot = document.createElement('div')
    const sampledOuter = document.createElement('div')
    sampledOuter.className = 'root-block-outer'
    sampledOuter.dataset.id = 'block-k'
    editorRoot.appendChild(sampledOuter)
    const elementsFromPoint = vi.fn((): Element[] => [sampledOuter])
    const { scrollRoot, setScrollTop } = createMutableScrollTopElement(0)
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    setRect(scrollRoot, { top: 0, bottom: 240, height: 240 })
    Object.defineProperty(editorRoot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: -scrollRoot.scrollTop,
        bottom: 240,
        left: 0,
        right: 800,
        width: 800,
        height: 2400,
      }),
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint,
    })

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
        updateState(nextState: EditorState) {
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
      maxWindowBlockCount: 4,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()
    setScrollTop(600)
    scrollRoot.dispatchEvent(new Event('scroll'))
    frames.shift()?.()

    expect(engine.getSnapshot().reason).toBe('scroll')
    expect(engine.getSnapshot().visibleBlockIds).toEqual(['block-j', 'block-k', 'block-l', 'block-m'])
    expect(elementsFromPoint).toHaveBeenCalled()

    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS)

    expect(engine.getSnapshot().reason).toBe('scroll-correction')
    expect(engine.getSnapshot().visibleBlockIds).toEqual(['block-j', 'block-k', 'block-l', 'block-m'])
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-j', 'block-k', 'block-l', 'block-m'])
    expect(elementsFromPoint).toHaveBeenCalled()

    scrollRoot.dispatchEvent(new Event('scroll'))
    expect(frames).toHaveLength(0)
    expect(engine.getSnapshot().reason).toBe('scroll-correction')
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-j', 'block-k', 'block-l', 'block-m'])

    setScrollTop(640)
    scrollRoot.dispatchEvent(new Event('scroll'))
    expect(frames).toHaveLength(0)
    expect(engine.getSnapshot().reason).toBe('scroll-correction')
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-j', 'block-k', 'block-l', 'block-m'])

    engine.cleanup()
    vi.useRealTimers()
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    })
  })

  it('uses the actual viewport DOM anchor to correct far jump windows', () => {
    vi.useFakeTimers()
    enableVirtualRootBlockRendering()
    const originalElementsFromPoint = document.elementsFromPoint
    const blockIds = Array.from({ length: 20 }, (_, index) => `block-${String.fromCharCode(97 + index)}`)
    let state = createState(blockIds)
    const editorRoot = document.createElement('div')
    const anchoredOuter = document.createElement('div')
    anchoredOuter.className = 'root-block-outer'
    anchoredOuter.dataset.id = 'block-t'
    editorRoot.appendChild(anchoredOuter)
    const { scrollRoot, setScrollTop } = createMutableScrollTopElement(0)
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    setRect(scrollRoot, { top: 0, bottom: 240, height: 240 })
    Object.defineProperty(editorRoot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: -scrollRoot.scrollTop,
        bottom: 240,
        left: 0,
        right: 800,
        width: 800,
        height: 2400,
      }),
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [anchoredOuter],
    })

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
        updateState(nextState: EditorState) {
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
      maxWindowBlockCount: 2,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()
    setScrollTop(1500)
    scrollRoot.dispatchEvent(new Event('scroll'))

    frames.shift()?.()
    expect(engine.getSnapshot().reason).toBe('scroll')
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS)
    vi.runOnlyPendingTimers()
    expect(engine.getSnapshot().reason).toBe('scroll-correction')
    expect(engine.getSnapshot().visibleBlockIds).toEqual(['block-s', 'block-t'])
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-s', 'block-t'])

    engine.scheduleRefresh('editor-scroll')
    frames.shift()?.()
    expect(engine.getSnapshot().reason).toBe('editor-scroll')
    expect(engine.getSnapshot().visibleBlockIds).toEqual(['block-s', 'block-t'])
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-s', 'block-t'])

    engine.cleanup()
    vi.useRealTimers()
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    })
  })

  it('uses sampled current viewport DOM blocks before falling back to a single anchor', () => {
    vi.useFakeTimers()
    enableVirtualRootBlockRendering()
    const originalElementsFromPoint = document.elementsFromPoint
    const blockIds = Array.from({ length: 20 }, (_, index) => `block-${String.fromCharCode(97 + index)}`)
    let state = createState(blockIds)
    const editorRoot = document.createElement('div')
    const sampledOuters = ['block-r', 'block-s'].map((blockId) => {
      const outer = document.createElement('div')
      outer.className = 'root-block-outer'
      outer.dataset.id = blockId
      editorRoot.appendChild(outer)
      return outer
    })
    let sampleIndex = 0
    const { scrollRoot, setScrollTop } = createMutableScrollTopElement(0)
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    setRect(scrollRoot, { top: 0, bottom: 240, height: 240 })
    Object.defineProperty(editorRoot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: -scrollRoot.scrollTop,
        bottom: 240,
        left: 0,
        right: 800,
        width: 800,
        height: 2400,
      }),
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => {
        const element = sampledOuters[sampleIndex % sampledOuters.length]
        sampleIndex += 1
        return [element]
      },
    })

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
        updateState(nextState: EditorState) {
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
      maxWindowBlockCount: 4,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()
    setScrollTop(1500)
    scrollRoot.dispatchEvent(new Event('scroll'))
    frames.shift()?.()

    expect(engine.getSnapshot().reason).toBe('scroll')
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS)
    vi.runOnlyPendingTimers()
    expect(engine.getSnapshot().reason).toBe('scroll-correction')
    expect(engine.getSnapshot().visibleBlockIds).toEqual(['block-q', 'block-r', 'block-s', 'block-t'])
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-q', 'block-r', 'block-s', 'block-t'])

    engine.cleanup()
    vi.useRealTimers()
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    })
  })

  it('uses DOM correction when many small scroll events accumulate across a long distance', () => {
    vi.useFakeTimers()
    enableVirtualRootBlockRendering()
    const originalElementsFromPoint = document.elementsFromPoint
    const blockIds = Array.from({ length: 30 }, (_, index) => `block-${index}`)
    let state = createState(blockIds)
    const editorRoot = document.createElement('div')
    const sampledOuter = document.createElement('div')
    sampledOuter.className = 'root-block-outer'
    sampledOuter.dataset.id = 'block-18'
    editorRoot.appendChild(sampledOuter)
    const { scrollRoot, setScrollTop } = createMutableScrollTopElement(0)
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 2000,
    })
    setRect(scrollRoot, { top: 0, bottom: 2000, height: 2000 })
    Object.defineProperty(editorRoot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: -scrollRoot.scrollTop,
        bottom: 2000,
        left: 0,
        right: 800,
        width: 800,
        height: 10000,
      }),
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [sampledOuter],
    })

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
        updateState(nextState: EditorState) {
          state = nextState
          editor.state = nextState
        },
      },
    }
    setVirtualRootBlockRenderingActiveForOwner(editor, true)
    const frames: Array<() => void> = []
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const engine = createRenderVirtualizationEngine({
      getEditor: () => editor,
      getScrollRoot: () => scrollRoot,
      overscanPx: 0,
      maxWindowBlockCount: 4,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()
    setScrollTop(2500)
    clock = 60
    scrollRoot.dispatchEvent(new Event('scroll'))
    frames.shift()?.()
    expect(engine.getSnapshot().reason).toBe('scroll')

    setScrollTop(5000)
    clock = 120
    scrollRoot.dispatchEvent(new Event('scroll'))
    frames.shift()?.()
    expect(engine.getSnapshot().reason).toBe('scroll')

    setScrollTop(6500)
    clock = 240
    scrollRoot.dispatchEvent(new Event('scroll'))
    frames.shift()?.()

    expect(engine.getSnapshot().reason).toBe('scroll')
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS)
    vi.runOnlyPendingTimers()
    expect(engine.getSnapshot().reason).toBe('scroll-correction')
    expect(engine.getSnapshot().visibleBlockIds).toEqual(['block-17', 'block-18', 'block-19', 'block-20'])
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-17', 'block-18', 'block-19', 'block-20'])

    engine.cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    })
  })

  it('keeps the scroll position stable while settling a far jump preview', () => {
    vi.useFakeTimers()
    enableVirtualRootBlockRendering()
    const originalElementsFromPoint = document.elementsFromPoint
    const blockIds = Array.from({ length: 30 }, (_, index) => `block-${index}`)
    let state = createState(blockIds)
    const editorRoot = document.createElement('div')
    const sampledOuter = document.createElement('div')
    sampledOuter.className = 'root-block-outer'
    sampledOuter.dataset.id = 'block-18'
    editorRoot.appendChild(sampledOuter)
    let sampledOuterTop = 100
    Object.defineProperty(sampledOuter, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: sampledOuterTop,
        bottom: sampledOuterTop + 120,
        left: 0,
        right: 800,
        width: 800,
        height: 120,
      }),
    })
    const { scrollRoot, setScrollTop } = createMutableScrollTopElement(0)
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    setRect(scrollRoot, { top: 0, bottom: 240, height: 240 })
    Object.defineProperty(editorRoot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: -scrollRoot.scrollTop,
        bottom: 240,
        left: 0,
        right: 800,
        width: 800,
        height: 10000,
      }),
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [sampledOuter],
    })

    let shiftAnchorAfterDispatch = false
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
          if (shiftAnchorAfterDispatch) sampledOuterTop = 180
        },
        updateState(nextState: EditorState) {
          state = nextState
          editor.state = nextState
          if (shiftAnchorAfterDispatch) sampledOuterTop = 180
        },
      },
    }
    setVirtualRootBlockRenderingActiveForOwner(editor, true)
    const frames: Array<() => void> = []
    const engine = createRenderVirtualizationEngine({
      getEditor: () => editor,
      getScrollRoot: () => scrollRoot,
      overscanPx: 0,
      maxWindowBlockCount: 4,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()
    shiftAnchorAfterDispatch = true
    setScrollTop(6500)
    scrollRoot.dispatchEvent(new Event('scroll'))
    frames.shift()?.()

    expect(engine.getSnapshot().reason).toBe('scroll')
    vi.advanceTimersByTime(SCROLL_SETTLE_CORRECTION_MS)
    vi.runOnlyPendingTimers()
    expect(engine.getSnapshot().reason).toBe('scroll-correction')
    expect(engine.getSnapshot().visibleBlockIds).toEqual(['block-17', 'block-18', 'block-19', 'block-20'])
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-17', 'block-18', 'block-19', 'block-20'])
    expect(scrollRoot.scrollTop).toBe(6500)
    expect(engine.getSnapshot().scrollTop).toBe(6500)
    expect(window.__RENDER_VIRT_ENGINE_PERF__?.getLast()?.scrollAnchorRestored).toBe(false)

    engine.cleanup()
    vi.useRealTimers()
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    })
  })

  it('enables the plugin state before publishing a virtualized window', () => {
    enableVirtualRootBlockRendering()
    let state = createPluginDisabledState(['block-a', 'block-b', 'block-c'])
    const editorRoot = document.createElement('div')
    const scrollRoot = document.createElement('div')
    Object.defineProperty(scrollRoot, 'scrollTop', {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 160,
    })
    setRect(scrollRoot, { top: 0, bottom: 160, height: 160 })
    setRect(editorRoot, { top: 0, bottom: 160, height: 160 })

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
        updateState(nextState: EditorState) {
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
      maxWindowBlockCount: 2,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()

    expect(engine.getSnapshot().visibleBlockIds).toEqual(['block-a', 'block-b'])
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-a', 'block-b'])
    expect(getRenderVirtualizationState(state)?.enabled).toBe(true)
    expect(getRenderVirtualizationState(state)?.hydratedSet.has('block-a')).toBe(true)
    expect(getRenderVirtualizationState(state)?.hydratedSet.has('block-b')).toBe(true)

    engine.cleanup()
  })

  it('uses plugin state rather than the local window cache when repairing drift', () => {
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
      value: 160,
    })
    setRect(scrollRoot, { top: 0, bottom: 160, height: 160 })
    setRect(editorRoot, { top: 0, bottom: 160, height: 160 })

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
        updateState(nextState: EditorState) {
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
      maxWindowBlockCount: 2,
      scheduleFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: vi.fn(),
    })

    frames.shift()?.()
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-a', 'block-b'])

    // 中文说明：模拟其它事务让 plugin 真实 state 与 engine 的 renderedWindowBlockIds
    // 缓存分叉。engine 必须以 plugin state 为准修复当前可见窗口。
    state = state.apply(
      state.tr.setMeta(renderVirtualizationPluginKey, {
        dehydrate: ['block-b'],
      })
    )
    editor.state = state

    engine.scheduleRefresh('editor-scroll')
    frames.shift()?.()

    expect(engine.getSnapshot().visibleBlockIds).toEqual(['block-a', 'block-b'])
    expect(engine.getSnapshot().hydratedBlockIds).toEqual(['block-a', 'block-b'])
    expect(getRenderVirtualizationState(state)?.hydratedSet.has('block-b')).toBe(true)

    engine.cleanup()
  })

  it('commits keep-alive pin and unpin synchronously without a second controller queue', () => {
    enableVirtualRootBlockRendering()
    let state = createState(['block-a', 'block-b'])
    const editorRoot = document.createElement('div')
    const blockOuter = document.createElement('div')
    const scrollRoot = document.createElement('div')
    blockOuter.className = 'root-block-outer'
    blockOuter.dataset.id = 'block-a'
    editorRoot.appendChild(blockOuter)
    Object.defineProperty(scrollRoot, 'scrollTop', {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 160,
    })
    setRect(scrollRoot, { top: 0, bottom: 160, height: 160 })
    setRect(editorRoot, { top: 0, bottom: 160, height: 160 })

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
        updateState(nextState: EditorState) {
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
    dispatchRenderVirtualizationKeepAlive(blockOuter, {
      blockId: 'block-a',
      reason: 'interaction-open',
      active: true,
    })

    expect(getRenderVirtualizationState(state)?.pinnedSet.has('block-a')).toBe(true)
    engine.refreshNow({ type: 'after-dispatch' })
    expect(engine.getSnapshot().pinnedBlockIds).toContain('block-a')

    dispatchRenderVirtualizationKeepAlive(blockOuter, {
      blockId: 'block-a',
      reason: 'interaction-open',
      active: false,
    })

    // 中文说明：block-a 仍是当前选区块，interaction-open 释放后仍应由 selection 租约保活。
    expect(getRenderVirtualizationState(state)?.pinnedSet.has('block-a')).toBe(true)

    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        NodeSelection.create(editor.view.state.doc, findRootBlockPos(editor.view.state, 'block-b'))
      )
    )
    engine.refreshNow({ type: 'after-dispatch' })

    expect(getRenderVirtualizationState(state)?.pinnedSet.has('block-a')).toBe(false)
    expect(getRenderVirtualizationState(state)?.pinnedSet.has('block-b')).toBe(true)
    expect(engine.getSnapshot().pinnedBlockIds).toEqual(['block-b'])

    engine.cleanup()
  })

  it('does not dispatch keep-alive cleanup transactions while the engine is tearing down', () => {
    enableVirtualRootBlockRendering()
    let state = createState(['block-a'])
    const editorRoot = document.createElement('div')
    const blockOuter = document.createElement('div')
    const scrollRoot = document.createElement('div')
    blockOuter.className = 'root-block-outer'
    blockOuter.dataset.id = 'block-a'
    editorRoot.appendChild(blockOuter)
    Object.defineProperty(scrollRoot, 'scrollTop', {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 160,
    })
    setRect(scrollRoot, { top: 0, bottom: 160, height: 160 })
    setRect(editorRoot, { top: 0, bottom: 160, height: 160 })

    let dispatchCount = 0
    const editor: RenderVirtualizationEngineEditor = {
      isDestroyed: false,
      state,
      view: {
        dom: editorRoot,
        get state() {
          return state
        },
        dispatch(tr: Transaction) {
          dispatchCount += 1
          state = state.apply(tr)
          editor.state = state
        },
        updateState(nextState: EditorState) {
          dispatchCount += 1
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
    dispatchRenderVirtualizationKeepAlive(blockOuter, {
      blockId: 'block-a',
      reason: 'interaction-open',
      active: true,
    })
    const dispatchCountBeforeCleanup = dispatchCount

    engine.cleanup()

    expect(dispatchCount).toBe(dispatchCountBeforeCleanup)
  })

  it('resets plugin state when runtime virtualization is disabled after being enabled', () => {
    enableVirtualRootBlockRendering()
    let state = createState(['block-a', 'block-b'])
    const editorRoot = document.createElement('div')
    const scrollRoot = document.createElement('div')
    Object.defineProperty(scrollRoot, 'scrollTop', {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(scrollRoot, 'clientHeight', {
      configurable: true,
      value: 160,
    })
    setRect(scrollRoot, { top: 0, bottom: 160, height: 160 })
    setRect(editorRoot, { top: 0, bottom: 160, height: 160 })

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
        updateState(nextState: EditorState) {
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
    expect(getRenderVirtualizationState(state)?.enabled).toBe(true)

    disableVirtualRootBlockRendering()
    engine.refreshNow('editor-scroll')

    expect(engine.getSnapshot().virtualizationEnabled).toBe(false)
    expect(getRenderVirtualizationState(state)?.enabled).toBe(false)

    engine.cleanup()
  })

  it('uses editor-scoped runtime when deciding whether virtualization is enabled', () => {
    enableVirtualRootBlockRendering()
    let stateA = createState(['block-a'])
    let stateB = createState(['block-b'])
    const editorRootA = document.createElement('div')
    const editorRootB = document.createElement('div')
    const scrollRoot = document.createElement('div')

    const editorA: RenderVirtualizationEngineEditor = {
      isDestroyed: false,
      state: stateA,
      view: {
        dom: editorRootA,
        get state() {
          return stateA
        },
        dispatch(tr: Transaction) {
          stateA = stateA.apply(tr)
          editorA.state = stateA
        },
        updateState(nextState: EditorState) {
          stateA = nextState
          editorA.state = nextState
        },
      },
    }
    const editorB: RenderVirtualizationEngineEditor = {
      isDestroyed: false,
      state: stateB,
      view: {
        dom: editorRootB,
        get state() {
          return stateB
        },
        dispatch(tr: Transaction) {
          stateB = stateB.apply(tr)
          editorB.state = stateB
        },
        updateState(nextState: EditorState) {
          stateB = nextState
          editorB.state = nextState
        },
      },
    }
    setVirtualRootBlockRenderingActiveForOwner(editorA, true)
    setVirtualRootBlockRenderingActiveForOwner(editorB, false)

    const engineA = createRenderVirtualizationEngine({
      getEditor: () => editorA,
      getScrollRoot: () => scrollRoot,
      scheduleFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
    })
    const engineB = createRenderVirtualizationEngine({
      getEditor: () => editorB,
      getScrollRoot: () => scrollRoot,
      scheduleFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
    })

    expect(engineA.refreshNow('editor-scroll').virtualizationEnabled).toBe(true)
    expect(engineB.refreshNow('editor-scroll').virtualizationEnabled).toBe(false)
    expect(getRenderVirtualizationState(stateA)?.enabled).toBe(true)
    expect(getRenderVirtualizationState(stateB)?.enabled).toBe(false)

    engineA.cleanup()
    engineB.cleanup()
  })
})
