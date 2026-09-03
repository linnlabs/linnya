/**
 * renderVirtualizationRuntimePerf.ts
 *
 * 渲染虚拟化运行时诊断样本。
 *
 * 中文说明：
 * - 滚动期间不能逐帧 console.log，否则日志本身会变成卡顿来源；
 * - 这里默认只写内存 ring buffer，异常或手动开启 debug 时才节流输出；
 * - DevTools 中用 window.__RENDER_VIRT_ENGINE_PERF__ 查看完整历史。
 */

import { getFlag } from '../../../ui/services/editorFeatureFlags'

export interface RenderVirtualizationEnginePerfSample {
  version: number
  reason: string
  visibleCount: number
  hydratedCount: number
  requestedHydrate: number
  requestedDehydrate: number
  scrollTop: number
  viewportTop?: number
  viewportBottom?: number
  totalEstimatedHeight?: number
  listenerCount: number
  anchorBlockId?: string | null
  windowSelectionSource?: 'height-cache' | 'dom-anchor' | 'dom-anchor-reuse' | 'dom-anchor-shift' | 'dom-sample'
  scrollAnchorRestored?: boolean
  scrollAnchorDelta?: number
  visibleBlockIds?: string[]
  hydratedBlockIds?: string[]
  missingHydratedBlockIds?: string[]
  pluginEnabled?: boolean
  pluginWasEnabled?: boolean
  pluginReadyAfterEnable?: boolean
  commitDispatched?: boolean
  commitMode?: 'atomic-update-state' | null
  commitViewStateUpdated?: boolean | null
  commitReactiveStateSynced?: boolean
  pluginHydratedSetSizeBefore?: number
  pluginHydratedSetSize?: number
  pluginPinnedSetSize?: number
  postCommitHydrateHitCount?: number
  postCommitHydrateMissBlockIds?: string[]
  postCommitHydratedSetBlockIds?: string[]
  requestedHydrateBlockIds?: string[]
  requestedDehydrateBlockIds?: string[]
  durationMs: number
  timestamp: number
}

export interface RenderVirtualizationEnginePerfApi {
  getLast: () => RenderVirtualizationEnginePerfSample | null
  getHistory: () => RenderVirtualizationEnginePerfSample[]
  getAnomalies: () => RenderVirtualizationEnginePerfSample[]
  getRecentSummary: (limit?: number) => Array<Pick<
    RenderVirtualizationEnginePerfSample,
    | 'version'
    | 'reason'
    | 'visibleCount'
    | 'hydratedCount'
    | 'requestedHydrate'
    | 'requestedDehydrate'
    | 'commitDispatched'
    | 'pluginWasEnabled'
    | 'pluginReadyAfterEnable'
    | 'pluginHydratedSetSizeBefore'
    | 'pluginHydratedSetSize'
    | 'commitMode'
    | 'commitViewStateUpdated'
    | 'commitReactiveStateSynced'
    | 'postCommitHydrateHitCount'
    | 'postCommitHydrateMissBlockIds'
    | 'postCommitHydratedSetBlockIds'
    | 'windowSelectionSource'
    | 'scrollTop'
    | 'totalEstimatedHeight'
    | 'missingHydratedBlockIds'
    | 'requestedHydrateBlockIds'
  >>
  clear: () => void
}

declare global {
  interface Window {
    __RENDER_VIRT_ENGINE_PERF__?: RenderVirtualizationEnginePerfApi
  }
}

const HISTORY_LIMIT = 160
const THROTTLE_MS = 1200
const SLOW_REFRESH_MS = 32

const history: RenderVirtualizationEnginePerfSample[] = []
let lastPrintedAt = 0

function isAnomaly(sample: RenderVirtualizationEnginePerfSample): boolean {
  return sample.visibleCount > 0 && sample.hydratedCount === 0
}

function summarizeSample(
  sample: RenderVirtualizationEnginePerfSample
): ReturnType<RenderVirtualizationEnginePerfApi['getRecentSummary']>[number] {
  return {
    version: sample.version,
    reason: sample.reason,
    visibleCount: sample.visibleCount,
    hydratedCount: sample.hydratedCount,
    requestedHydrate: sample.requestedHydrate,
    requestedDehydrate: sample.requestedDehydrate,
    commitDispatched: sample.commitDispatched,
    pluginWasEnabled: sample.pluginWasEnabled,
    pluginReadyAfterEnable: sample.pluginReadyAfterEnable,
    commitMode: sample.commitMode,
    commitViewStateUpdated: sample.commitViewStateUpdated,
    commitReactiveStateSynced: sample.commitReactiveStateSynced,
    pluginHydratedSetSizeBefore: sample.pluginHydratedSetSizeBefore,
    pluginHydratedSetSize: sample.pluginHydratedSetSize,
    postCommitHydrateHitCount: sample.postCommitHydrateHitCount,
    postCommitHydrateMissBlockIds: sample.postCommitHydrateMissBlockIds,
    postCommitHydratedSetBlockIds: sample.postCommitHydratedSetBlockIds,
    windowSelectionSource: sample.windowSelectionSource,
    scrollTop: sample.scrollTop,
    totalEstimatedHeight: sample.totalEstimatedHeight,
    missingHydratedBlockIds: sample.missingHydratedBlockIds,
    requestedHydrateBlockIds: sample.requestedHydrateBlockIds,
  }
}

function shouldPrint(sample: RenderVirtualizationEnginePerfSample): boolean {
  if (isAnomaly(sample)) return true
  return getFlag('renderVirtualizationDebugLogging') && sample.durationMs >= SLOW_REFRESH_MS
}

function installApi(): void {
  if (typeof window === 'undefined') return

  window.__RENDER_VIRT_ENGINE_PERF__ = {
    getLast: () => history[history.length - 1] ?? null,
    getHistory: () => [...history],
    getAnomalies: () => history.filter(isAnomaly),
    getRecentSummary: (limit = 20) => history.slice(-Math.max(1, limit)).map(summarizeSample),
    clear: () => {
      history.length = 0
    },
  }
}

export function publishRenderVirtualizationEnginePerf(
  sample: RenderVirtualizationEnginePerfSample
): void {
  history.push(sample)
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  installApi()

  if (!shouldPrint(sample)) return

  const now = sample.timestamp
  if (now - lastPrintedAt < THROTTLE_MS) return
  lastPrintedAt = now

  const method = sample.hydratedCount === 0 ? console.warn : console.info
  method('[RenderVirtEngine] refresh summary', summarizeSample(sample))
}
