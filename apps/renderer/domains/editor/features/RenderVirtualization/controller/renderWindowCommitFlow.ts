/**
 * renderWindowCommitFlow.ts
 *
 * RootBlock 虚拟化窗口的提交编排。
 *
 * 中文说明：
 * - planner 只负责算窗口，本文件负责把窗口提交到 PM plugin；
 * - 提交后必须从 plugin state 读回真实 hydrated 集合，不能相信计划本身；
 * - 远距离跳转时的滚动锚点补偿集中在这里，避免 Engine 继续堆业务细节。
 */

import {
  getRenderVirtualizationState,
} from '../state/renderVirtualizationPlugin'
import {
  captureScrollAnchor,
  type PlaceholderHeightSyncResult,
  readViewportBounds,
  recordHydratedWindowHeights,
  restoreScrollAnchor,
  syncExistingPlaceholderHeights,
  type ScrollAnchorRestoreResult,
} from './renderWindowDom'
import {
  collectDehydratableBlockIds,
  collectHydratedLikeBlockIds,
  readActualHydratedWindowBlockIds,
} from './renderWindowState'
import { difference, type ViewportBounds } from './renderWindowMath'
import {
  commitRenderWindow,
  ensureRenderVirtualizationPluginEnabled,
  type RenderVirtualizationCommitMode,
  type RenderWindowCommitterEditor,
  type RenderWindowCommitterView,
} from './renderWindowCommitter'
import type { WindowSelectionResult } from './renderWindowMath'
import type { RenderVirtualizationRefreshReason } from './refreshReason'

export interface CommittedRenderWindow {
  requestedHydrateBlockIds: string[]
  requestedDehydrateBlockIds: string[]
  actualHydratedBlockIds: string[]
  actualPinnedBlockIds: string[]
  missingHydratedBlockIds: string[]
  finalViewport: ViewportBounds
  anchorRestoreResult: ScrollAnchorRestoreResult | null
  pluginEnabled: boolean
  pluginWasEnabled: boolean
  pluginReadyAfterEnable: boolean
  commitDispatched: boolean
  commitMode: RenderVirtualizationCommitMode | null
  commitViewStateUpdated: boolean | null
  commitReactiveStateSynced: boolean
  pluginHydratedSetSizeBefore: number
  pluginHydratedSetSize: number
  pluginPinnedSetSize: number
  placeholderHeightSyncResult: PlaceholderHeightSyncResult | null
  postCommitHydrateHitCount: number
  postCommitHydrateMissBlockIds: string[]
  postCommitHydratedSetBlockIds: string[]
}

export function selectHydratedBlockIdsForHeightMeasurement(params: {
  pluginWasEnabled: boolean
  reason: RenderVirtualizationRefreshReason
  requestedHydrateBlockIds: readonly string[]
  actualHydratedBlockIds: readonly string[]
}): readonly string[] {
  if (!params.pluginWasEnabled) return params.actualHydratedBlockIds

  // 中文说明：direct-state 首开会在初始 plugin state 里预 hydrate 第一屏。
  // file-content-loaded 刷新时这些块不是“本轮新增 hydrate”，但它们仍然必须 seed 高度缓存；
  // 否则未知 placeholder 会用 120px 起跑，滚动过程中再塌到真实均值，造成滚动条回弹。
  if (params.reason.type === 'content-loaded') return params.actualHydratedBlockIds

  // 中文说明：普通原生滚动期间不能持续把路过的块写入高度缓存。
  // 对 5000+ 纯文本文档来说，placeholder 会从首屏自适应高度逐步塌到逐块真实高度，
  // 用户拖动滚动条时 scrollHeight 持续变化，表现为滚动条慢一拍、走过头又被拉回来。
  // 跳转、纠偏和 editor 主动滚动仍会测量，因为这些路径需要真实高度来修正锚点。
  if (
    params.reason.type === 'scroll' &&
    params.reason.source === 'native' &&
    params.reason.isCorrection !== true &&
    params.reason.isJump !== true
  ) {
    return []
  }

  return params.requestedHydrateBlockIds
}

export function commitPlannedRenderWindow(params: {
  editor: RenderWindowCommitterEditor
  view: RenderWindowCommitterView
  editorRoot: HTMLElement
  scrollRoot: HTMLElement | null
  visibleWindow: WindowSelectionResult
  visibleBlockIds: readonly string[]
  viewport: ViewportBounds
  reason: RenderVirtualizationRefreshReason
}): CommittedRenderWindow {
  const nextWindow = new Set(params.visibleBlockIds)
  const pluginStateBeforeEnable = getRenderVirtualizationState(params.view.state)
  const pluginWasEnabled = pluginStateBeforeEnable?.enabled === true
  const pluginIsReady = ensureRenderVirtualizationPluginEnabled({
    editor: params.editor,
    initialHydratedBlockIds: params.visibleBlockIds,
  })
  const pluginStateForDiff = getRenderVirtualizationState(params.view.state)
  const pluginHydratedSetSizeBefore = pluginStateForDiff?.hydratedSet.size ?? 0
  const requestedHydrateBlockIds = difference(nextWindow, collectHydratedLikeBlockIds(pluginStateForDiff))
  const requestedDehydrateBlockIds = difference(collectDehydratableBlockIds(pluginStateForDiff), nextWindow)
  let anchorRestoreResult: ScrollAnchorRestoreResult | null = null
  let finalViewport = params.viewport
  let commitDispatched = false
  let commitMode: RenderVirtualizationCommitMode | null = null
  let commitViewStateUpdated: boolean | null = null
  let commitReactiveStateSynced = false

  if (pluginIsReady && pluginWasEnabled) {
    const shouldRestoreScrollAnchor = params.visibleWindow.source !== 'height-cache' && (
      params.reason.type !== 'scroll' ||
      params.reason.isCorrection === true ||
      params.reason.isJump === true ||
      params.reason.source === 'editor'
    )
    const anchorSnapshot = shouldRestoreScrollAnchor
      ? captureScrollAnchor({
        editorRoot: params.editorRoot,
        scrollRoot: params.scrollRoot,
        blockId: params.visibleWindow.anchorBlockId,
      })
      : null
    const commitResult = commitRenderWindow({
      editor: params.editor,
      hydrate: requestedHydrateBlockIds,
      dehydrate: requestedDehydrateBlockIds,
    })
    commitDispatched = commitResult.didCommit
    commitMode = commitResult.mode
    commitViewStateUpdated = commitResult.viewStateUpdated
    commitReactiveStateSynced = commitResult.reactiveStateSynced
    anchorRestoreResult = commitResult.didCommit
      ? restoreScrollAnchor({
        editorRoot: params.editorRoot,
        scrollRoot: params.scrollRoot,
        anchor: anchorSnapshot,
      })
      : null
    if (anchorRestoreResult?.restored) {
      finalViewport = readViewportBounds(params.editorRoot, params.scrollRoot)
    }
  }

  const actualHydratedBlockIds = readActualHydratedWindowBlockIds(
    params.view.state,
    params.visibleBlockIds
  )
  const heightMeasureBlockIds = selectHydratedBlockIdsForHeightMeasurement({
    pluginWasEnabled,
    reason: params.reason,
    requestedHydrateBlockIds,
    actualHydratedBlockIds,
  })
  recordHydratedWindowHeights({
    editorRoot: params.editorRoot,
    blockIds: heightMeasureBlockIds,
    owner: params.editor,
  })
  const placeholderHeightSyncResult = params.reason.type === 'content-loaded'
    ? syncExistingPlaceholderHeights({ editorRoot: params.editorRoot, owner: params.editor })
    : null
  const pluginStateAfter = getRenderVirtualizationState(params.view.state)
  const actualHydratedBlockIdSet = new Set(actualHydratedBlockIds)
  const postCommitHydrateMissBlockIds = requestedHydrateBlockIds.filter(
    (blockId) => !pluginStateAfter?.hydratedSet.has(blockId)
  )

  return {
    requestedHydrateBlockIds,
    requestedDehydrateBlockIds,
    actualHydratedBlockIds,
    actualPinnedBlockIds: pluginStateAfter ? [...pluginStateAfter.pinnedSet] : [],
    missingHydratedBlockIds: params.visibleBlockIds.filter(
      (blockId) => !actualHydratedBlockIdSet.has(blockId)
    ),
    finalViewport,
    anchorRestoreResult,
    pluginEnabled: pluginStateAfter?.enabled === true,
    pluginWasEnabled,
    pluginReadyAfterEnable: pluginIsReady,
    commitDispatched,
    commitMode,
    commitViewStateUpdated,
    commitReactiveStateSynced,
    pluginHydratedSetSizeBefore,
    pluginHydratedSetSize: pluginStateAfter?.hydratedSet.size ?? 0,
    pluginPinnedSetSize: pluginStateAfter?.pinnedSet.size ?? 0,
    placeholderHeightSyncResult,
    postCommitHydrateHitCount: requestedHydrateBlockIds.length - postCommitHydrateMissBlockIds.length,
    postCommitHydrateMissBlockIds,
    postCommitHydratedSetBlockIds: pluginStateAfter ? [...pluginStateAfter.hydratedSet] : [],
  }
}
