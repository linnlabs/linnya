import type { EditorState, Transaction } from 'prosemirror-state'
import {
  getRootBlockRuntimeRegistry,
  resetRootBlockRuntimeRegistry,
  type RootBlockRuntimeHandle,
} from '../runtime/RootBlockRuntimeRegistry'
import {
  createRenderVirtualizationEngine,
  type RenderVirtualizationEngine,
  type RenderVirtualizationEngineEditor,
} from '../controller/renderVirtualizationEngine'
import {
  createMutableScrollTopElement,
  createState,
  disableVirtualRootBlockRendering,
  enableVirtualRootBlockRendering,
  setRect,
} from '../controller/renderVirtualizationEngine.testUtils'
import {
  getRenderVirtualizationState,
  isRootBlockHydratedByVirtualizationState,
  type RenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import { resetRenderVirtualizationBlockHeightCache } from '../state/blockHeightCacheRegistry'
import type { ScrollHandshakeEditor } from '../controller/scrollHandshake'
import { setVirtualRootBlockRenderingActiveForOwner } from '../../../ui/services/editorFeatureFlags'

interface ScheduledFrame {
  handle: number
  callback: () => void
}

export interface VirtualizationIntegrationHarness {
  editor: RenderVirtualizationEngineEditor & ScrollHandshakeEditor
  editorRoot: HTMLElement
  scrollRoot: HTMLElement
  engine: RenderVirtualizationEngine
  setScrollTop: (scrollTop: number) => void
  flushNextFrame: () => void
  flushAllFrames: () => void
  pendingFrameCount: () => number
  getState: () => EditorState
  getVirtualizationState: () => RenderVirtualizationState
  registerHydratedRuntimeHandle: (blockId: string) => void
  syncRuntimeHandlesFromPluginState: () => void
  cleanup: () => void
}

interface IntegrationEditorView {
  state: EditorState
  dom: HTMLElement
  dispatch: (tr: Transaction) => void
  updateState: (nextState: EditorState) => void
  nodeDOM: (pos: number) => Node | null
  _state: EditorState
  _props: { state: EditorState }
}

function createRuntimeDom(blockId: string): {
  outerElement: HTMLElement
  contentElement: HTMLElement
  chromeAnchor: HTMLElement
  revisionHeaderMount: HTMLElement
} {
  const outerElement = document.createElement('div')
  outerElement.className = 'root-block-outer'
  outerElement.dataset.id = blockId

  const rootBlockElement = document.createElement('div')
  rootBlockElement.className = 'root-block'

  const chromeAnchor = document.createElement('div')
  chromeAnchor.className = 'root-block-chrome-anchor'

  const revisionHeaderMount = document.createElement('div')
  revisionHeaderMount.className = 'root-block-revision-header-mount'

  const contentElement = document.createElement('div')
  contentElement.className = 'root-block-content'

  rootBlockElement.append(chromeAnchor, revisionHeaderMount, contentElement)
  outerElement.append(rootBlockElement)

  return {
    outerElement,
    contentElement,
    chromeAnchor,
    revisionHeaderMount,
  }
}

function createNodeDom(blockId: string, placeholder: boolean): HTMLElement {
  const element = document.createElement('div')
  element.className = placeholder
    ? 'root-block-outer root-block-virtual-placeholder'
    : 'root-block-outer is-hydrated'
  element.dataset.id = blockId
  element.dataset.placeholder = placeholder ? 'true' : 'false'
  return element
}

function readRootBlockIdAtPos(state: EditorState, pos: number): string {
  const node = state.doc.nodeAt(pos)
  const id = node?.attrs?.id
  return typeof id === 'string' ? id : ''
}

function createRuntimeHandle(blockId: string, pos: number, editorRoot: HTMLElement): RootBlockRuntimeHandle {
  const runtimeDom = createRuntimeDom(blockId)
  editorRoot.append(runtimeDom.outerElement)

  return {
    blockId,
    mode: 'hydrated',
    getDom: () => runtimeDom.outerElement,
    getContentDom: () => runtimeDom.contentElement,
    getChromeAnchor: () => runtimeDom.chromeAnchor,
    getRevisionHeaderMount: () => runtimeDom.revisionHeaderMount,
    getPos: () => pos,
    getRect: () => runtimeDom.outerElement.getBoundingClientRect(),
    measure: () => runtimeDom.outerElement.getBoundingClientRect().height,
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

export function createVirtualizationIntegrationHarness(params: {
  blockCount: number
  blockIdPrefix?: string
  scrollTop?: number
  clientHeight?: number
  estimatedDocumentHeight?: number
  maxWindowBlockCount?: number
}): VirtualizationIntegrationHarness {
  enableVirtualRootBlockRendering()

  const blockIdPrefix = params.blockIdPrefix ?? 'block'
  const blockIds = Array.from({ length: params.blockCount }, (_, index) => `${blockIdPrefix}-${index}`)
  let state = createState(blockIds)
  const editorRoot = document.createElement('div')
  const { scrollRoot, setScrollTop } = createMutableScrollTopElement(params.scrollTop ?? 0)
  document.body.append(editorRoot, scrollRoot)
  const clientHeight = params.clientHeight ?? 240
  const estimatedDocumentHeight = params.estimatedDocumentHeight ?? params.blockCount * 120

  Object.defineProperty(scrollRoot, 'clientHeight', {
    configurable: true,
    value: clientHeight,
  })
  Object.defineProperty(scrollRoot, 'scrollHeight', {
    configurable: true,
    value: estimatedDocumentHeight,
  })
  setRect(scrollRoot, { top: 0, bottom: clientHeight, height: clientHeight })
  Object.defineProperty(editorRoot, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: -scrollRoot.scrollTop,
      bottom: clientHeight,
      left: 0,
      right: 800,
      width: 800,
      height: estimatedDocumentHeight,
      x: 0,
      y: -scrollRoot.scrollTop,
      toJSON: () => ({}),
    }),
  })

  let updateEditorState: (nextState: EditorState) => void = () => {}
  const editorView: IntegrationEditorView = {
    dom: editorRoot,
    get state() {
      return state
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr)
      editorView._state = state
      editorView._props.state = state
      updateEditorState(state)
    },
    updateState(nextState: EditorState) {
      state = nextState
      editorView._state = nextState
      editorView._props.state = nextState
      updateEditorState(nextState)
    },
    nodeDOM(pos: number) {
      const blockId = readRootBlockIdAtPos(state, pos)
      return createNodeDom(
        blockId,
        !isRootBlockHydratedByVirtualizationState(state, blockId)
      )
    },
    _state: state,
    _props: { state },
  }
  const editor: RenderVirtualizationEngineEditor & ScrollHandshakeEditor = {
    isDestroyed: false,
    state,
    view: editorView,
  }
  updateEditorState = (nextState) => {
    editor.state = nextState
  }
  setVirtualRootBlockRenderingActiveForOwner(editor, true)

  let nextFrameHandle = 1
  const scheduledFrames: ScheduledFrame[] = []
  const cancelledFrameHandles = new Set<number>()
  const engine = createRenderVirtualizationEngine({
    getEditor: () => editor,
    getScrollRoot: () => scrollRoot,
    overscanPx: 0,
    maxWindowBlockCount: params.maxWindowBlockCount,
    scheduleFrame(callback) {
      const handle = nextFrameHandle
      nextFrameHandle += 1
      scheduledFrames.push({ handle, callback })
      return handle
    },
    cancelFrame(handle) {
      cancelledFrameHandles.add(handle)
    },
  })

  const unregisterRuntimeHandles = new Map<string, () => void>()

  function getVirtualizationState(): RenderVirtualizationState {
    const virtualizationState = getRenderVirtualizationState(state)
    if (!virtualizationState) {
      throw new Error('RenderVirtualization integration harness 缺少 plugin state')
    }
    return virtualizationState
  }

  function flushNextFrame(): void {
    while (scheduledFrames.length > 0) {
      const nextFrame = scheduledFrames.shift()
      if (!nextFrame || cancelledFrameHandles.has(nextFrame.handle)) continue
      nextFrame.callback()
      return
    }
  }

  function flushAllFrames(): void {
    for (let index = 0; index < 20 && scheduledFrames.length > 0; index += 1) {
      flushNextFrame()
    }
  }

  function syncRuntimeHandlesFromPluginState(): void {
    // 中文说明：集成测试要模拟真实 NodeView 生命周期。实际已挂载的 hydrated
    // NodeView 来自 Engine 发布的 hydrated window，而不只是 plugin.hydratedSet；
    // selection / pinned 块也可能以 hydrated-like 方式保活并出现在 Engine snapshot 中。
    const hydratedBlockIds = new Set(engine.getSnapshot().hydratedBlockIds)

    unregisterRuntimeHandles.forEach((unregister, blockId) => {
      if (hydratedBlockIds.has(blockId)) return
      unregister()
      unregisterRuntimeHandles.delete(blockId)
    })

    hydratedBlockIds.forEach((blockId) => {
      if (unregisterRuntimeHandles.has(blockId)) return
      const pos = findRootBlockPos(state, blockId)
      const unregister = getRootBlockRuntimeRegistry(editor).register(
        createRuntimeHandle(blockId, pos, editorRoot)
      )
      unregisterRuntimeHandles.set(blockId, unregister)
    })
  }

  function registerHydratedRuntimeHandle(blockId: string): void {
    if (unregisterRuntimeHandles.has(blockId)) return
    const pos = findRootBlockPos(state, blockId)
    if (pos < 0) {
      throw new Error(`测试夹具找不到 rootBlock: ${blockId}`)
    }
    const unregister = getRootBlockRuntimeRegistry(editor).register(
      createRuntimeHandle(blockId, pos, editorRoot)
    )
    unregisterRuntimeHandles.set(blockId, unregister)
  }

  function cleanup(): void {
    engine.cleanup()
    unregisterRuntimeHandles.forEach((unregister) => unregister())
    unregisterRuntimeHandles.clear()
    resetRootBlockRuntimeRegistry(editor)
    resetRenderVirtualizationBlockHeightCache(editor)
    disableVirtualRootBlockRendering()
    editorRoot.remove()
    scrollRoot.remove()
  }

  return {
    editor,
    editorRoot,
    scrollRoot,
    engine,
    setScrollTop,
    flushNextFrame,
    flushAllFrames,
    pendingFrameCount: () => scheduledFrames.filter((frame) => !cancelledFrameHandles.has(frame.handle)).length,
    getState: () => state,
    getVirtualizationState,
    registerHydratedRuntimeHandle,
    syncRuntimeHandlesFromPluginState,
    cleanup,
  }
}
