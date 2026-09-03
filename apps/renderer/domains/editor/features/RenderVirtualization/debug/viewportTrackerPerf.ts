/**
 * viewportTrackerPerf.ts
 *
 * 滚动输入层诊断 ring buffer。
 *
 * 中文说明：
 * - Engine perf 只能看到“刷新结果”，看不到 scroll 输入层是否收到事件；
 * - 这里记录 viewportTracker 的决策：普通合批、拖拽预览、停止后纠偏；
 * - 默认只写内存，不刷屏。需要 console 时打开 renderVirtualizationDebugLogging。
 */

import { getFlag } from '../../../ui/services/editorFeatureFlags'

export type ViewportTrackerDecision =
  | 'install'
  | 'install-missing-root'
  | 'scroll-scheduled'
  | 'scroll-unchanged-ignored'
  | 'post-correction-preview-suppressed'
  | 'scroll-jump-preview'
  | 'scroll-correction-preview'
  | 'scrollbar-drag-started'
  | 'scrollbar-drag-preview-suppressed'
  | 'scrollbar-drag-settle-deferred'
  | 'scrollbar-drag-ended'
  | 'settled-correction-scheduled'
  | 'settled-correction-fired'
  | 'settled-correction-cleared'
  | 'observed-scrolltop-updated'
  | 'cleanup'

export interface ViewportTrackerPerfSample {
  decision: ViewportTrackerDecision
  scrollTop?: number
  previousScrollTop?: number | null
  delta?: number
  jumpThreshold?: number
  correctionDelta?: number
  correctionDistance?: number
  lastDomCorrectionScrollTop?: number | null
  timerDelayMs?: number
  timestamp: number
}

export interface ViewportTrackerPerfApi {
  getLast: () => ViewportTrackerPerfSample | null
  getHistory: () => ViewportTrackerPerfSample[]
  clear: () => void
}

declare global {
  interface Window {
    __RENDER_VIRT_VIEWPORT_PERF__?: ViewportTrackerPerfApi
  }
}

const HISTORY_LIMIT = 240
const PRINT_THROTTLE_MS = 1200

const history: ViewportTrackerPerfSample[] = []
let lastPrintedAt = 0

function installApi(): void {
  if (typeof window === 'undefined') return

  window.__RENDER_VIRT_VIEWPORT_PERF__ = {
    getLast: () => history[history.length - 1] ?? null,
    getHistory: () => [...history],
    clear: () => {
      history.length = 0
    },
  }
}

function shouldPrint(sample: ViewportTrackerPerfSample): boolean {
  if (!getFlag('renderVirtualizationDebugLogging')) return false
  return sample.decision !== 'scroll-scheduled'
}

export function publishViewportTrackerPerf(sample: ViewportTrackerPerfSample): void {
  history.push(sample)
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  installApi()

  if (!shouldPrint(sample)) return

  const now = sample.timestamp
  if (now - lastPrintedAt < PRINT_THROTTLE_MS) return
  lastPrintedAt = now
  console.info('[RenderVirtViewport] input summary', sample)
}
