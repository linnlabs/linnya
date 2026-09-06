// @vitest-environment jsdom

import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { NodeSelection, EditorState } from 'prosemirror-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRenderVirtualizationPlugin,
  getRenderVirtualizationState,
  isRootBlockHydratedByVirtualizationState,
  prepareInitialRenderVirtualizationState,
  renderVirtualizationPluginKey,
} from '../state/renderVirtualizationPlugin'
import {
  hydrateRootBlockForInteraction,
  positionCursorAtBlockEndWithHandshake,
  positionTextSelectionWithHandshake,
  scrollEditorToBlock,
  type ScrollHandshakeEditor,
} from './scrollHandshake'
import {
  getRootBlockRuntimeRegistry,
  registerRootBlockRuntimeHandle,
  type RootBlockRuntimeHandle,
} from '../runtime/RootBlockRuntimeRegistry'
import { resetLegacyRootBlockRuntimeRegistryForTest } from '../testing/legacyOwnerFallbackTestAdapter'
import {
  RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT,
  type RenderVirtualizationKeepAliveEvent,
  dispatchRenderVirtualizationKeepAlive,
} from '../state/keepAliveEvents'
import { KeepAliveRegistry } from '../state/keepAliveRegistry'
import { createRegistryKeepAlivePort } from '../state/keepAlivePort'
import { commitRenderVirtualizationMeta } from './renderWindowCommitter'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'paragraph | imageBlock',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    imageBlock: {
      group: 'block',
      atom: true,
      selectable: true,
      toDOM: () => ['div', { 'data-image-block': 'true' }],
      parseDOM: [{ tag: 'div[data-image-block]' }],
    },
  },
})

function createState(
  blockIds: string[],
  initialHydratedBlockCount: number,
  createRootBlockChild: (id: string) => ProseMirrorNode = (id) =>
    schema.nodes.paragraph.create(null, schema.text(id))
): EditorState {
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(
      null,
      blockIds.map((id) =>
        schema.nodes.rootBlock.create(
          { id },
          createRootBlockChild(id)
        )
      )
    ),
    plugins: [createRenderVirtualizationPlugin()],
  })

  return prepareInitialRenderVirtualizationState(state, {
    enabled: true,
    initialHydratedBlockCount,
  })
}

function readRootBlockIdAtPos(state: EditorState, pos: number): string {
  const node = state.doc.nodeAt(pos)
  const id = node?.attrs?.id
  return typeof id === 'string' ? id : ''
}

function createRootBlockDom(placeholder: boolean): HTMLElement {
  const dom = document.createElement('div')
  dom.className = placeholder
    ? 'root-block-outer root-block-virtual-placeholder'
    : 'root-block-outer is-hydrated'
  dom.dataset.placeholder = placeholder ? 'true' : 'false'
  return dom
}

function createRootBlockRuntimeHandle(blockId: string, dom: HTMLElement): RootBlockRuntimeHandle {
  const contentDom = document.createElement('div')
  dom.appendChild(contentDom)
  return {
    blockId,
    mode: 'hydrated',
    getDom: () => dom,
    getContentDom: () => contentDom,
    getChromeAnchor: () => dom,
    getPos: () => null,
    getRect: () => dom.getBoundingClientRect(),
    measure: () => dom.getBoundingClientRect().height,
  }
}

function setElementRect(
  element: HTMLElement,
  rect: { top: number; bottom: number; height: number }
): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: rect.top,
      bottom: rect.bottom,
      left: 0,
      right: 800,
      width: 800,
      height: rect.height,
    }),
  })
}

function createEditor(
  blockIds: string[],
  initialHydratedBlockCount: number,
  options: {
    registerRuntimeOnHydrate?: boolean
    createRootBlockChild?: (id: string) => ProseMirrorNode
  } = {}
): {
  editor: ScrollHandshakeEditor
  dispatchMetaCount: () => number
  getState: () => EditorState
} {
  let state = createState(
    blockIds,
    initialHydratedBlockCount,
    options.createRootBlockChild
  )
  let metaCount = 0
  const registerRuntimeOnHydrate = options.registerRuntimeOnHydrate ?? true
  const editorDom = document.createElement('div')
  function applyVirtualizationState(nextState: EditorState): void {
    const previousHydratedSet = getRenderVirtualizationState(state)?.hydratedSet ?? new Set<string>()
    const nextHydratedSet = getRenderVirtualizationState(nextState)?.hydratedSet ?? new Set<string>()
    metaCount += 1
    state = nextState
    if (!registerRuntimeOnHydrate) return

    nextHydratedSet.forEach((blockId) => {
      if (previousHydratedSet.has(blockId)) return
      const dom = createRootBlockDom(false)
      dom.dataset.id = blockId
      registerRootBlockRuntimeHandle(createRootBlockRuntimeHandle(blockId, dom), editor)
    })
  }
  const keepAliveRegistry = new KeepAliveRegistry({
    onAcquire(blockId) {
      commitRenderVirtualizationMeta(editor, { pin: [blockId] })
    },
    onRelease(blockId) {
      commitRenderVirtualizationMeta(editor, { unpin: [blockId] })
    },
  })

  const editor: ScrollHandshakeEditor = {
    get state() {
      return state
    },
    view: {
      get state() {
        return state
      },
      dom: editorDom,
      dispatch(tr) {
        const meta = tr.getMeta(renderVirtualizationPluginKey)
        if (meta) {
          applyVirtualizationState(state.apply(tr))
          return
        }
        state = state.apply(tr)
      },
      updateState(nextState) {
        applyVirtualizationState(nextState)
      },
      nodeDOM(pos) {
        const blockId = readRootBlockIdAtPos(state, pos)
        return createRootBlockDom(!isRootBlockHydratedByVirtualizationState(state, blockId))
      },
    },
    commands: {
      focus: vi.fn(() => true),
    },
  }
  editorDom.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, (event) => {
    const keepAliveEvent = event as RenderVirtualizationKeepAliveEvent
    const { blockId, reason, active } = keepAliveEvent.detail
    if (active) keepAliveRegistry.pin(blockId, reason)
    else keepAliveRegistry.unpin(blockId, reason)
  })

  return {
    editor,
    dispatchMetaCount: () => metaCount,
    getState: () => state,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  })
})

afterEach(() => {
  resetLegacyRootBlockRuntimeRegistryForTest()
  vi.useRealTimers()
})

describe('scrollEditorToBlock', () => {
  it('pins an already hydrated rootBlock for block-level interaction', async () => {
    const { editor, dispatchMetaCount, getState } = createEditor(['block-a'], 1)

    const result = await hydrateRootBlockForInteraction(editor, 'block-a', {
      waitFrame: async () => {},
      temporaryPinMs: 20,
    })

    expect(result.ok).toBe(true)
    expect(dispatchMetaCount()).toBe(1)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(true)

    await vi.advanceTimersByTimeAsync(20)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(false)
  })

  it('can use an explicit keep-alive port for temporary handshake leases', async () => {
    const { editor, getState } = createEditor(['block-a'], 1)
    const keepAliveRegistry = new KeepAliveRegistry({
      onAcquire(blockId) {
        commitRenderVirtualizationMeta(editor, { pin: [blockId] })
      },
      onRelease(blockId) {
        commitRenderVirtualizationMeta(editor, { unpin: [blockId] })
      },
    })
    const keepAlivePort = createRegistryKeepAlivePort(keepAliveRegistry)

    const result = await hydrateRootBlockForInteraction(editor, 'block-a', {
      waitFrame: async () => {},
      temporaryPinMs: 20,
      keepAlivePort,
    })

    expect(result.ok).toBe(true)
    expect(keepAliveRegistry.getReasons('block-a').has('scroll-handshake')).toBe(true)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(true)

    await vi.advanceTimersByTimeAsync(20)
    expect(keepAliveRegistry.getReasons('block-a').has('scroll-handshake')).toBe(false)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(false)
  })

  it('hydrates and pins placeholder rootBlock before selecting and scrolling', async () => {
    const { editor, getState } = createEditor(['block-a', 'block-b'], 0)

    const result = await scrollEditorToBlock(editor, 'block-b', {
      select: 'node',
      waitFrame: async () => {},
      temporaryPinMs: 20,
    })

    expect(result.ok).toBe(true)
    expect(getRenderVirtualizationState(getState())?.hydratedSet.has('block-b')).toBe(true)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-b')).toBe(true)
    expect(getState().selection).toBeInstanceOf(NodeSelection)

    await vi.advanceTimersByTimeAsync(20)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-b')).toBe(false)
  })

  it('uses the fast path when the target rootBlock is already hydrated', async () => {
    const { editor, dispatchMetaCount, getState } = createEditor(['block-a'], 1)

    const result = await scrollEditorToBlock(editor, 'block-a', {
      select: 'none',
      waitFrame: async () => {},
    })

    expect(result.ok).toBe(true)
    expect(dispatchMetaCount()).toBe(0)
    expect(getRenderVirtualizationState(getState())?.hydratedSet.has('block-a')).toBe(true)
  })

  it('uses an existing runtime handle when nodeDOM still reports a placeholder shell', async () => {
    const { editor, dispatchMetaCount } = createEditor(['block-a'], 0)
    const runtimeDom = createRootBlockDom(false)
    runtimeDom.dataset.id = 'block-a'
    setElementRect(runtimeDom, { top: 120, bottom: 160, height: 40 })
    registerRootBlockRuntimeHandle(createRootBlockRuntimeHandle('block-a', runtimeDom), editor)
    const scrollContainer = document.createElement('div')
    const scrollTo = vi.fn()
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      value: 10,
    })
    Object.defineProperty(scrollContainer, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    })
    setElementRect(scrollContainer, { top: 20, bottom: 260, height: 240 })

    const result = await scrollEditorToBlock(editor, 'block-a', {
      select: 'none',
      scrollContainer,
      scrollMarginTop: 5,
    })

    expect(result.ok).toBe(true)
    expect(dispatchMetaCount()).toBe(0)
    expect(scrollTo).toHaveBeenCalledWith({
      top: 105,
      behavior: 'auto',
    })
  })

  it('returns not-found without dispatching when blockId is missing from the document', async () => {
    const { editor, dispatchMetaCount } = createEditor(['block-a'], 0)

    const result = await scrollEditorToBlock(editor, 'block-missing', {
      waitFrame: async () => {},
    })

    expect(result).toEqual({
      ok: false,
      reason: 'not-found',
      blockId: 'block-missing',
    })
    expect(dispatchMetaCount()).toBe(0)
  })

  it('returns editor-destroyed without dispatching or creating runtime waiters', async () => {
    const { editor, dispatchMetaCount } = createEditor(['block-a'], 0)
    editor.isDestroyed = true

    const result = await scrollEditorToBlock(editor, 'block-a', {
      timeoutMs: 5,
    })

    expect(result).toEqual({
      ok: false,
      reason: 'editor-destroyed',
      blockId: 'block-a',
    })
    expect(dispatchMetaCount()).toBe(0)
    expect(getRootBlockRuntimeRegistry(editor).getDebugSnapshot().pendingHydratedWaiterCount).toBe(0)
  })

  it('releases the temporary handshake lease when hydration times out', async () => {
    const { editor, getState } = createEditor(['block-a'], 0, {
      registerRuntimeOnHydrate: false,
    })

    const resultPromise = scrollEditorToBlock(editor, 'block-a', {
      timeoutMs: 5,
      temporaryPinMs: 20,
    })
    await vi.advanceTimersByTimeAsync(5)
    const result = await resultPromise

    expect(result).toEqual({
      ok: false,
      reason: 'hydrate-timeout',
      blockId: 'block-a',
      pos: 0,
    })
    expect(getRenderVirtualizationState(getState())?.hydratedSet.has('block-a')).toBe(true)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(false)
    expect(getRootBlockRuntimeRegistry(editor).getDebugSnapshot().pendingHydratedWaiterCount).toBe(0)
  })

  it('positions the cursor at the content end after hydrating a placeholder rootBlock', async () => {
    const { editor, getState } = createEditor(['block-a', 'block-b'], 0)

    const result = await positionCursorAtBlockEndWithHandshake(editor, 'block-b', {
      waitFrame: async () => {},
      temporaryPinMs: 20,
    })

    expect(result.ok).toBe(true)
    expect(getRenderVirtualizationState(getState())?.hydratedSet.has('block-b')).toBe(true)
    expect(getState().selection.from).toBeGreaterThan((result.pos ?? 0) + 1)
    expect(getState().selection.empty).toBe(true)
  })

  it('selects the moved rootBlock when its child has no inline content', async () => {
    const { editor, getState } = createEditor(['block-image'], 0, {
      createRootBlockChild: () => schema.nodes.imageBlock.create(),
    })

    const result = await positionCursorAtBlockEndWithHandshake(editor, 'block-image', {
      waitFrame: async () => {},
      temporaryPinMs: 20,
    })

    expect(result.ok).toBe(true)
    const selection = getState().selection
    expect(selection).toBeInstanceOf(NodeSelection)
    if (!(selection instanceof NodeSelection)) throw new Error('应创建 rootBlock NodeSelection')
    expect(selection.from).toBe(result.pos)
    expect(selection.node.type.name).toBe('rootBlock')
  })

  it('positions an exact text selection after hydrating the containing rootBlock', async () => {
    const { editor, getState } = createEditor(['block-a', 'block-b'], 0)
    const blockBPos = 11
    const from = blockBPos + 2
    const to = from + 3

    const result = await positionTextSelectionWithHandshake(editor, from, to, {
      waitFrame: async () => {},
      temporaryPinMs: 20,
    })

    expect(result.ok).toBe(true)
    expect(result.blockId).toBe('block-b')
    expect(getRenderVirtualizationState(getState())?.hydratedSet.has('block-b')).toBe(true)
    expect(getState().selection.from).toBe(from)
    expect(getState().selection.to).toBe(to)
  })

  it('creates the final text selection from the latest state after hydrate dispatch', async () => {
    const { editor, getState } = createEditor(['block-a', 'block-b'], 0)
    const blockBPos = 11
    const from = blockBPos + 2
    const statesBeforeStateChanges: EditorState[] = []

    const baseDispatch = editor.view.dispatch
    editor.view.dispatch = (tr) => {
      statesBeforeStateChanges.push(editor.view.state)
      baseDispatch(tr)
    }
    const baseUpdateState = editor.view.updateState
    editor.view.updateState = (nextState) => {
      statesBeforeStateChanges.push(editor.view.state)
      baseUpdateState?.(nextState)
    }

    const result = await positionTextSelectionWithHandshake(editor, from, from + 2, {
      waitFrame: async () => {},
      temporaryPinMs: 20,
    })

    expect(result.ok).toBe(true)
    expect(statesBeforeStateChanges).toHaveLength(3)
    expect(statesBeforeStateChanges[0]).not.toBe(
      statesBeforeStateChanges[statesBeforeStateChanges.length - 1]
    )
    expect(getState().selection.from).toBe(from)
    expect(getState().selection.to).toBe(from + 2)
  })

  it('releases only the temporary handshake lease without dropping another keep-alive reason', async () => {
    const { editor, getState } = createEditor(['block-a'], 1)

    dispatchRenderVirtualizationKeepAlive(editor.view.dom ?? null, {
      blockId: 'block-a',
      reason: 'revision-toolbar',
      active: true,
    })

    const result = await hydrateRootBlockForInteraction(editor, 'block-a', {
      waitFrame: async () => {},
      temporaryPinMs: 20,
    })

    expect(result.ok).toBe(true)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(true)

    await vi.advanceTimersByTimeAsync(20)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(true)

    dispatchRenderVirtualizationKeepAlive(editor.view.dom ?? null, {
      blockId: 'block-a',
      reason: 'revision-toolbar',
      active: false,
    })
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(false)
  })

  it('refreshes the temporary handshake release timer for repeated interaction on the same block', async () => {
    const { editor, getState } = createEditor(['block-a'], 1)

    const firstResult = await hydrateRootBlockForInteraction(editor, 'block-a', {
      waitFrame: async () => {},
      temporaryPinMs: 20,
    })

    expect(firstResult.ok).toBe(true)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(true)

    await vi.advanceTimersByTimeAsync(10)
    const secondResult = await hydrateRootBlockForInteraction(editor, 'block-a', {
      waitFrame: async () => {},
      temporaryPinMs: 20,
    })

    expect(secondResult.ok).toBe(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(true)

    await vi.runOnlyPendingTimersAsync()
    expect(getRenderVirtualizationState(getState())?.pinnedSet.has('block-a')).toBe(false)
  })
})
