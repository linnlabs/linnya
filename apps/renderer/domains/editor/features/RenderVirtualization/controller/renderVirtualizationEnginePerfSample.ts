/**
 * renderVirtualizationEnginePerfSample.ts
 *
 * Engine 运行时埋点样本构造。
 *
 * 中文说明：
 * - Engine 的 refreshNow 只负责编排状态流转；
 * - 诊断样本拼装集中在这里，避免 refreshNow 继续膨胀成“什么都管”的函数。
 */

import type { RenderVirtualizationEnginePerfSample } from '../debug/renderVirtualizationRuntimePerf'
import type { ViewportBounds, WindowSelectionResult } from './renderWindowMath'
import type { CommittedRenderWindow } from './renderWindowCommitFlow'
import { sampleBlockIds } from './renderWindowState'
import { nowMs } from './renderVirtualizationEngineDefaults'

export function buildRenderVirtualizationEnginePerfSample(params: {
  version: number
  reason: string
  visibleBlockIds: readonly string[]
  visibleWindow: WindowSelectionResult
  viewport: ViewportBounds
  totalEstimatedHeight: number
  committedWindow: CommittedRenderWindow
  listenerCount: number
  startedAt: number
}): RenderVirtualizationEnginePerfSample {
  const { committedWindow } = params
  return {
    version: params.version,
    reason: params.reason,
    visibleCount: params.visibleBlockIds.length,
    hydratedCount: committedWindow.actualHydratedBlockIds.length,
    requestedHydrate: committedWindow.requestedHydrateBlockIds.length,
    requestedDehydrate: committedWindow.requestedDehydrateBlockIds.length,
    scrollTop: committedWindow.finalViewport.scrollTop,
    viewportTop: params.viewport.viewportTop,
    viewportBottom: params.viewport.viewportBottom,
    totalEstimatedHeight: Math.round(params.totalEstimatedHeight),
    listenerCount: params.listenerCount,
    anchorBlockId: params.visibleWindow.anchorBlockId,
    windowSelectionSource: params.visibleWindow.source,
    scrollAnchorRestored: committedWindow.anchorRestoreResult?.restored ?? false,
    scrollAnchorDelta: committedWindow.anchorRestoreResult?.delta ?? 0,
    visibleBlockIds: sampleBlockIds(params.visibleBlockIds),
    hydratedBlockIds: sampleBlockIds(committedWindow.actualHydratedBlockIds),
    missingHydratedBlockIds: sampleBlockIds(committedWindow.missingHydratedBlockIds),
    pluginEnabled: committedWindow.pluginEnabled,
    pluginWasEnabled: committedWindow.pluginWasEnabled,
    pluginReadyAfterEnable: committedWindow.pluginReadyAfterEnable,
    commitDispatched: committedWindow.commitDispatched,
    commitMode: committedWindow.commitMode,
    commitViewStateUpdated: committedWindow.commitViewStateUpdated,
    commitReactiveStateSynced: committedWindow.commitReactiveStateSynced,
    pluginHydratedSetSizeBefore: committedWindow.pluginHydratedSetSizeBefore,
    pluginHydratedSetSize: committedWindow.pluginHydratedSetSize,
    pluginPinnedSetSize: committedWindow.pluginPinnedSetSize,
    postCommitHydrateHitCount: committedWindow.postCommitHydrateHitCount,
    postCommitHydrateMissBlockIds: sampleBlockIds(committedWindow.postCommitHydrateMissBlockIds),
    postCommitHydratedSetBlockIds: sampleBlockIds(committedWindow.postCommitHydratedSetBlockIds),
    requestedHydrateBlockIds: sampleBlockIds(committedWindow.requestedHydrateBlockIds),
    requestedDehydrateBlockIds: sampleBlockIds(committedWindow.requestedDehydrateBlockIds),
    durationMs: Math.round((nowMs() - params.startedAt) * 10) / 10,
    timestamp: Date.now(),
  }
}
