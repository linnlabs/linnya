/**
 * renderVirtualizationEngine.ts
 *
 * RootBlock 渲染虚拟化编排器。
 *
 * 中文说明：
 * - 输入层：viewportTracker / virtualEventKeepAlive 负责滚动与交互事件；
 * - 计算层：renderWindowMath 只根据 block 顺序、高度缓存和视口事实选择窗口；
 * - 提交层：renderWindowCommitter 负责把窗口写入 ProseMirror plugin state；
 * - PM plugin state 是 hydrated/pinned 的提交事实源，Engine 只发布最近一次快照。
 */

import type { EditorState, Transaction } from 'prosemirror-state'
import type { DirectEditorProps } from 'prosemirror-view'
import type { InjectionKey } from 'vue'
import {
  getFlag,
  shouldUseVirtualRootBlockRenderingForOwner,
} from '../../../ui/services/editorFeatureFlags'
import { resolveRenderWindowOverscanPx } from '../renderVirtualizationConstants'
import { getRenderVirtualizationState } from '../state/renderVirtualizationPlugin'
import { KeepAliveRegistry } from '../state/keepAliveRegistry'
import {
  createRegistryKeepAlivePort,
  type RenderVirtualizationKeepAlivePort,
} from '../state/keepAlivePort'
import { publishRenderVirtualizationEnginePerf } from '../debug/renderVirtualizationRuntimePerf'
import {
  formatRenderVirtualizationRefreshReason,
  mergeRenderVirtualizationRefreshReasons,
  normalizeRenderVirtualizationRefreshReason,
  type RenderVirtualizationRefreshReason,
  type RenderVirtualizationRefreshReasonInput,
} from './refreshReason'
import { recordHydratedWindowHeights } from './renderWindowDom'
import { commitRenderWindow, commitRenderVirtualizationMeta } from './renderWindowCommitter'
import { createVirtualViewportTracker, type VirtualViewportTracker } from './viewportTracker'
import { createVirtualEventKeepAlive } from './virtualEventKeepAlive'
import { resetRootBlockNodeViewLifecycleRegistry } from '../state/nodeViewLifecycle'
import { resetRootBlockRuntimeRegistry } from '../runtime/RootBlockRuntimeRegistry'
import { planRenderWindowRefresh } from './renderWindowPlanner'
import { commitPlannedRenderWindow } from './renderWindowCommitFlow'
import { buildRenderVirtualizationEnginePerfSample } from './renderVirtualizationEnginePerfSample'
import {
  createEmptyRenderVirtualizationSnapshot,
  defaultCancelFrame,
  defaultScheduleFrame,
  nowMs,
} from './renderVirtualizationEngineDefaults'

export interface RenderVirtualizationEngineSnapshot {
  version: number
  reason: string
  refreshReason: RenderVirtualizationRefreshReason
  capturedAt: number
  virtualizationEnabled: boolean
  visibleBlockIds: readonly string[]
  hydratedBlockIds: readonly string[]
  pinnedBlockIds: readonly string[]
  requestedHydrateBlockIds: readonly string[]
  requestedDehydrateBlockIds: readonly string[]
  scrollTop: number
  viewportTop: number
  viewportBottom: number
  totalEstimatedHeight: number
}

export interface RenderVirtualizationEngine {
  keepAlivePort: RenderVirtualizationKeepAlivePort
  scheduleRefresh: (reason?: RenderVirtualizationRefreshReasonInput) => void
  refreshNow: (
    reason?: RenderVirtualizationRefreshReasonInput
  ) => RenderVirtualizationEngineSnapshot
  remeasureHydratedWindow: (reason?: string) => void
  getSnapshot: () => RenderVirtualizationEngineSnapshot
  subscribe: (listener: (snapshot: RenderVirtualizationEngineSnapshot) => void) => () => void
  cleanup: () => void
}

export interface CreateRenderVirtualizationEngineOptions {
  getEditor: () => RenderVirtualizationEngineEditor | null
  getScrollRoot: () => HTMLElement | null
  overscanPx?: number
  maxWindowBlockCount?: number
  scheduleFrame?: (callback: () => void) => number
  cancelFrame?: (handle: number) => void
}

interface EditorEventBusLike {
  on?: (eventName: string, listener: () => void) => void
  off?: (eventName: string, listener: () => void) => void
}

type EditorSelectionListenerEvent = 'selectionUpdate'

export interface RenderVirtualizationEngineEditor {
  state: EditorState
  view: {
    state: EditorState
    dom: HTMLElement
    dispatch: (tr: Transaction) => void
    updateState?: (state: EditorState) => void
    props?: DirectEditorProps
    update?: (props: DirectEditorProps) => void
  }
  isDestroyed?: boolean
  eventBus?: EditorEventBusLike
  on?: (eventName: EditorSelectionListenerEvent, listener: () => void) => void
  off?: (eventName: EditorSelectionListenerEvent, listener: () => void) => void
}

export const RENDER_VIRTUALIZATION_ENGINE_KEY: InjectionKey<RenderVirtualizationEngine> = Symbol(
  'RenderVirtualizationEngine'
)

type EngineLifecyclePhase = 'idle' | 'refreshing' | 'cleaning' | 'destroyed'

function formatEngineMetric(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return String(value)
}

function readScrollRootMetric(
  scrollRoot: HTMLElement | null,
  key: 'scrollTop' | 'scrollHeight' | 'clientHeight'
): number | null {
  if (!scrollRoot) return null
  return Math.round(scrollRoot[key])
}

function logRenderVirtualizationEngineStage(
  stage: string,
  buildMetrics: () => readonly string[]
): void {
  if (!getFlag('renderVirtualizationDebugLogging')) return
  const metrics = buildMetrics()
  console.info(`[RenderVirtEngine] ${stage} ${metrics.join(' ')}`)
}

export function createRenderVirtualizationEngine(
  options: CreateRenderVirtualizationEngineOptions
): RenderVirtualizationEngine {
  const scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame
  const configuredOverscanPx = options.overscanPx
  const configuredMaxWindowBlockCount = options.maxWindowBlockCount
  const listeners = new Set<(snapshot: RenderVirtualizationEngineSnapshot) => void>()
  const pendingReasons = new Set<RenderVirtualizationRefreshReason>()
  let frameHandle: number | null = null
  let snapshot = createEmptyRenderVirtualizationSnapshot()
  let version = 0
  let lifecyclePhase: EngineLifecyclePhase = 'idle'
  let runtimeRegistryOwner: RenderVirtualizationEngineEditor | null = null
  let suppressKeepAliveRefresh = false

  const keepAliveRegistry = new KeepAliveRegistry({
    onAcquire(blockId) {
      commitKeepAliveChange({ pin: [blockId] })
    },
    onRelease(blockId) {
      commitKeepAliveChange({ unpin: [blockId] })
    },
  })
  const keepAlivePort = createRegistryKeepAlivePort(keepAliveRegistry)

  let viewportTracker: VirtualViewportTracker | null = null
  const eventKeepAlive = createVirtualEventKeepAlive({
    getEditor: options.getEditor,
    keepAlivePort,
    scheduleRefresh,
  })

  function notify(nextSnapshot: RenderVirtualizationEngineSnapshot): void {
    listeners.forEach(listener => listener(nextSnapshot))
  }

  function readEditor(): RenderVirtualizationEngineEditor | null {
    const editor = options.getEditor()
    if (editor) runtimeRegistryOwner = editor
    return editor
  }

  function commitKeepAliveChange(params: {
    pin?: readonly string[]
    unpin?: readonly string[]
  }): void {
    if (lifecyclePhase === 'cleaning' || lifecyclePhase === 'destroyed') return
    const editor = readEditor()
    if (!editor || editor.isDestroyed) return
    const virtualizationState = getRenderVirtualizationState(editor.view.state)
    if (!virtualizationState?.enabled) return

    const commitResult = commitRenderWindow({
      editor,
      pin: params.pin ?? [],
      unpin: params.unpin ?? [],
    })
    if (!commitResult.didCommit) return

    if (lifecyclePhase === 'idle' && !suppressKeepAliveRefresh) {
      scheduleRefresh({ type: 'after-dispatch' })
    }
  }

  function ensureRuntimeListeners(): void {
    eventKeepAlive.install()
    if (!viewportTracker) {
      viewportTracker = createVirtualViewportTracker({
        getScrollRoot: options.getScrollRoot,
        nowMs,
        refreshNow: reason => {
          refreshNow(reason)
        },
        scheduleRefresh,
      })
    }
    viewportTracker.install()
  }

  function remeasureHydratedWindow(): void {
    if (lifecyclePhase === 'destroyed') return
    const editor = readEditor()
    if (!editor) return
    recordHydratedWindowHeights({
      editorRoot: editor.view?.dom ?? null,
      blockIds: snapshot.hydratedBlockIds,
      owner: editor,
    })
  }

  function publishDisabledSnapshot(
    refreshReason: RenderVirtualizationRefreshReason,
    virtualizationEnabled: boolean
  ): RenderVirtualizationEngineSnapshot {
    version += 1
    const reasonLabel = formatRenderVirtualizationRefreshReason(refreshReason)
    snapshot = {
      ...createEmptyRenderVirtualizationSnapshot(),
      version,
      capturedAt: nowMs(),
      reason: reasonLabel,
      refreshReason,
      virtualizationEnabled,
    }
    notify(snapshot)
    return snapshot
  }

  function refreshNow(
    reasonInput?: RenderVirtualizationRefreshReasonInput
  ): RenderVirtualizationEngineSnapshot {
    const startedAt = nowMs()
    if (lifecyclePhase === 'destroyed' || lifecyclePhase === 'cleaning') return snapshot
    logRenderVirtualizationEngineStage('refresh:enter', () => [
      `phase=${lifecyclePhase}`,
      `hasReason=${formatEngineMetric(Boolean(reasonInput))}`,
      `pendingBefore=${formatEngineMetric(pendingReasons.size)}`,
      `framePending=${formatEngineMetric(frameHandle !== null)}`,
    ])
    ensureRuntimeListeners()
    if (frameHandle !== null) {
      cancelFrame(frameHandle)
      frameHandle = null
    }
    if (reasonInput) pendingReasons.add(normalizeRenderVirtualizationRefreshReason(reasonInput))

    const reason = mergeRenderVirtualizationRefreshReasons(pendingReasons)
    const reasonLabel = formatRenderVirtualizationRefreshReason(reason)
    const editor = readEditor()
    const editorRoot = editor?.view?.dom ?? null
    const virtualizationEnabled = Boolean(
      editor && !editor.isDestroyed && shouldUseVirtualRootBlockRenderingForOwner(editor)
    )
    logRenderVirtualizationEngineStage('refresh:resolved', () => [
      `reason=${reasonLabel}`,
      `enabled=${formatEngineMetric(virtualizationEnabled)}`,
      `hasEditor=${formatEngineMetric(Boolean(editor))}`,
      `destroyed=${formatEngineMetric(Boolean(editor?.isDestroyed))}`,
      `hasRoot=${formatEngineMetric(Boolean(editorRoot))}`,
    ])
    if (!editor || editor.isDestroyed || !editorRoot || !virtualizationEnabled) {
      if (
        editor &&
        !editor.isDestroyed &&
        getRenderVirtualizationState(editor.view.state)?.enabled
      ) {
        commitRenderVirtualizationMeta(editor, { reset: true })
      }
      pendingReasons.clear()
      return publishDisabledSnapshot(reason, virtualizationEnabled)
    }
    suppressKeepAliveRefresh = true
    try {
      eventKeepAlive.syncSelectionKeepAlive()
    } finally {
      suppressKeepAliveRefresh = false
    }

    const scrollRoot = options.getScrollRoot()
    const overscanPx = resolveRenderWindowOverscanPx({
      scrollRoot,
      configuredOverscanPx,
    })
    logRenderVirtualizationEngineStage('refresh:plan-start', () => [
      `reason=${reasonLabel}`,
      `scrollTop=${formatEngineMetric(readScrollRootMetric(scrollRoot, 'scrollTop'))}`,
      `scrollHeight=${formatEngineMetric(readScrollRootMetric(scrollRoot, 'scrollHeight'))}`,
      `clientHeight=${formatEngineMetric(readScrollRootMetric(scrollRoot, 'clientHeight'))}`,
      `overscan=${formatEngineMetric(overscanPx)}`,
      `maxWindow=${formatEngineMetric(configuredMaxWindowBlockCount ?? null)}`,
    ])
    const plan = planRenderWindowRefresh({
      editorState: editor.state,
      editorRoot,
      scrollRoot,
      reason,
      previousScrollTop: snapshot.scrollTop,
      overscanPx,
      maxWindowBlockCount: configuredMaxWindowBlockCount,
      currentHydratedBlockIds: snapshot.hydratedBlockIds,
      owner: editor,
    })
    const { viewport, visibleWindow, visibleBlockIds, totalEstimatedHeight } = plan
    logRenderVirtualizationEngineStage('refresh:plan-end', () => [
      `reason=${reasonLabel}`,
      `source=${visibleWindow.source}`,
      `anchor=${formatEngineMetric(visibleWindow.anchorBlockId)}`,
      `visible=${formatEngineMetric(visibleBlockIds.length)}`,
      `first=${formatEngineMetric(visibleBlockIds[0])}`,
      `last=${formatEngineMetric(visibleBlockIds[visibleBlockIds.length - 1])}`,
      `viewportTop=${formatEngineMetric(Math.round(viewport.viewportTop))}`,
      `viewportBottom=${formatEngineMetric(Math.round(viewport.viewportBottom))}`,
      `totalEstimated=${formatEngineMetric(Math.round(totalEstimatedHeight))}`,
    ])
    lifecyclePhase = 'refreshing'
    let committedWindow
    try {
      logRenderVirtualizationEngineStage('refresh:commit-start', () => [
        `reason=${reasonLabel}`,
        `visible=${formatEngineMetric(visibleBlockIds.length)}`,
      ])
      committedWindow = commitPlannedRenderWindow({
        editor,
        view: editor.view,
        editorRoot,
        scrollRoot,
        visibleWindow,
        visibleBlockIds,
        viewport,
        reason,
      })
    } finally {
      if (lifecyclePhase === 'refreshing') {
        lifecyclePhase = 'idle'
      }
    }
    logRenderVirtualizationEngineStage('refresh:commit-end', () => [
      `reason=${reasonLabel}`,
      `requestedHydrate=${formatEngineMetric(committedWindow.requestedHydrateBlockIds.length)}`,
      `requestedDehydrate=${formatEngineMetric(committedWindow.requestedDehydrateBlockIds.length)}`,
      `actualHydrated=${formatEngineMetric(committedWindow.actualHydratedBlockIds.length)}`,
      `pluginBefore=${formatEngineMetric(committedWindow.pluginHydratedSetSizeBefore)}`,
      `pluginAfter=${formatEngineMetric(committedWindow.pluginHydratedSetSize)}`,
      `mode=${formatEngineMetric(committedWindow.commitMode)}`,
      `dispatched=${formatEngineMetric(committedWindow.commitDispatched)}`,
    ])
    if (
      committedWindow.anchorRestoreResult?.restored ||
      (reason.type === 'scroll' && reason.isCorrection === true)
    ) {
      viewportTracker?.updateObservedScrollTop(committedWindow.finalViewport.scrollTop)
    }

    version += 1
    snapshot = {
      version,
      reason: reasonLabel,
      refreshReason: reason,
      capturedAt: nowMs(),
      virtualizationEnabled: true,
      visibleBlockIds,
      hydratedBlockIds: committedWindow.actualHydratedBlockIds,
      pinnedBlockIds: committedWindow.actualPinnedBlockIds,
      requestedHydrateBlockIds: committedWindow.requestedHydrateBlockIds,
      requestedDehydrateBlockIds: committedWindow.requestedDehydrateBlockIds,
      scrollTop: committedWindow.finalViewport.scrollTop,
      viewportTop: committedWindow.finalViewport.viewportTop,
      viewportBottom: committedWindow.finalViewport.viewportBottom,
      totalEstimatedHeight,
    }
    publishRenderVirtualizationEnginePerf(
      buildRenderVirtualizationEnginePerfSample({
        version,
        reason: snapshot.reason,
        visibleBlockIds,
        visibleWindow,
        viewport,
        totalEstimatedHeight,
        committedWindow,
        listenerCount: listeners.size,
        startedAt,
      })
    )
    pendingReasons.clear()
    notify(snapshot)
    logRenderVirtualizationEngineStage('refresh:end', () => [
      `version=${formatEngineMetric(snapshot.version)}`,
      `reason=${snapshot.reason}`,
      `durationMs=${formatEngineMetric(Math.round(nowMs() - startedAt))}`,
      `hydrated=${formatEngineMetric(snapshot.hydratedBlockIds.length)}`,
      `reqHydrate=${formatEngineMetric(snapshot.requestedHydrateBlockIds.length)}`,
      `reqDehydrate=${formatEngineMetric(snapshot.requestedDehydrateBlockIds.length)}`,
      `scrollTop=${formatEngineMetric(Math.round(snapshot.scrollTop))}`,
    ])
    return snapshot
  }

  function scheduleRefresh(
    reasonInput: RenderVirtualizationRefreshReasonInput = { type: 'scheduled', label: 'scheduled' }
  ): void {
    if (lifecyclePhase === 'destroyed' || lifecyclePhase === 'cleaning') return
    const normalizedReason = normalizeRenderVirtualizationRefreshReason(reasonInput)
    pendingReasons.add(normalizedReason)
    logRenderVirtualizationEngineStage('schedule', () => [
      `reason=${formatRenderVirtualizationRefreshReason(normalizedReason)}`,
      `pending=${formatEngineMetric(pendingReasons.size)}`,
      `framePending=${formatEngineMetric(frameHandle !== null)}`,
      `phase=${lifecyclePhase}`,
    ])
    if (frameHandle !== null) return
    frameHandle = scheduleFrame(() => {
      logRenderVirtualizationEngineStage('scheduled-frame:start', () => [
        `pending=${formatEngineMetric(pendingReasons.size)}`,
      ])
      frameHandle = null
      refreshNow()
      logRenderVirtualizationEngineStage('scheduled-frame:end', () => [
        `version=${formatEngineMetric(snapshot.version)}`,
      ])
    })
  }

  ensureRuntimeListeners()
  scheduleRefresh({ type: 'initial' })

  return {
    keepAlivePort,
    scheduleRefresh,
    refreshNow,
    remeasureHydratedWindow,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    cleanup() {
      lifecyclePhase = 'cleaning'
      if (frameHandle !== null) {
        cancelFrame(frameHandle)
        frameHandle = null
      }
      viewportTracker?.cleanup()
      viewportTracker = null
      eventKeepAlive.cleanup()
      keepAliveRegistry.clear({ notify: false })
      pendingReasons.clear()
      listeners.clear()
      snapshot = createEmptyRenderVirtualizationSnapshot()
      const owner = runtimeRegistryOwner ?? readEditor()
      if (owner) {
        resetRootBlockNodeViewLifecycleRegistry(owner)
        resetRootBlockRuntimeRegistry(owner)
      }
      lifecyclePhase = 'destroyed'
    },
  }
}
