import { computed, onBeforeUnmount, watch, type Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import {
  shouldUseRootBlockShellForOwner,
  shouldUseVirtualRootBlockRenderingForOwner,
  getFlag,
} from '../../../../ui/services/editorFeatureFlags'
import { findRootBlockOuterById } from '../../../../ui/composables/rootBlockViewportSnapshot'
import { useEditorLocalization } from '../../../../ui/useEditorLocalization'
import type { RenderVirtualizationEngine } from '../../../RenderVirtualization'
import { useRevisionStore, type RevisionStore } from '../../store/useRevisionStore'
import {
  clearShellRevisionHeader,
  findShellRevisionHeader,
  renderShellRevisionHeader,
  type ShellRevisionHeaderSession,
} from './shellBlockRevisionHeaderDom'
import { publishShellRevisionHeaderPerf } from './shellRevisionHeaderPerf'
import { readMountedEditorViewDom } from '../../functions/readMountedEditorViewDom'

interface EditorEventBusLike {
  on?: (eventName: string, listener: () => void) => void
  off?: (eventName: string, listener: () => void) => void
}

type EditorWithOptionalEventBus = Editor & {
  eventBus?: EditorEventBusLike
}

export interface UseShellBlockRevisionHeaderOptions {
  editor: Ref<EditorWithOptionalEventBus | null>
  renderVirtualizationEngine: RenderVirtualizationEngine
}

function shouldRunShellRevisionHeader(editor: Editor | null): boolean {
  return (
    shouldUseRootBlockShellForOwner(editor) &&
    !shouldUseVirtualRootBlockRenderingForOwner(editor) &&
    getFlag('blockChromeLayerEnabled') &&
    getFlag('revisionOverlayEnabled')
  )
}

const PERF_BLOCK_ID_SAMPLE_LIMIT = 12

function pushPerfBlockIdSample(target: string[], blockId: string): void {
  if (target.length >= PERF_BLOCK_ID_SAMPLE_LIMIT) return
  target.push(blockId)
}

function logShellRevisionHeaderStage(stage: string, metrics: readonly string[]): void {
  if (!getFlag('renderVirtualizationDebugLogging')) return
  console.info(`[ShellRevisionHeader] ${stage} ${metrics.join(' ')}`)
}

function resolveShellRevisionHeaderSession(
  store: RevisionStore,
  blockId: string
): ShellRevisionHeaderSession | null {
  const canonicalSession = store.getCanonicalSession(blockId)

  if (canonicalSession) {
    const activeRevision =
      canonicalSession.diffStats == null ? store.getRevisionState(blockId) : null
    return {
      blockId,
      createdAt: canonicalSession.createdAt,
      // 中文说明：投影刚完成时 activeRevisions 往往先拿到精确统计；
      // canonical 回填存在响应式时序差，因此 header 优先使用已投影统计。
      diffStats: activeRevision?.diffStats ?? canonicalSession.diffStats,
    }
  }

  const activeRevision = store.getRevisionState(blockId)
  if (activeRevision?.status !== 'pending') return null
  return {
    blockId,
    createdAt: activeRevision.createdAt,
    diffStats: activeRevision.diffStats,
  }
}

/**
 * Shell 大文档的块级修订 header 同步层。
 *
 * 中文说明：
 * - canonical pending 是事实源，active revisionMark 是投影后的运行态补充；
 * - header 只服务非虚拟化 Shell 压测路径下已 hydrated 的 Shell NodeView；
 * - 真正的 render virtualization 路径中，离屏块是 placeholder，入屏块是 RootBlockDomNodeView，
 *   由 BlockChromeHost 承担拖拽、批注、修订和历史等轻量入口；
 * - header 是 `RootBlockShellView` 内的文档流 DOM，不再依赖 overlay 的 absolute 坐标；
 * - 本层只写入轻量原生 DOM，不挂载每块 Vue 实例，避免把大文档重新拖回重 chrome 路径。
 */
export function useShellBlockRevisionHeader(
  options: UseShellBlockRevisionHeaderOptions
): void {
  const renderedBlockIds = new Set<string>()
  const renderVirtualizationEngine = options.renderVirtualizationEngine
  const { currentLocale, editorMessage } = useEditorLocalization()
  let refreshRaf: number | null = null

  const revisionStore = computed<RevisionStore | null>(() => {
    const editor = options.editor.value
    return editor ? useRevisionStore(editor) : null
  })

  function clearRenderedHeaders(editorRoot: HTMLElement | null): void {
    for (const blockId of Array.from(renderedBlockIds)) {
      const outer = findRootBlockOuterById(editorRoot, blockId)
      if (outer) clearShellRevisionHeader(outer)
      renderedBlockIds.delete(blockId)
    }
  }

  function syncNow(): void {
    const startedAt = performance.now()
    logShellRevisionHeaderStage('sync:start', [
      `rendered=${renderedBlockIds.size}`,
    ])
    refreshRaf = null

    const editor = options.editor.value
    const store = revisionStore.value
    const shellEnabled = shouldRunShellRevisionHeader(editor)
    const editorRoot = readMountedEditorViewDom(editor)
    if (!shellEnabled || !editor || !store || !editorRoot) {
      publishShellRevisionHeaderPerf({
        kind: 'early-return',
        reason: 'editor-or-store-unavailable',
        snapshotVersion: renderVirtualizationEngine.getSnapshot().version,
        snapshotReason: renderVirtualizationEngine.getSnapshot().reason,
        hydratedCount: renderVirtualizationEngine.getSnapshot().hydratedBlockIds.length,
        canonicalCount: 0,
        activeCount: 0,
        outerMissCount: 0,
        sessionMissCount: 0,
        slotMissCount: 0,
        renderedCount: 0,
        outerMissBlockIds: [],
        sessionMissBlockIds: [],
        slotMissBlockIds: [],
        renderedBlockIds: [],
        layoutChanged: false,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        timestamp: Date.now(),
      })
      clearRenderedHeaders(editorRoot)
      logShellRevisionHeaderStage('sync:end', [
        'reason=editor-or-store-unavailable',
        `durationMs=${Math.round((performance.now() - startedAt) * 10) / 10}`,
      ])
      return
    }

    const canonicalCount = store.canonicalPendingBlockCount.value
    const activeCount = store.activeRevisionCount.value
    if (canonicalCount <= 0 && activeCount <= 0) {
      const snapshot = renderVirtualizationEngine.getSnapshot()
      publishShellRevisionHeaderPerf({
        kind: 'early-return',
        reason: 'no-revision-state',
        snapshotVersion: snapshot.version,
        snapshotReason: snapshot.reason,
        hydratedCount: snapshot.hydratedBlockIds.length,
        canonicalCount,
        activeCount,
        outerMissCount: 0,
        sessionMissCount: 0,
        slotMissCount: 0,
        renderedCount: 0,
        outerMissBlockIds: [],
        sessionMissBlockIds: [],
        slotMissBlockIds: [],
        renderedBlockIds: [],
        layoutChanged: false,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        timestamp: Date.now(),
      })
      clearRenderedHeaders(editorRoot)
      logShellRevisionHeaderStage('sync:end', [
        'reason=no-revision-state',
        `durationMs=${Math.round((performance.now() - startedAt) * 10) / 10}`,
      ])
      return
    }

    const snapshot = renderVirtualizationEngine.getSnapshot()
    const hydratedBlockIds = snapshot.hydratedBlockIds
    let layoutChanged = false
    let outerMissCount = 0
    let sessionMissCount = 0
    let slotMissCount = 0
    let renderedCount = 0
    const outerMissBlockIds: string[] = []
    const sessionMissBlockIds: string[] = []
    const slotMissBlockIds: string[] = []
    const renderedBlockIdsSample: string[] = []
    for (const blockId of hydratedBlockIds) {
      const outer = findRootBlockOuterById(editorRoot, blockId)
      if (!outer) {
        outerMissCount += 1
        pushPerfBlockIdSample(outerMissBlockIds, blockId)
        continue
      }

      const session = resolveShellRevisionHeaderSession(store, blockId)
      if (!session) {
        sessionMissCount += 1
        pushPerfBlockIdSample(sessionMissBlockIds, blockId)
        if (renderedBlockIds.has(blockId)) {
          layoutChanged = clearShellRevisionHeader(outer) || layoutChanged
          renderedBlockIds.delete(blockId)
        }
        continue
      }

      if (!findShellRevisionHeader(outer)) {
        slotMissCount += 1
        pushPerfBlockIdSample(slotMissBlockIds, blockId)
        continue
      }

      const didChange = renderShellRevisionHeader(outer, session, {
        locale: currentLocale.value,
        editorMessage,
      })
      if (didChange) renderedCount += 1
      pushPerfBlockIdSample(renderedBlockIdsSample, blockId)
      layoutChanged = didChange || layoutChanged
      renderedBlockIds.add(blockId)
    }

    publishShellRevisionHeaderPerf({
      kind: 'sync',
      reason: 'completed',
      snapshotVersion: snapshot.version,
      snapshotReason: snapshot.reason,
      hydratedCount: hydratedBlockIds.length,
      canonicalCount,
      activeCount,
      outerMissCount,
      sessionMissCount,
      slotMissCount,
      renderedCount,
      outerMissBlockIds,
      sessionMissBlockIds,
      slotMissBlockIds,
      renderedBlockIds: renderedBlockIdsSample,
      layoutChanged,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      timestamp: Date.now(),
    })
    logShellRevisionHeaderStage('sync:end', [
      'reason=completed',
      `hydrated=${hydratedBlockIds.length}`,
      `rendered=${renderedCount}`,
      `layoutChanged=${layoutChanged}`,
      `durationMs=${Math.round((performance.now() - startedAt) * 10) / 10}`,
    ])

    if (layoutChanged) {
      // 中文说明：header 是文档流内元素，首次出现/消失会改变块几何。
      // 这里只需要回写高度缓存，不能再触发完整 refresh / notify，
      // 否则会形成 header layout -> engine refresh -> header sync 的滚动期反馈环。
      renderVirtualizationEngine.remeasureHydratedWindow('shell-revision-header:layout')
    }
  }

  function scheduleSync(): void {
    logShellRevisionHeaderStage('schedule', [
      `framePending=${refreshRaf !== null}`,
      `rendered=${renderedBlockIds.size}`,
    ])
    if (refreshRaf !== null) return
    refreshRaf = requestAnimationFrame(syncNow)
  }

  function installEditorListeners(editor: EditorWithOptionalEventBus): () => void {
    const schedule = () => scheduleSync()
    editor.on('update', schedule)
    editor.eventBus?.on?.('file-content-loaded', schedule)
    editor.eventBus?.on?.('pending-revisions-loaded', schedule)

    return () => {
      editor.off('update', schedule)
      editor.eventBus?.off?.('file-content-loaded', schedule)
      editor.eventBus?.off?.('pending-revisions-loaded', schedule)
    }
  }

  watch(
    () => options.editor.value,
    (editor, _previous, onCleanup) => {
      clearRenderedHeaders(readMountedEditorViewDom(_previous))
      if (!editor || editor.isDestroyed) return

      const cleanup = installEditorListeners(editor)
      onCleanup(cleanup)
      renderVirtualizationEngine.scheduleRefresh('shell-revision-header:editor')
      scheduleSync()
    },
    { immediate: true }
  )

  watch(
    [
      () => revisionStore.value?.canonicalPendingBlockCount.value ?? 0,
      () => revisionStore.value?.activeRevisionCount.value ?? 0,
      () => revisionStore.value?.canonicalPendingStats.value.insertCount ?? 0,
      () => revisionStore.value?.canonicalPendingStats.value.deleteCount ?? 0,
      () => currentLocale.value,
    ],
    () => scheduleSync()
  )

  const unsubscribeRenderWindow = renderVirtualizationEngine.subscribe(() => {
    scheduleSync()
  })

  onBeforeUnmount(() => {
    unsubscribeRenderWindow()
    if (refreshRaf !== null) {
      cancelAnimationFrame(refreshRaf)
      refreshRaf = null
    }
    clearRenderedHeaders(readMountedEditorViewDom(options.editor.value))
  })
}
