/**
 * editorDocumentStateLoader.ts
 *
 * 大文档首开专用的内容加载快路径。
 *
 * 中文说明：
 * Tiptap 3 的 `setContent(JSON, { emitUpdate: false, parseOptions: { preserveWhitespace: 'full' } })` 会走
 * `insertContentAt({ from: 0, to: oldDocSize })`，内部要对“全文替换”构造 ProseMirror
 * replace step。对 10000 个 rootBlock，这一步可能远慢于真正的 DOM 更新。
 *
 * 对“打开/切换文档”来说，我们并不是在用户编辑当前文档，而是在加载一个全新的文档状态；
 * 因此可以直接基于后端 JSON 重建 EditorState，再走原子文档切换入口一次性替换。
 */

import type { JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { EditorState, type Plugin } from '@tiptap/pm/state'
import type { DirectEditorProps } from '@tiptap/pm/view'

import { parseEditorDocumentJson } from '../functions/parseEditorDocumentJson'
import { getFlag } from '../ui/services/editorFeatureFlags'
import { recordSetContentMetrics } from '../ui/services/editorOpenPerf'
import {
  instrumentDirectStateViewUpdate,
  isDirectStateDiagnosticsEnabled,
  printDirectStateViewUpdateBreakdown,
  type DirectStateViewUpdateBreakdown,
  type EditorViewLike,
} from './editorDirectStateDiagnostics'
import { syncTiptapVueReactiveState as syncTiptapVueReactiveStateRef } from '../shared/adapters/tiptapVueReactiveState'
import { markDocumentLoadProjectionTransaction } from '../core/transactions/editorTransactionMeta'

interface EditorViewForDocumentLoad {
  updateState: (state: EditorState) => void
  update?: (props: DirectEditorProps) => void
  props?: DirectEditorProps
  state?: EditorState
  domObserver?: ProseMirrorDomObserverLike
  dom?: HTMLElement
}

export interface EditorForDocumentStateLoad {
  schema: Schema
  state: EditorState
  view: EditorViewForDocumentLoad
}

export interface DirectDocumentLoadResult {
  doc: ProseMirrorNode
  state: EditorState
}

export interface DirectDocumentLoadStatePrepareContext {
  doc: ProseMirrorNode
  previousState: EditorState
}

export interface DirectDocumentLoadOptions {
  prepareState?: (
    state: EditorState,
    context: DirectDocumentLoadStatePrepareContext
  ) => EditorState
  /** 仅大文档首开需要临时摘下 DOM；普通严格装载保持在文档流内。 */
  detachDom?: boolean
}

interface ProseMirrorMutationObserverLike {
  takeRecords: () => MutationRecord[]
}

interface ProseMirrorSelectionSnapshotLike {
  clear?: () => void
}

interface ProseMirrorDomObserverLike {
  queue?: MutationRecord[]
  flushingSoon?: number
  observer?: ProseMirrorMutationObserverLike | null
  currentSelection?: ProseMirrorSelectionSnapshotLike
  setCurSelection?: () => void
  suppressSelectionUpdates?: () => void
}

interface DomObserverCleanupStats {
  queuedRecords: number
  observerRecords: number
  pendingFlushTimer: boolean
}

interface MutableEditorStateConfigLike {
  plugins: readonly Plugin[]
}

interface DirectStateDomUpdateStats {
  detached: boolean
  detachMs: number | null
  reattachMs: number | null
}

class EditorDocumentStateRollbackError extends Error {
  readonly replacementError: unknown
  readonly rollbackError: unknown

  constructor(replacementError: unknown, rollbackError: unknown) {
    super('[EditorDocumentStateLoader] 文档切换失败，且旧 EditorState 回滚失败')
    this.name = 'EditorDocumentStateRollbackError'
    this.replacementError = replacementError
    this.rollbackError = rollbackError
  }
}

export const LARGE_DOCUMENT_ROOT_BLOCK_THRESHOLD = 1500

export function countRootBlocksInDocJson(content: JSONContent | null | undefined): number {
  if (!content || !Array.isArray(content.content)) return 0
  return content.content.filter(node => node?.type === 'rootBlock').length
}

export function shouldUseDirectStateDocumentLoad(content: JSONContent | null | undefined): boolean {
  return (
    getFlag('useDirectStateDocumentLoadForLargeDocuments') &&
    countRootBlocksInDocJson(content) >= LARGE_DOCUMENT_ROOT_BLOCK_THRESHOLD
  )
}

function resetDomObserverPendingWork(
  domObserver: ProseMirrorDomObserverLike | undefined
): DomObserverCleanupStats {
  if (!domObserver) {
    return { queuedRecords: 0, observerRecords: 0, pendingFlushTimer: false }
  }

  const queuedRecords = domObserver.queue?.length ?? 0
  const observerRecords = domObserver.observer?.takeRecords().length ?? 0
  const pendingFlushTimer =
    typeof domObserver.flushingSoon === 'number' && domObserver.flushingSoon > -1

  if (pendingFlushTimer) {
    clearTimeout(domObserver.flushingSoon)
    domObserver.flushingSoon = -1
  }

  if (domObserver.queue && domObserver.queue.length > 0) {
    domObserver.queue.length = 0
  }

  // selectionchange 可能晚于 DOM 重建到达。这里先清空旧快照，再由文档切换后的
  // setCurSelection 写入新 DOM 的选择区，避免旧 selection 触发一次错误的 DOM 反读。
  domObserver.currentSelection?.clear?.()

  return { queuedRecords, observerRecords, pendingFlushTimer }
}

function syncDomObserverAfterDirectStateLoad(
  domObserver: ProseMirrorDomObserverLike | undefined
): DomObserverCleanupStats {
  const stats = resetDomObserverPendingWork(domObserver)

  try {
    domObserver?.setCurSelection?.()
    domObserver?.suppressSelectionUpdates?.()
  } catch (error) {
    console.warn('[EditorDocumentStateLoader] direct-state 同步 DOMObserver selection 失败：', error)
  }

  return stats
}

function reportDomObserverCleanup(
  before: DomObserverCleanupStats,
  after: DomObserverCleanupStats
): void {
  const clearedRecords =
    before.queuedRecords + before.observerRecords + after.queuedRecords + after.observerRecords
  const clearedTimers = Number(before.pendingFlushTimer) + Number(after.pendingFlushTimer)

  if (clearedRecords === 0 && clearedTimers === 0) return

  console.debug('[EditorDocumentStateLoader] direct-state 已清理 DOMObserver 待处理工作', {
    clearedRecords,
    clearedTimers,
    before,
    after,
  })
}

function syncTiptapVueReactiveState(
  editor: EditorForDocumentStateLoad,
  state: EditorState
): boolean {
  // @tiptap/vue-3 的 Editor.state 读取的是内部 reactiveState.value，
  // 不是 view.state。direct-state 不经过 dispatchTransaction，因此必须在这里同步；
  // 否则后续 editor.commands 会基于旧 doc 创建 transaction，把新文档回滚或触发
  // "Applying a mismatched transaction"。
  return syncTiptapVueReactiveStateRef(editor, state, {
    isState: isEditorState,
  })
}

function isEditorState(value: unknown): value is EditorState {
  return value instanceof EditorState
}

function getMutableEditorStateConfig(state: EditorState): MutableEditorStateConfigLike | null {
  const record = state as unknown as Record<string, unknown>
  const config = record.config
  if (typeof config !== 'object' || config === null) return null

  const configRecord = config as Record<string, unknown>
  if (!Array.isArray(configRecord.plugins)) return null

  return configRecord as unknown as MutableEditorStateConfigLike
}

function pluginListsAreIdentical(
  left: readonly Plugin[],
  right: readonly Plugin[]
): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function stabilizePluginArrayReference(
  state: EditorState,
  previousState: EditorState
): boolean {
  if (!getFlag('stabilizeDirectStatePluginsForLargeDocuments')) return false
  if (state.plugins === previousState.plugins) return true

  const config = getMutableEditorStateConfig(state)
  if (!config) return false

  // 中文说明：
  // EditorState.create({ plugins: previousState.plugins }) 会把 plugins 复制进新数组。
  // ProseMirror View 只用数组引用判断 plugins 是否变化；对 direct-state 文档切换而言，
  // 插件实例和顺序没有变化，只有 doc 变了，所以这里把新 state 的 config.plugins
  // 指回上一份数组，避免 updateStateInner 误走 pluginsChanged 分支。
  if (!pluginListsAreIdentical(config.plugins, previousState.plugins)) {
    console.warn('[EditorDocumentStateLoader] 跳过 plugins 引用稳定：插件列表内容不一致')
    return false
  }

  config.plugins = previousState.plugins
  return state.plugins === previousState.plugins
}

interface ScrollSnapshot {
  element: HTMLElement
  scrollTop: number
  scrollLeft: number
}

function collectScrollSnapshots(start: HTMLElement): ScrollSnapshot[] {
  const snapshots: ScrollSnapshot[] = []
  const ownerDocument = start.ownerDocument

  for (let current: Node | null = start; current; current = current.parentNode) {
    if (current instanceof HTMLElement) {
      snapshots.push({
        element: current,
        scrollTop: current.scrollTop,
        scrollLeft: current.scrollLeft,
      })
    }
    if (current === ownerDocument) break
  }

  return snapshots
}

function restoreScrollSnapshots(snapshots: ScrollSnapshot[]): void {
  for (const snapshot of snapshots) {
    snapshot.element.scrollTop = snapshot.scrollTop
    snapshot.element.scrollLeft = snapshot.scrollLeft
  }
}

function updateViewWithOptionalDetachedDom(
  view: EditorViewForDocumentLoad,
  operation: () => void,
  detachDom: boolean
): DirectStateDomUpdateStats {
  const dom = view.dom
  const parent = dom?.parentNode

  if (!detachDom || !getFlag('detachDirectStateDomForLargeDocuments') || !dom || !parent) {
    operation()
    return { detached: false, detachMs: null, reattachMs: null }
  }

  const nextSibling = dom.nextSibling
  const scrollSnapshots = collectScrollSnapshots(dom)
  const previousOverflowAnchor = dom.style.overflowAnchor
  let detached = false
  let detachMs = 0
  let reattachMs = 0

  try {
    // 中文说明：
    // ProseMirror 在 updateStateInner 中可能为了恢复滚动位置读取 DOM 布局。
    // detached DOM 上这些读数没有意义，所以临时设置 overflow-anchor，避开 PM 内部
    // storeScrollPos 分支，再由我们恢复原滚动位置。
    dom.style.overflowAnchor = 'none'

    const detachStartedAt = performance.now()
    parent.removeChild(dom)
    detachMs = performance.now() - detachStartedAt
    detached = true

    operation()
  } finally {
    if (detached && dom.parentNode !== parent) {
      const reattachStartedAt = performance.now()
      const anchor = nextSibling?.parentNode === parent ? nextSibling : null
      parent.insertBefore(dom, anchor)
      reattachMs = performance.now() - reattachStartedAt
    }

    dom.style.overflowAnchor = previousOverflowAnchor
    restoreScrollSnapshots(scrollSnapshots)
  }

  return { detached: true, detachMs, reattachMs }
}

function replaceEditorStateAtomically(
  editor: EditorForDocumentStateLoad,
  state: EditorState,
  options: Pick<DirectDocumentLoadOptions, 'detachDom'>
): {
  diagnosticsBreakdown: DirectStateViewUpdateBreakdown | null
  domUpdateStats: DirectStateDomUpdateStats
} {
  const view = editor.view
  const previousState = view.state ?? editor.state
  const beforeUpdateCleanup = resetDomObserverPendingWork(view.domObserver)

  let diagnosticsBreakdown: DirectStateViewUpdateBreakdown | null = null
  let domUpdateStats: DirectStateDomUpdateStats = {
    detached: false,
    detachMs: null,
    reattachMs: null,
  }

  // 真正会触发 ProseMirror DOM 重建的同步操作。
  // 优先使用 ProseMirror 的 update(props) 官方入口，而不是裸 updateState。
  // 这样 `_props.state` 与 `view.state` 在同一个边界内同步，后续由 view 派发的
  // transaction 不会读到“props 仍指向旧 state”的中间态。
  const updateViewState = (nextState: EditorState): void => {
    if (view.update && view.props) {
      view.update({ ...view.props, state: nextState })
    } else {
      view.updateState(nextState)
    }
  }

  // 中文说明：
  // @tiptap/vue-3 的正常 transaction 会先通过 beforeTransaction 同步 reactiveState，
  // 再进入 view.updateState 创建 Vue NodeView。direct-state 绕过 dispatchTransaction，
  // 如果等 DOM 更新完成后才同步，NodeView setup 期间会读到旧 editor.state。
  // 大文档虚拟化首轮创建一批 Vue NodeView 时，这个旧状态窗口会放大为 Vue flush 卡顿。
  syncTiptapVueReactiveState(editor, state)

  try {
    domUpdateStats = updateViewWithOptionalDetachedDom(view, () => {
      if (isDirectStateDiagnosticsEnabled()) {
        diagnosticsBreakdown = instrumentDirectStateViewUpdate(
          view as unknown as EditorViewLike,
          () => updateViewState(state)
        )
      } else {
        updateViewState(state)
      }
    }, options.detachDom === true)
  } catch (error) {
    // view.update 期间任何 NodeView/DOM 异常都不能把 reactive/view state 留在半切换状态。
    // 回滚仍使用同一个官方 view 入口，恢复旧 selection 与插件状态。
    syncTiptapVueReactiveState(editor, previousState)
    try {
      updateViewState(previousState)
      syncDomObserverAfterDirectStateLoad(view.domObserver)
    } catch (rollbackError) {
      syncTiptapVueReactiveState(editor, previousState)
      throw new EditorDocumentStateRollbackError(error, rollbackError)
    }
    syncTiptapVueReactiveState(editor, previousState)
    throw error
  }

  syncTiptapVueReactiveState(editor, state)

  const afterUpdateCleanup = syncDomObserverAfterDirectStateLoad(view.domObserver)
  reportDomObserverCleanup(beforeUpdateCleanup, afterUpdateCleanup)

  return { diagnosticsBreakdown, domUpdateStats }
}

/**
 * 直接用 JSON 文档替换编辑器状态。
 *
 * 中文说明：这里故意不 emit transaction/update。文档加载完成后的索引刷新、目录刷新等，
 * 由 editorService 后续统一触发 `file-content-loaded` 事件负责。
 *
 * 注意：@tiptap/vue-3 的 Editor.state 不是直接读 view.state，而是读内部
 * reactiveState.value。direct-state 不经过 dispatchTransaction / beforeTransaction，
 * 所以必须显式同步这层响应式 state。ProseMirror 的 EditorView 文档更新还会在 DOM
 * 重建期间 stop/start DOMObserver，因此这里也在文档切换前后清空待处理工作。
 */
export function loadDocumentJsonViaDirectState(
  editor: EditorForDocumentStateLoad,
  content: JSONContent,
  options: DirectDocumentLoadOptions = {}
): DirectDocumentLoadResult {
  const startedAt = performance.now()

  const nodeFromJsonStartedAt = performance.now()
  const doc = parseEditorDocumentJson(content, editor.schema)
  const nodeFromJsonMs = performance.now() - nodeFromJsonStartedAt

  const stateCreateStartedAt = performance.now()
  const previousState = editor.view.state ?? editor.state
  let state = EditorState.create({
    doc,
    plugins: previousState.plugins,
  })
  const pluginsStabilized = stabilizePluginArrayReference(state, previousState)
  if (options.prepareState) {
    state = options.prepareState(state, { doc, previousState })
  }
  // 在 EditorView 看见新状态之前，给各领域一次无 UI 副作用的投影机会。
  // Citation 等领域可在 appendTransaction 中补齐派生系统块，同时仍保持一次 view update。
  state = state.applyTransaction(markDocumentLoadProjectionTransaction(state.tr)).state
  const stateCreateMs = performance.now() - stateCreateStartedAt

  const viewUpdateStartedAt = performance.now()
  const { diagnosticsBreakdown, domUpdateStats } = replaceEditorStateAtomically(
    editor,
    state,
    { detachDom: options.detachDom ?? true }
  )
  const viewUpdateMs = performance.now() - viewUpdateStartedAt

  const totalMs = performance.now() - startedAt
  recordSetContentMetrics({
    method: 'direct-state',
    totalMs,
    viewUpdateMs,
    nonViewUpdateMs: Math.max(0, totalMs - viewUpdateMs),
    viewUpdateCount: 1,
    nodeFromJsonMs,
    stateCreateMs,
    directStatePluginsStabilized: pluginsStabilized,
    directStateDomDetached: domUpdateStats.detached,
    directStateDomDetachMs: domUpdateStats.detachMs,
    directStateDomReattachMs: domUpdateStats.reattachMs,
  })

  if (diagnosticsBreakdown) {
    const rootBlockCount = state.doc.childCount
    printDirectStateViewUpdateBreakdown(diagnosticsBreakdown, rootBlockCount)
  }

  return { doc: state.doc, state }
}

/**
 * 普通文档、大文档首开和 Apply All 共用的严格原子装载入口。
 * 大文档只额外启用 DOM detach 性能策略；schema 校验和状态切换语义完全一致。
 */
export function loadDocumentJsonAtomically(
  editor: EditorForDocumentStateLoad,
  content: JSONContent,
  options: DirectDocumentLoadOptions = {}
): DirectDocumentLoadResult {
  return loadDocumentJsonViaDirectState(editor, content, {
    ...options,
    detachDom: options.detachDom ?? shouldUseDirectStateDocumentLoad(content),
  })
}
