/**
 * scrollHandshake.ts
 *
 * 按 blockId 跳转时的 hydrate-before-scroll 协议。
 *
 * 中文说明：
 * - placeholder rootBlock 没有 contentDOM，不能直接把 selection 放进块内部；
 * - 统一入口先 pin/hydrate 目标块，等待 NodeView 重建成 hydrated，再滚动和设置选区；
 * - 调用方只传 blockId 和意图，不需要知道 RenderVirtualization 的内部 state。
 */

import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { NodeSelection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import {
  getRenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import { getRootBlockRuntimeRegistry } from '../runtime/RootBlockRuntimeRegistry'
import { commitRenderVirtualizationMeta } from './renderWindowCommitter'
import {
  applyRenderVirtualizationKeepAliveCommand,
  type RenderVirtualizationKeepAlivePort,
} from '../state/keepAlivePort'
import type { RenderVirtualizationKeepAliveReason } from '../state/keepAliveRegistry'
import {
  DEFAULT_SCROLL_HANDSHAKE_TEMPORARY_PIN_MS,
  DEFAULT_SCROLL_HANDSHAKE_TIMEOUT_MS,
} from '../renderVirtualizationConstants'
import { readRootBlockId } from '../functions/readRootBlockAttrs'

type SelectMode = 'node' | 'cursor' | 'none'

export interface ScrollHandshakeEditorView {
  state: EditorState
  dispatch: (tr: Transaction) => void
  updateState?: (state: EditorState) => void
  nodeDOM: (pos: number) => Node | null
  dom?: HTMLElement
}

export interface ScrollHandshakeEditor {
  state: EditorState
  view: ScrollHandshakeEditorView
  isDestroyed?: boolean
  commands?: {
    focus?: () => boolean
  }
}

export interface ScrollToBlockOptions {
  scrollBehavior?: ScrollBehavior
  scrollBlock?: ScrollLogicalPosition
  select?: SelectMode
  timeoutMs?: number
  temporaryPinMs?: number
  scrollContainer?: HTMLElement | null
  scrollMarginTop?: number
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
  /** @deprecated NodeView 生命周期已替代逐帧 DOM 轮询。保留字段只为兼容旧测试调用。 */
  waitFrame?: () => Promise<void>
}

export interface ScrollToBlockResult {
  ok: boolean
  reason?:
    | 'invalid-block-id'
    | 'editor-destroyed'
    | 'not-found'
    | 'hydrate-timeout'
    | 'no-content-block'
    | 'invalid-position'
    | 'no-root-block'
  pos?: number
  blockId?: string
}

interface RootBlockLocateResult {
  blockId: string
  pos: number
  node: ProseMirrorNode
}

interface HydratedRootBlockResult {
  ok: true
  located: RootBlockLocateResult
  dom: HTMLElement
}

type ScrollToBlockFailure = ScrollToBlockResult & { ok: false }

const SCROLL_HANDSHAKE_KEEP_ALIVE_REASON: RenderVirtualizationKeepAliveReason = 'scroll-handshake'
const temporaryHandshakeReleaseTimers = new WeakMap<
  ScrollHandshakeEditor,
  Map<string, ReturnType<typeof globalThis.setTimeout>>
>()

function locateRootBlockById(state: EditorState, blockId: string): RootBlockLocateResult | null {
  let found: RootBlockLocateResult | null = null

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'rootBlock') return true

    if (readRootBlockId(node) === blockId) {
      found = { blockId, pos, node }
      return false
    }
    return true
  })

  return found
}

function locateRootBlockByPos(state: EditorState, pos: number): RootBlockLocateResult | null {
  if (!Number.isFinite(pos) || pos < 0 || pos > state.doc.content.size) return null

  const $pos = state.doc.resolve(pos)
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name !== 'rootBlock') continue

    const blockId = readRootBlockId(node)
    if (!blockId) return null

    return {
      blockId,
      pos: depth === 0 ? 0 : $pos.before(depth),
      node,
    }
  }

  return null
}

function isPlaceholderRootBlockDom(node: Node | null): boolean {
  if (!(node instanceof HTMLElement)) return false
  return (
    node.dataset.placeholder === 'true' ||
    node.classList.contains('root-block-virtual-placeholder')
  )
}

function isHydratedRootBlockDom(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && !isPlaceholderRootBlockDom(node)
}

function readHydratedRuntimeDom(
  editor: ScrollHandshakeEditor,
  blockId: string
): HTMLElement | null {
  return getRootBlockRuntimeRegistry(editor).getHydrated(blockId)?.getDom() ?? null
}

function dispatchHydrate(editor: ScrollHandshakeEditor, blockId: string): void {
  commitRenderVirtualizationMeta(editor, {
    hydrate: [blockId],
  })
}

function setTemporaryHandshakeKeepAlive(
  editor: ScrollHandshakeEditor,
  blockId: string,
  active: boolean,
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
): void {
  applyRenderVirtualizationKeepAliveCommand({
    port: keepAlivePort,
    legacyTarget: editor.view.dom ?? null,
    command: {
      blockId,
      reason: SCROLL_HANDSHAKE_KEEP_ALIVE_REASON,
    },
    active,
  })
}

function clearTemporaryHandshakeRelease(
  editor: ScrollHandshakeEditor,
  blockId: string
): boolean {
  const timersByBlockId = temporaryHandshakeReleaseTimers.get(editor)
  const timer = timersByBlockId?.get(blockId)
  if (!timer) return false

  globalThis.clearTimeout(timer)
  timersByBlockId?.delete(blockId)
  if (timersByBlockId?.size === 0) {
    temporaryHandshakeReleaseTimers.delete(editor)
  }
  return true
}

function scheduleTemporaryHandshakeRelease(
  editor: ScrollHandshakeEditor,
  blockId: string,
  delayMs: number,
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
): void {
  clearTemporaryHandshakeRelease(editor, blockId)
  const timersByBlockId = temporaryHandshakeReleaseTimers.get(editor) ?? new Map<string, ReturnType<typeof globalThis.setTimeout>>()
  temporaryHandshakeReleaseTimers.set(editor, timersByBlockId)
  const timer = globalThis.setTimeout(() => {
    timersByBlockId.delete(blockId)
    if (timersByBlockId.size === 0) {
      temporaryHandshakeReleaseTimers.delete(editor)
    }
    if (editor.isDestroyed) return
    if (!locateRootBlockById(editor.view.state, blockId)) return
    setTemporaryHandshakeKeepAlive(editor, blockId, false, keepAlivePort)
  }, delayMs)
  timersByBlockId.set(blockId, timer)
}

function refreshTemporaryHandshakeKeepAlive(
  editor: ScrollHandshakeEditor,
  blockId: string,
  delayMs: number,
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
): void {
  const hadPendingRelease = clearTemporaryHandshakeRelease(editor, blockId)
  if (hadPendingRelease) {
    setTemporaryHandshakeKeepAlive(editor, blockId, false, keepAlivePort)
  }
  setTemporaryHandshakeKeepAlive(editor, blockId, true, keepAlivePort)
  scheduleTemporaryHandshakeRelease(editor, blockId, delayMs, keepAlivePort)
}

async function prepareHydratedRootBlock(params: {
  editor: ScrollHandshakeEditor
  blockId?: string
  pos?: number
  timeoutMs: number
  temporaryPinMs: number
  keepAlivePort?: RenderVirtualizationKeepAlivePort | null
  pinWhenHydrated?: boolean
}): Promise<HydratedRootBlockResult | ScrollToBlockFailure> {
  if (params.editor.isDestroyed) {
    return { ok: false, reason: 'editor-destroyed', blockId: params.blockId }
  }

  const located = params.blockId
    ? locateRootBlockById(params.editor.view.state, params.blockId)
    : typeof params.pos === 'number'
      ? locateRootBlockByPos(params.editor.view.state, params.pos)
      : null

  if (!located) {
    return {
      ok: false,
      reason: params.blockId ? 'not-found' : 'no-root-block',
      blockId: params.blockId,
      pos: params.pos,
    }
  }

  const initialDom = params.editor.view.nodeDOM(located.pos)
  let hydratedDom: HTMLElement | null = isHydratedRootBlockDom(initialDom)
    ? initialDom
    : readHydratedRuntimeDom(params.editor, located.blockId)
  const virtualizationEnabled = getRenderVirtualizationState(params.editor.view.state)?.enabled === true
  if (!hydratedDom) {
    const hydratedHandlePromise = getRootBlockRuntimeRegistry(params.editor).waitForHydrated(
      located.blockId,
      params.timeoutMs
    )
    dispatchHydrate(params.editor, located.blockId)
    setTemporaryHandshakeKeepAlive(params.editor, located.blockId, true, params.keepAlivePort)
    hydratedDom = (await hydratedHandlePromise.catch(() => null))?.getDom() ?? null

    if (!hydratedDom) {
      setTemporaryHandshakeKeepAlive(params.editor, located.blockId, false, params.keepAlivePort)
      return { ok: false, reason: 'hydrate-timeout', blockId: located.blockId, pos: located.pos }
    }

    scheduleTemporaryHandshakeRelease(
      params.editor,
      located.blockId,
      params.temporaryPinMs,
      params.keepAlivePort
    )
  } else if (params.pinWhenHydrated && virtualizationEnabled) {
    // 中文说明：可见块也需要短暂租约，避免用户点击工具栏时被滚动回收打断。
    refreshTemporaryHandshakeKeepAlive(
      params.editor,
      located.blockId,
      params.temporaryPinMs,
      params.keepAlivePort
    )
  }

  return {
    ok: true,
    located,
    dom: hydratedDom,
  }
}

function setSelection(editor: ScrollHandshakeEditor, pos: number, select: SelectMode): void {
  if (select === 'none') return

  const state = editor.view.state
  const selection =
    select === 'node'
      ? NodeSelection.create(state.doc, pos)
      : TextSelection.near(state.doc.resolve(Math.min(pos + 1, state.doc.content.size)))

  editor.view.dispatch(state.tr.setSelection(selection))
  editor.commands?.focus?.()
}

function scrollDomIntoView(dom: HTMLElement, options: ScrollToBlockOptions): void {
  const behavior = options.scrollBehavior ?? 'auto'
  const block = options.scrollBlock ?? 'start'
  const container = options.scrollContainer

  if (container instanceof HTMLElement) {
    const marginTop = options.scrollMarginTop ?? 0
    const containerRect = container.getBoundingClientRect()
    const targetRect = dom.getBoundingClientRect()
    const targetTop = targetRect.top - containerRect.top + container.scrollTop
    container.scrollTo({
      top: Math.max(0, targetTop - marginTop),
      behavior,
    })
    return
  }

  dom.scrollIntoView({ behavior, block })
}

export async function hydrateRootBlockForInteraction(
  editor: ScrollHandshakeEditor,
  blockId: string,
  options: Pick<ScrollToBlockOptions, 'timeoutMs' | 'temporaryPinMs' | 'keepAlivePort' | 'waitFrame'> = {}
): Promise<ScrollToBlockResult> {
  if (!blockId) return { ok: false, reason: 'invalid-block-id', blockId }

  const hydrated = await prepareHydratedRootBlock({
    editor,
    blockId,
    timeoutMs: options.timeoutMs ?? DEFAULT_SCROLL_HANDSHAKE_TIMEOUT_MS,
    temporaryPinMs: options.temporaryPinMs ?? DEFAULT_SCROLL_HANDSHAKE_TEMPORARY_PIN_MS,
    keepAlivePort: options.keepAlivePort,
    pinWhenHydrated: true,
  })
  if (!hydrated.ok) {
    return hydrated
  }

  return {
    ok: true,
    blockId: hydrated.located.blockId,
    pos: hydrated.located.pos,
  }
}

export async function scrollEditorToBlock(
  editor: ScrollHandshakeEditor,
  blockId: string,
  options: ScrollToBlockOptions = {}
): Promise<ScrollToBlockResult> {
  if (!blockId) return { ok: false, reason: 'invalid-block-id', blockId }

  const timeoutMs = options.timeoutMs ?? DEFAULT_SCROLL_HANDSHAKE_TIMEOUT_MS
  const hydrated = await prepareHydratedRootBlock({
    editor,
    blockId,
    timeoutMs,
    temporaryPinMs: options.temporaryPinMs ?? DEFAULT_SCROLL_HANDSHAKE_TEMPORARY_PIN_MS,
    keepAlivePort: options.keepAlivePort,
  })
  if (!hydrated.ok) {
    return hydrated
  }

  setSelection(editor, hydrated.located.pos, options.select ?? 'node')
  scrollDomIntoView(hydrated.dom, options)

  return { ok: true, blockId, pos: hydrated.located.pos }
}

function findContentBlockEndPos(state: EditorState, rootBlockPos: number): number | null {
  const rootBlock = state.doc.nodeAt(rootBlockPos)
  if (!rootBlock || rootBlock.type.name !== 'rootBlock' || rootBlock.childCount === 0) return null

  const firstChild = rootBlock.child(0)
  return rootBlockPos + 1 + firstChild.nodeSize - 1
}

export async function positionCursorAtBlockEndWithHandshake(
  editor: ScrollHandshakeEditor,
  blockId: string,
  options: Pick<ScrollToBlockOptions, 'timeoutMs' | 'temporaryPinMs' | 'keepAlivePort' | 'waitFrame'> = {}
): Promise<ScrollToBlockResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCROLL_HANDSHAKE_TIMEOUT_MS
  const hydrated = await prepareHydratedRootBlock({
    editor,
    blockId,
    timeoutMs,
    temporaryPinMs: options.temporaryPinMs ?? DEFAULT_SCROLL_HANDSHAKE_TEMPORARY_PIN_MS,
    keepAlivePort: options.keepAlivePort,
  })
  if (!hydrated.ok) {
    return hydrated
  }

  const endPos = findContentBlockEndPos(editor.view.state, hydrated.located.pos)
  if (endPos === null) {
    editor.commands?.focus?.()
    return {
      ok: false,
      reason: 'no-content-block',
      blockId,
      pos: hydrated.located.pos,
    }
  }

  const state = editor.view.state
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, endPos)))
  editor.commands?.focus?.()

  return { ok: true, blockId, pos: hydrated.located.pos }
}

export async function positionTextSelectionWithHandshake(
  editor: ScrollHandshakeEditor,
  from: number,
  to: number = from,
  options: Pick<ScrollToBlockOptions, 'timeoutMs' | 'temporaryPinMs' | 'keepAlivePort' | 'waitFrame'> = {}
): Promise<ScrollToBlockResult> {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return { ok: false, reason: 'invalid-position', pos: from }
  }

  const state = editor.view.state
  const safeFrom = Math.max(0, Math.min(from, state.doc.content.size))
  const safeTo = Math.max(safeFrom, Math.min(to, state.doc.content.size))
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCROLL_HANDSHAKE_TIMEOUT_MS
  const hydrated = await prepareHydratedRootBlock({
    editor,
    pos: safeFrom,
    timeoutMs,
    temporaryPinMs: options.temporaryPinMs ?? DEFAULT_SCROLL_HANDSHAKE_TEMPORARY_PIN_MS,
    keepAlivePort: options.keepAlivePort,
  })
  if (!hydrated.ok) {
    return hydrated
  }

  const latestState = editor.view.state
  const selection = safeFrom === safeTo
    ? TextSelection.near(latestState.doc.resolve(safeFrom))
    : TextSelection.create(latestState.doc, safeFrom, safeTo)
  editor.view.dispatch(latestState.tr.setSelection(selection).scrollIntoView())
  editor.commands?.focus?.()

  return { ok: true, blockId: hydrated.located.blockId, pos: safeFrom }
}
